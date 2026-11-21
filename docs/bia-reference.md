# Live BioImage Archive discovery and checked examples

Unpinned page loads and **Pull random new image** query the live BIA search API. They are not limited to the three bundled examples. The examples remain available through explicit `?reference=<sample id>` links and supply deterministic scientific regression fixtures.

## Runtime discovery

- Search `/search/v1/search/fts/image` with `query=DAPI`, converted images, fluorescence/confocal methods, human/mouse organisms, single Z/time planes, 1–4 channels and 129–4096-pixel dimensions. These biological/size filters match the current exploratory nuclear model; they are not an accession allowlist. TEM/SEM, simulated images and derived images are excluded.
- The search returns `hits.hits`; `/search/v1/website/doc?uuid=...` returns a different `hits` array. Repeated facet keys are required. `facet.organism.or` is the valid organism filter; unknown parameters may be silently ignored.
- Each pull queries again, picks a random result page, and checks the supplied `.ome.zarr` representation against actual NGFF axes, level shapes, channel names, supported codecs and chunk budgets. Sharded conversions are rejected explicitly. A DAPI full-text hit alone does not prove that every file/channel is nuclear; unidentified multichannel images are skipped.
- Per-tab session storage tracks viewed image IDs and accessions. The next request excludes viewed studies, and client-side checks reject repeated results even if the server ignores exclusions. History is not cleared when search finds no compatible candidate. Storage-denied browsers retain in-memory history until reload.
- Discovery is cancellable and bounded (up to three pages, twelve compatibility attempts and a 60-second overall deadline). Failure keeps the current mosaic/exports and shows an error, never silently substituting a checked example. This is a bounded search, not a guarantee that every archive image is supported or that sampling is globally uniform.
- Successful selection produces an exact source/settings URL. Reloading that URL reproduces the same image; it does not discover another. Image-document lookup restores provenance for shared discovered sources. Ordinary unpinned visits request a fresh discovery.
- Actual live app verification loaded and segmented five consecutive images from five different studies: S-BIAD2247, S-BIAD1294, S-BIAD1323, S-BIAD3027 and S-BIAD2984, with no page errors. This was real cross-origin API/image traffic, not fixture replay. Automated Chromium/Firefox tests additionally replay unchanged API bodies and original NGFF pixels, including a study outside the three examples, no-repeat storage, cancellation, API failure, and root/project-prefix production paths.

## Checked examples (not a discovery pool)

Explicit example URLs remain stable for sharing/testing. Their original qualifications are retained below.

| Sample id            | Study      | Biology                                                    | Qualified  |
| -------------------- | ---------- | ---------------------------------------------------------- | ---------- |
| `bia3204-ring-rep2`  | S-BIAD3204 | Human U2OS, G3BP1/2 knockout + GFP-MKRN2 RING, heat stress | 2026-11-13 |
| `bia2247-tpr-nih3t3` | S-BIAD2247 | Mouse NIH3T3 expressing TPR*-mRFP and Nup153-GFP           | 2026-11-14 |
| `bia1735-dsb-nuclei` | S-BIAD1735 | Human nuclei, 2018 Data Science Bowl subset                | 2026-11-14 |

## Checked S-BIAD3204 example: biology and attribution

- Study: [S-BIAD3204](https://www.ebi.ac.uk/biostudies/bioimages/studies/S-BIAD3204), Amzallag et al., CC0.
- Image ID: `556d7ebf-98db-450a-a58d-23fe2379fefb`.
- Original file: `BioImage study components/MKRN2 RING vs WT/RING_Rep2.czi`.
- Human U2OS cells, G3BP1/2 knockout expressing G3BP1-mCherry, heat-stressed, with a GFP-MKRN2 RING variant. The study examines protein quality control in stress granules.
- Confocal channels, in original order: `mCher-T1` (G3BP1-mCherry), `EGFP-T2` (GFP-MKRN2), `DAPI-T3` (nuclear stain). These are not three different cell populations. The app currently displays their grayscale composite, not their metadata colours.
- Publication: [The E3 ligase MKRN2 prevents DRiP accumulation in stress granules and maintains granulostasis](https://doi.org/10.1038/s44319-026-00832-2). The published Data Availability explicitly names S-BIAD3204. The API's empty publication array is not used as evidence for this link.

The organism, specimen/condition, modality, markers, study, publication and license appear above the mosaic, with settings collapsed. The actual selected channels, pyramid level, Z and time indices appear after metadata loading. Custom images do not inherit these claims.

## API discovery

[OpenAPI schema](https://beta.bioimagearchive.org/search/openapi.json) and [hosted API documentation](https://beta.bioimagearchive.org/search/redoc).

The original manual discovery request for the checked S-BIAD3204 example was:

```text
https://beta.bioimagearchive.org/search/v1/search/fts/image?query=U2OS&has.converted_image=True&size_x.lt=2049&size_y.lt=2049&size_c.gt=1&size_z.lt=2&size_t.lt=2&pagination.page_size=100
```

[Exact per-image API metadata](https://beta.bioimagearchive.org/search/v1/website/doc?uuid=556d7ebf-98db-450a-a58d-23fe2379fefb). The response wraps the image in `hits`; retain the image ID and original file identity when displaying provenance. Runtime discovery uses the live search and qualification process above. Unknown search parameters may be ignored: the text-search parameter is `query`, not `fts_query`.

Pinned image-group URL:

```text
https://livingobjects.ebi.ac.uk/bioimaging-integrator-data/S-BIAD3204/556d7ebf-98db-450a-a58d-23fe2379fefb/cfc5cb9b-e8d3-4ebc-bf0f-7bbd57d7341d.ome.zarr/0/
```

The trailing `/0/` identifies the image group; the selected pyramid array is `/0/2/` relative to the `.ome.zarr` root. This URL is fixed, not a promise that externally hosted data can never change.

## Checked S-BIAD3204 example: browser qualification and limits

- NGFF 0.4 / Zarr 2, TCZYX, uint8, Blosc-LZ4; full resolution `[1, 3, 1, 1437, 1437]`.
- Default: pyramid level 2, `[1, 3, 1, 359, 359]`, Z=0, T=0, all three display channels, DAPI channel 2 for segmentation. It reads all three complete planes at this small level, not a partial large field or a 3D volume.
- One 512-pixel sampling region clipped to 359 × 359; 64-pixel minimum crops, target 10 objects. The selected-level pixel scale is 0.28229004429421967 µm. Areas remain selected-level pixels², not level-0 pixels².
- An actual project-prefix production build read the remote chunks through DuckDB-Wasm/Zarr, ran the real StarDist ONNX model and produced 10 crops in Chromium 158.0.8127.18. Image metadata plus compressed pixels totalled 247,906 bytes; runtime/model downloads are additional. Desktop and 390-pixel mobile layouts had no horizontal overflow or browser errors.
- There are no archive-supplied instance labels. StarDist predictions are exploratory nuclei, not verified cells, granule masks, ground truth, or a quantitative result from the study. Coarse-level inference is explicitly warned about. Model counts and masks are not biologically validated.
- Both Chromium and Firefox regression tests use byte-for-byte captured metadata and compressed image chunks, with real DuckDB-Zarr decoding and StarDist inference. The example-specific tests block runtime API discovery. Separate discovery fixtures and root and repository-prefix production smoke checks exercise a returned new study, as well as the checked example and previous IDR workflow.
- Independent Python numcodecs 0.15.0 decodes each complete 359 × 359 channel; browser tests compare all native pixel SHA-256 hashes. No microscopy is synthesized for these tests.
- Physical microphones, Safari, and hosted-origin operation of these uncommitted changes have not been checked.

## Reproduce checks

```sh
node scripts/setup-browser-fixtures.mjs
# Optional live refresh: download only if every pinned body still matches.
node scripts/setup-browser-fixtures.mjs --download
uv run scripts/validate-bia-reference.py
npx playwright test tests/browser/bia-reference.spec.ts tests/browser/bia-pixels.spec.ts
npm run test:static
```

The fixture manifest records the original URLs, entity-body lengths and hashes. `expected.json` contains independently decoded native-plane hashes. The validator checks them without rewriting them. A changed remote object fails rather than silently refreshing expected scientific data or switching images.

The older IDR0076 label reference and IDR0033 Cell Painting image remain selectable. Existing complete share links retain their settings; source-only links to the previous IDR reference retain its channel/label defaults. Legacy regression tests now use explicit IDR settings rather than depending on whichever image is the app's current reference.
