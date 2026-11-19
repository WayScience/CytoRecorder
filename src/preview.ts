import type { Alignment } from './sources/metadata';
import type { ImageSource } from './sources/types';
import type { Pixels } from './core';
/** A whole-image preview is only worth fetching when a single read covers it;
 * larger coarsest levels (e.g. a custom single-resolution image) are skipped
 * rather than triggering a surprise full-resolution download. */
export const PREVIEW_PIXEL_BUDGET = 1_048_576; // 1024 x 1024
export interface PreviewPlan {
  width: number;
  height: number;
  z: number;
  t: number;
  channels: number[];
}
/** Decides whether the coarsest available pyramid level is small enough for
 * a lightweight whole-image preview, and clamps the requested plane/channels
 * to what that level actually has. */
export function planWholeImagePreview(
  alignment: Alignment,
  requested: { z: number; t: number; channels: number[] },
): PreviewPlan | undefined {
  const { axes, shape } = alignment,
    xi = axes.indexOf('x'),
    yi = axes.indexOf('y');
  if (xi < 0 || yi < 0) return undefined;
  const width = shape[xi]!,
    height = shape[yi]!;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width * height > PREVIEW_PIXEL_BUDGET)
    return undefined;
  const zi = axes.indexOf('z'),
    ti = axes.indexOf('t'),
    ci = axes.indexOf('c');
  const z = zi < 0 ? 0 : Math.min(Math.max(requested.z, 0), shape[zi]! - 1),
    t = ti < 0 ? 0 : Math.min(Math.max(requested.t, 0), shape[ti]! - 1),
    channelCount = ci < 0 ? 1 : shape[ci]!;
  const channels = requested.channels.filter((c) => c >= 0 && c < channelCount);
  if (!channels.length) return undefined;
  return { width, height, z, t, channels };
}
export interface WholeImagePreview extends PreviewPlan {
  pixels: Pixels[];
}
/** Always reads the COARSEST available pyramid level, independent of the
 * level the main run happened to sample at, so this stays a lightweight
 * overview rather than repeating a full-resolution read. */
export async function fetchWholeImagePreview(
  source: ImageSource,
  requested: { z: number; t: number; channels: number[] },
): Promise<WholeImagePreview | undefined> {
  const level = source.metadata.levels.length - 1,
    alignment = await source.alignment(level),
    plan = planWholeImagePreview(alignment, requested);
  if (!plan) return undefined;
  const pixels = await Promise.all(
    plan.channels.map((channel) =>
      source.readRegion(level, {
        x: 0,
        y: 0,
        width: plan.width,
        height: plan.height,
        z: plan.z,
        t: plan.t,
        channel,
      }),
    ),
  );
  return { ...plan, pixels };
}
