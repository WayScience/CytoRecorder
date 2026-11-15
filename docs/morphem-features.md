# MorphEm features in the browser

After segmentation, musivarium automatically embeds each native object crop with [MorphEm](https://github.com/CaicedoLab/MorphEm) — the CaicedoLab ViT-Small "Bag of Channels" DINO backbone trained on CHAMMI-75 — entirely client-side through ONNX Runtime Web, the same runtime that runs StarDist. A dedicated Web Worker runs one crop at a time, with its channels processed serially; inference does not run on the UI thread. No feature data leaves the browser.

## What runs

- **Model**: the published HuggingFace `CaicedoLab/MorphEm` backbone (revision `0e8d58787421f83f975634d72420d85c5dfc9c2c`, MIT license), exported to a single-file ONNX graph that outputs the 384-dim normalized CLS-token embedding. The classifier head is intentionally unused. The exported graph is pinned by SHA-256 (`819132f2…`) and verified by `npm run setup:morphem` / `npm run setup:assets`; a missing graph is reproduced from pinned upstream weights and the small vendored graph recipe described below.
- **Per-channel ("Bag of Channels")**: each crop channel is embedded separately, so an N-channel crop yields N × 384 features. Feature names are channel-last (`MorphEm_Feature<i>_Channel<c>`), matching the pycytominer ecosystem convention.
- **Transform (per crop, per channel)**, following the published MorphEm stack:
  1. **Saturation-safe 8-bit rescale**: 16-bit (or float) crops are rescaled so only the true maximum (camera-saturated) pixels become 255; everything else maps to [0, 254]. Uint8 crops pass through unchanged.
  2. **Saturation-noise injection**: 255 pixels are replaced with uniform noise in [0, 255). The published pipeline draws this randomly; the app seeds it deterministically so embeddings are reproducible across runs.
  3. **Instance normalization** (per-image mean/std), which absorbs any linear scale factor.
  4. **Bilinear resize** to 224 × 224 (torchvision align-corners=False border behaviour).
- **Background controls**: extraction starts automatically once segmentation and database preparation finish, not on page load. Its progress appears separately from the main loading/segmentation status. **Pause features** / **Resume features** control the queue; **Retry features** retries a failed queue while retaining completed results.
- **Voice interaction**: opening voice preparation immediately terminates the feature worker, releasing the loaded model and interrupting in-flight inference. Completed object features remain available. Closing voice preparation resumes the queue unless it is also manually paused; an interrupted object is retried rather than publishing partial values.
- **Inspector**: **MorphEm features** waits for database readiness, returns already completed features or prioritizes the selected object in the existing queue. It does not launch duplicate inference. The button downloads the full feature manifest as JSON and reports the dimension, timing and first values in the inspector status.

## Progressive exports

The base `cells` measurement table and native crop measurements are unchanged. Completed embeddings are published into a separate `morphem_features` table and progressively joined into CSV/Parquet exports by `cell_id`. Exports include the model id, revision, preprocessing descriptor and channel mapping alongside channel-last feature columns. Pending embeddings are SQL `NULL` (empty fields in CSV), never zero placeholders; `morphem_status` distinguishes pending from ready objects. Exporting does not wait for the whole feature queue to complete. A later export includes the additional objects completed since the earlier export.

## Verification

- **Independent torch oracle**: a reference forward pass was written directly against the published `vision_transformer.py` architecture and `model.safetensors` weights (torch, no transformers dependency), through the exact app transform. The browser WASM graph reproduces the oracle CLS embedding to ~1e-4 per element (`tests/morphem.test.ts`).
- **Unit tests**: saturation rescale semantics (only true saturation becomes 255; uint8 passthrough; negative/NaN rejection), seeded noise determinism, instance-norm moments, bilinear resize against a hand-derived torchvision grid.
- **Browser test**: `tests/browser/morphem-inspector.spec.ts` runs the real 86 MB WASM graph in Chromium on the IDR0076 fixture crop, asserts the 384-dim finite embedding, channel-last names, model id/revision provenance in the downloaded JSON, and that no page errors occur.

## Exporting the ONNX graph (reproducibility)

`public/models/morphem-vit.onnx` is gitignored, but no longer needs to exist before setup. Run:

```bash
npm run setup:morphem
# npm run setup:assets also invokes the same provisioning path.
```

With an existing valid model, setup only verifies its size and SHA-256 and writes its provenance JSON; Python and network access are unnecessary. If the model is missing, setup invokes `scripts/export-morphem.py` with **Python >=3.10, standard library only**. No uv, pip, torch, ONNX package or model publication is required. Set `MORPHEM_PYTHON` if the interpreter is not named `python3`.

The original graph was exported with PyTorch 2.15.0, opset 18 and a dynamic batch axis, then inlined into one ONNX file. Re-running an unpinned exporter can change its bytes even when inference is equivalent. Instead, the durable export input is `scripts/morphem-vit.recipe.json.gz`: a **46,163-byte weight-free recipe**, containing the exact original serialized graph, small constants and metadata, with the 150 learned tensor payloads removed. Provisioning restores those tensors from the published safetensors; 48 matrices are transposed as 32-bit words without floating-point conversion. The classifier head is not copied. This preserves the original graph byte-for-byte across Python/exporter environments, with no large vendored model or external-data sidecar.

The integrity chain is pinned independently:

| Input/output                                                                        |       Bytes | SHA-256                                                            |
| ----------------------------------------------------------------------------------- | ----------: | ------------------------------------------------------------------ |
| Upstream `model.safetensors` at revision `0e8d58787421f83f975634d72420d85c5dfc9c2c` | 175,299,208 | `1609131fe5720d3a11ccbb802ef1c0b2cdd1e21e9628f6d2660607d1c4a1431e` |
| Vendored graph recipe                                                               |      46,163 | `246f42e6fcff24dd1f8247adcf14b662487230a2571157570ccb8f167b55753c` |
| Final `morphem-vit.onnx`                                                            |  86,216,588 | `819132f2ef159e04e718bdf7c9e83a1e30f81cd305ca1ff299d74c5a6a9cec31` |

Missing upstream weights are downloaded over HTTPS from the pinned HuggingFace revision, verified before use, and cached under `${XDG_CACHE_HOME:-$HOME/.cache}/musivarium/morphem/<revision>/`. Both downloaded weights and generated output use temporary files followed by replacement only after verification. Existing corrupt model files fail closed rather than being silently replaced. Output is accepted only after matching the pinned final byte count and SHA-256; Node verifies it again before writing provenance.

For offline provisioning from an already downloaded, pinned safetensors file:

```bash
MORPHEM_WEIGHTS=/path/to/model.safetensors npm run setup:morphem
# Or generate into a separate directory without touching the app's model:
python3 scripts/export-morphem.py \
  --weights /path/to/model.safetensors \
  --output /path/to/scratch/morphem-vit.onnx
```

The recipe is derived from real graph bytes, not synthesized inference results. To audit/recreate it from the original pinned inline export, write to a new path:

```bash
python3 scripts/export-morphem.py \
  --weights /path/to/model.safetensors \
  --freeze-from /path/to/original/morphem-vit.onnx \
  --recipe-output /path/to/scratch/morphem-vit.recipe.json.gz
```

That maintenance command verifies the original ONNX hash and checks every removed tensor against the upstream weights before emitting the recipe. Compression-library differences may change the compressed recipe hash; the generated ONNX must still match the original full hash. Do not change the final model pin to accommodate a provisioning mismatch.

**Verified locally on macOS**: missing-output generation using existing pinned weights, and a separate cold-cache download-and-generation path, both reproduced the exact original 86,216,588-byte graph and full SHA-256 above. This is not a claim that a clean Ubuntu GitHub Actions job has run. CI/Pages still require Python >=3.10 and outbound access to HuggingFace on a cold cache; their existing workflow triggers and publication steps are unchanged.

## Limits

- The export was validated against the published Python architecture, not against the full HuggingFace `trust_remote_code` loading path; embeddings are expected to match a PyTorch MorphEm run given identical inputs, but formal CHAMMI benchmark parity was not re-established here.
- Crop size relative to CHAMMI training scales is a modelling choice; the app resizes the object-centred crop (its `cropSize` setting) to 224 × 224. Crowding/containment metadata is not yet recorded with each embedding.
- The saturation-noise seed differs from any given Python run's random draw; compare distributions, not individual runs, against Python-generated features.
- Embeddings are exploratory descriptors for the demo; they are not validated single-cell phenotypes.
