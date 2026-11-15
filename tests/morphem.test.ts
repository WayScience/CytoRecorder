import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  embedMorphEm,
  rescaleToSaturation8,
  injectSaturationNoise,
  instanceNormalize,
  resizeBilinear,
  MORPHEM_MODEL_INFO,
} from '../src/features/morphem';

describe('saturation-safe 8-bit rescale', () => {
  it('maps 16-bit crops so only the true maximum becomes 255', () => {
    const out = rescaleToSaturation8(Uint16Array.from([0, 1000, 2000, 4000]));
    expect([...out]).toEqual([0, 63, 127, 255]);
  });
  it('passes uint8 input through unchanged', () => {
    const input = Uint8Array.from([0, 25, 200, 255]);
    expect([...rescaleToSaturation8(input)]).toEqual([...input]);
  });
  it('rejects negative and nonfinite intensities; all-zero stays zero', () => {
    expect(() => rescaleToSaturation8(Float32Array.from([-4, -1]))).toThrow(/Negative/);
    expect(() => rescaleToSaturation8(Float32Array.from([NaN]))).toThrow(/finite/);
    expect([...rescaleToSaturation8(Float32Array.from([0, 0]))]).toEqual([0, 0]);
  });
});

describe('seeded saturation noise', () => {
  it('replaces exactly the 255 pixels deterministically and leaves the rest', () => {
    const input = Uint8Array.from([10, 255, 255, 42]);
    const a = injectSaturationNoise(input, 7);
    const b = injectSaturationNoise(input, 7);
    expect([...a]).toEqual([...b]);
    expect(a[0]).toBe(10);
    expect(a[3]).toBe(42);
    expect(a[1]).not.toBe(255);
    expect(a[2]).not.toBe(255);
    expect(a[1]).toBeGreaterThanOrEqual(0);
    expect(a[1]).toBeLessThan(255);
    const c = injectSaturationNoise(input, 8);
    expect(c[1]).not.toBe(a[1]);
  });
});

describe('instance normalization and resize', () => {
  it('instance-norms to ~zero mean and unit variance', () => {
    const out = instanceNormalize(Float32Array.from([1, 2, 3, 6]));
    const mean = out.reduce((s, v) => s + v, 0) / out.length;
    const variance = out.reduce((s, v) => s + (v - mean) ** 2, 0) / out.length;
    expect(mean).toBeCloseTo(0, 5);
    expect(variance).toBeCloseTo(1, 4);
  });
  it('resizes identity when already at target size', () => {
    const input = Float32Array.from([1, 2, 3, 4]);
    expect(resizeBilinear(input, 2, 2, 2)).toBe(input);
  });
  it('bilinear upsample matches torchvision align-corners=False output', () => {
    const input = Float32Array.from([0, 1, 2, 3]);
    const out = resizeBilinear(input, 2, 2, 4);
    // Full expected grid, hand-derived (and cross-checked against
    // torchvision's documented align-corners=False mapping).
    expect([...out]).toEqual(
      [0, 0.25, 0.75, 1, 0.5, 0.75, 1.25, 1.5, 1.5, 1.75, 2.25, 2.5, 2, 2.25, 2.75, 3].map((v) =>
        Math.fround(v),
      ),
    );
  });
});

describe('MorphEm WASM inference against the independent torch reference', () => {
  const modelPath = resolve('public/models/morphem-vit.onnx');
  it.runIf(existsSync(modelPath))(
    'real WASM graph reproduces the torch CLS embedding on the oracle input',
    async () => {
      // Identical synthetic crop to the torch oracle run: 224x224, float
      // ramp in [40,180). The oracle applies the exact app transform
      // (8-bit saturation rescale -> seeded noise -> instance norm), so the
      // oracle embedding below is the expected full-pipeline output.
      const size = 224;
      const raw = new Float32Array(size * size);
      for (let y = 40; y < 180; y++)
        for (let x = 40; x < 180; x++) raw[y * size + x] = (x - 40) * 2.0;
      // Torch oracle through the identical app transform (published weights):
      const reference = [5.888006, 0.736917, -5.497053, -0.401972, -0.398346];
      const result = await embedMorphEm(
        {
          x: 0,
          y: 0,
          width: size,
          height: size,
          channels: [raw as unknown as Parameters<typeof embedMorphEm>[0]['channels'][number]],
        },
        { modelBytes: new Uint8Array(readFileSync(modelPath)) },
      );
      expect(result.embeddings).toHaveLength(1);
      expect(result.embeddings[0]!.length).toBe(MORPHEM_MODEL_INFO.embedDim);
      for (const [i, expected] of reference.entries())
        expect(result.embeddings[0]![i]).toBeCloseTo(expected, 4);
      // Same crop through the full production transform must stay deterministic
      // across repeated runs (seeded saturation noise).
      const crop = {
        x: 0,
        y: 0,
        width: size,
        height: size,
        channels: [raw as unknown as Parameters<typeof embedMorphEm>[0]['channels'][number]],
      };
      const first = await embedMorphEm(crop, {
        modelBytes: new Uint8Array(readFileSync(modelPath)),
      });
      const second = await embedMorphEm(crop, {
        modelBytes: new Uint8Array(readFileSync(modelPath)),
      });
      for (let i = 0; i < first.embeddings[0]!.length; i++)
        expect(first.embeddings[0]![i]).toBe(second.embeddings[0]![i]);
      expect(first.modelId).toBe('morphem-vit-819132f2');
      expect(first.featureNames.slice(0, 2)).toEqual([
        'MorphEm_Feature0_Channel0',
        'MorphEm_Feature1_Channel0',
      ]);
    },
    180_000,
  );
});
