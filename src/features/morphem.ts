import type { Pixels } from '../core';
import type { Crop } from '../core';

import { MORPHEM_MODEL_INFO, MORPHEM_REVISION, MORPHEM_MODEL_ID } from './config';
export { MORPHEM_MODEL_INFO, MORPHEM_MODEL_ID } from './config';

export interface MorphEmOptions {
  /** App-root URL supplied by the main-thread client to the worker. */
  assetBase?: string;
  signal?: AbortSignal;
  /** For offline/test callers. Integrity is checked just like bundled weights. */
  modelBytes?: Uint8Array;
}
export interface MorphEmFeatureResult {
  modelId: string;
  modelRevision: string;
  /** One 384-dim embedding per input channel, in channel order. */
  embeddings: Float32Array[];
  /** Channel-last feature names as the pycytominer ecosystem expects. */
  featureNames: string[];
  cropWidth: number;
  cropHeight: number;
  ms: number;
}

function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('MorphEm featurization cancelled', 'AbortError');
}

/**
 * Per-crop 8-bit rescale with camera-saturation semantics (MorphEm rule):
 * only true saturated pixels may become 255; everything else maps to [0, 254].
 * A 16-bit crop is rescaled by its maximum so saturated pixels land on 255.
 * Uint8 input is passed through unchanged (its 255s are its own saturation).
 */
export function rescaleToSaturation8(pixels: Pixels): Uint8Array {
  let max = -Infinity,
    min = Infinity;
  for (const p of pixels) {
    if (!Number.isFinite(p)) throw new Error('All intensities must be finite');
    if (p > max) max = p;
    if (p < min) min = p;
  }
  if (max < 0) throw new Error('Negative intensities cannot be saturation-rescaled');
  const out = new Uint8Array(pixels.length);
  if (pixels instanceof Uint8Array) {
    out.set(pixels);
    return out;
  }
  if (max === 0) return out;
  const scale = 255 / max;
  for (let i = 0; i < pixels.length; i++) {
    const v = Math.min(254, Math.floor(pixels[i]! * scale));
    out[i] = pixels[i]! >= max ? 255 : v;
  }
  return out;
}

/** Instance norm (per-image mean/std) as in the MorphEm transform stack. */
export function instanceNormalize(pixels: Float32Array): Float32Array {
  let sum = 0;
  for (const p of pixels) sum += p;
  const mean = sum / pixels.length;
  let variance = 0;
  for (const p of pixels) variance += (p - mean) ** 2;
  variance /= pixels.length;
  const std = Math.sqrt(variance) + 1e-6;
  return Float32Array.from(pixels, (p) => (p - mean) / std);
}

/** Bilinear resize matching torchvision's align-corners=False border behaviour. */
export function resizeBilinear(
  pixels: Float32Array,
  width: number,
  height: number,
  size: number,
): Float32Array {
  if (width === size && height === size) return pixels;
  const out = new Float32Array(size * size);
  const scaleY = height / size,
    scaleX = width / size;
  for (let y = 0; y < size; y++) {
    // Source-space center of the destination pixel; clamped so edges
    // hold the border pixels (torchvision border, not wrap or zero).
    let fy = (y + 0.5) * scaleY - 0.5;
    fy = Math.min(height - 1, Math.max(0, fy));
    const y0 = Math.floor(fy);
    const y1 = Math.min(height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < size; x++) {
      let fx = (x + 0.5) * scaleX - 0.5;
      fx = Math.min(width - 1, Math.max(0, fx));
      const x0 = Math.floor(fx);
      const x1 = Math.min(width - 1, x0 + 1);
      const wx = fx - x0;
      const p00 = pixels[y0 * width + x0]!,
        p01 = pixels[y0 * width + x1]!,
        p10 = pixels[y1 * width + x0]!,
        p11 = pixels[y1 * width + x1]!;
      out[y * size + x] =
        p00 * (1 - wx) * (1 - wy) + p01 * wx * (1 - wy) + p10 * (1 - wx) * wy + p11 * wx * wy;
    }
  }
  return out;
}

/**
 * Deterministic saturation-noise replacement. The MorphEm transform replaces
 * 255 (saturated) pixels with uniform noise in [0, 255); the published pipeline
 * draws that noise randomly, so we seed it here for reproducibility. Crops
 * with no saturated pixels are unaffected.
 */
export function injectSaturationNoise(pixels: Uint8Array, seed = 1234): Uint8Array {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  const next = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = Uint8Array.from(pixels);
  for (let i = 0; i < out.length; i++)
    if (out[i] === 255) out[i] = Math.min(254, Math.floor(next() * 255));
  return out;
}

let sessionPromise: Promise<import('onnxruntime-web').InferenceSession> | undefined;
let sessionKey: string | undefined;

async function loadSession(options: MorphEmOptions) {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  const assetBase =
    options.assetBase ??
    (typeof location !== 'undefined'
      ? new URL(import.meta.env.DEV ? '../../' : '../', import.meta.url).href
      : undefined);
  if (assetBase) ort.env.wasm.wasmPaths = new URL('vendor/', assetBase).href;
  const url = assetBase ? new URL(MORPHEM_MODEL_INFO.url, assetBase).href : MORPHEM_MODEL_INFO.url;
  const key = options.modelBytes ? 'provided-bytes' : url;
  if (!sessionPromise || sessionKey !== key || options.modelBytes) {
    sessionKey = key;
    sessionPromise = (async () => {
      let bytes = options.modelBytes;
      if (!bytes) {
        const response = await fetch(url, { signal: options.signal });
        if (!response.ok) throw new Error(`MorphEm model unavailable (HTTP ${response.status})`);
        bytes = new Uint8Array(await response.arrayBuffer());
      }
      if (bytes.length !== MORPHEM_MODEL_INFO.bytes) throw new Error('MorphEm model size mismatch');
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))),
      ]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (hash !== MORPHEM_MODEL_INFO.sha256) throw new Error('MorphEm model SHA-256 mismatch');
      checkAbort(options.signal);
      return ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
    })();
    sessionPromise.catch(() => {
      sessionPromise = undefined;
      sessionKey = undefined;
    });
  }
  return { ort, session: await sessionPromise };
}

/**
 * Embed one crop with MorphEm: one 384-dim CLS embedding per channel
 * (Bag of Channels). The transform follows the published stack per crop:
 * saturation-safe 8-bit rescale, seeded saturation-noise injection,
 * instance normalization, resize to 224×224.
 */
export async function embedMorphEm(
  crop: Crop,
  options: MorphEmOptions = {},
): Promise<MorphEmFeatureResult> {
  checkAbort(options.signal);
  const started = performance.now();
  const { ort, session } = await loadSession(options);
  checkAbort(options.signal);
  const size = MORPHEM_MODEL_INFO.inputSize;
  const embeddings: Float32Array[] = [];
  const featureNames: string[] = [];
  for (let c = 0; c < crop.channels.length; c++) {
    const channel = crop.channels[c]!;
    const eight = injectSaturationNoise(rescaleToSaturation8(channel));
    const normalized = instanceNormalize(Float32Array.from(eight));
    const resized = resizeBilinear(normalized, crop.width, crop.height, size);
    const tensor = new ort.Tensor('float32', resized, [1, 1, size, size]);
    const outputs = await session.run({ pixel_values: tensor });
    try {
      const embedding = outputs.embedding.data as Float32Array;
      if (embedding.length !== MORPHEM_MODEL_INFO.embedDim)
        throw new Error('Unexpected MorphEm embedding dimension');
      embeddings.push(Float32Array.from(embedding));
      featureNames.push(
        ...Array.from(
          { length: MORPHEM_MODEL_INFO.embedDim },
          (_, i) => `MorphEm_Feature${i}_Channel${c}`,
        ),
      );
    } finally {
      tensor.dispose();
      for (const output of Object.values(outputs)) output.dispose();
    }
    checkAbort(options.signal);
  }
  return {
    modelId: MORPHEM_MODEL_ID,
    modelRevision: MORPHEM_REVISION,
    embeddings,
    featureNames,
    cropWidth: crop.width,
    cropHeight: crop.height,
    ms: performance.now() - started,
  };
}
