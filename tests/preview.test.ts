import { expect, it } from 'vitest';
import {
  planWholeImagePreview,
  fetchWholeImagePreview,
  PREVIEW_PIXEL_BUDGET,
} from '../src/preview';
import type { Alignment } from '../src/sources/metadata';
import type { ImageSource } from '../src/sources/types';

const alignment = (axes: string[], shape: number[]): Alignment => ({
  axes,
  shape,
  scale: axes.map(() => 1),
  translation: axes.map(() => 0),
});

it('clamps out-of-range z/t and drops channels absent at the coarsest level', () => {
  const plan = planWholeImagePreview(alignment(['t', 'c', 'z', 'y', 'x'], [2, 3, 4, 256, 384]), {
    z: 10,
    t: 5,
    channels: [0, 2, 5],
  });
  expect(plan).toEqual({ width: 384, height: 256, z: 3, t: 1, channels: [0, 2] });
});

it('returns undefined when the coarsest level still exceeds the pixel budget', () => {
  // width * height is one pixel over budget.
  const side = Math.ceil(Math.sqrt(PREVIEW_PIXEL_BUDGET)) + 1;
  const plan = planWholeImagePreview(alignment(['y', 'x'], [side, side]), {
    z: 0,
    t: 0,
    channels: [0],
  });
  expect(plan).toBeUndefined();
});

it('returns undefined when none of the requested channels exist at this level', () => {
  const plan = planWholeImagePreview(alignment(['c', 'y', 'x'], [3, 64, 64]), {
    z: 0,
    t: 0,
    channels: [9],
  });
  expect(plan).toBeUndefined();
});

it('defaults z/t/channel to 0 when the image has no z, t or c axis', () => {
  const plan = planWholeImagePreview(alignment(['y', 'x'], [64, 128]), {
    z: 7,
    t: 3,
    channels: [0],
  });
  expect(plan).toEqual({ width: 128, height: 64, z: 0, t: 0, channels: [0] });
});

/** Fake ImageSource with a full-resolution level 0 too large for a preview
 * and a small coarsest level, so a correct implementation must pick the
 * coarsest level rather than the level the main run happened to sample at. */
function fakeSource(): ImageSource {
  const levels: Record<number, Alignment> = {
    0: alignment(['c', 'y', 'x'], [2, 4096, 4096]),
    1: alignment(['c', 'y', 'x'], [2, 32, 48]),
  };
  return {
    metadata: {
      axes: [{ name: 'c' }, { name: 'y' }, { name: 'x' }],
      levels: [
        { path: '0', scale: [1, 1, 1], translation: [0, 0, 0] },
        { path: '1', scale: [1, 2, 2], translation: [0, 0, 0] },
      ],
      channels: [
        { name: 'DNA', color: 'FFFFFF' },
        { name: 'GFP', color: '00FF00' },
      ],
      labels: [],
      version: '0.5',
    },
    stats: { requests: 0, bytes: 0, cacheHits: 0, objects: [] },
    alignment: async (level) => levels[level]!,
    readRegion: async (level, r) => {
      const pixels = new Uint16Array(r.width * r.height);
      pixels.fill(100 * level + 10 * r.channel + 1);
      return pixels;
    },
  };
}

it('reads the coarsest pyramid level, not the level the main run sampled at', async () => {
  const preview = await fetchWholeImagePreview(fakeSource(), { z: 0, t: 0, channels: [0, 1] });
  expect(preview).toEqual({
    width: 48,
    height: 32,
    z: 0,
    t: 0,
    channels: [0, 1],
    pixels: [new Uint16Array(32 * 48).fill(101), new Uint16Array(32 * 48).fill(111)],
  });
});

it('returns undefined end to end when even the coarsest level is too large', async () => {
  const source = fakeSource();
  source.metadata.levels = [source.metadata.levels[0]!];
  const preview = await fetchWholeImagePreview(source, { z: 0, t: 0, channels: [0] });
  expect(preview).toBeUndefined();
});
