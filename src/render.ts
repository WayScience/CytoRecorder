import { normalize, contrastLimits, random, type Pixels } from './core';
import type { Cell } from './pipeline';
const UNIT_ABBREVIATIONS: Record<string, string> = {
  angstrom: 'Å',
  attometer: 'am',
  centimeter: 'cm',
  decimeter: 'dm',
  exameter: 'Em',
  femtometer: 'fm',
  foot: 'ft',
  gigameter: 'Gm',
  hectometer: 'hm',
  inch: 'in',
  kilometer: 'km',
  megameter: 'Mm',
  meter: 'm',
  micrometer: 'µm',
  mile: 'mi',
  millimeter: 'mm',
  nanometer: 'nm',
  parsec: 'pc',
  petameter: 'Pm',
  picometer: 'pm',
  terameter: 'Tm',
  yard: 'yd',
  yoctometer: 'ym',
  yottameter: 'Ym',
  zeptometer: 'zm',
  zettameter: 'Zm',
};
/** Nearest 1/2/5 × 10^n step at or below target, the usual scale-bar convention. */
function niceScaleBarLength(target: number): number {
  const exponent = Math.floor(Math.log10(target)),
    base = target / 10 ** exponent,
    nice = base < 1.5 ? 1 : base < 3.5 ? 2 : base < 7.5 ? 5 : 10;
  return nice * 10 ** exponent;
}
/** Draws only when the source NGFF metadata calibrated a real physical unit; a
 * bare pixel grid (no `unit`, or `unit: 'pixel'`) gets no fabricated scale bar. */
function drawScaleBar(
  context: CanvasRenderingContext2D,
  size: number,
  cell: Cell,
  pxPerUnit: number,
) {
  if (!cell.unit || cell.unit === 'pixel' || !Number.isFinite(pxPerUnit) || pxPerUnit <= 0) return;
  const length = niceScaleBarLength((size * 0.35) / pxPerUnit),
    barPx = length * pxPerUnit;
  if (!Number.isFinite(barPx) || barPx < 4) return;
  const label = `${length} ${UNIT_ABBREVIATIONS[cell.unit] ?? cell.unit}`,
    marginRight = Math.max(10, size * 0.045),
    marginBottom = Math.max(16, size * 0.08),
    lineWidth = Math.max(2.5, size * 0.014),
    fontSize = Math.max(11, Math.round(size * 0.065)),
    xEnd = size - marginRight,
    xStart = xEnd - barPx,
    y = size - marginBottom - lineWidth / 2;
  context.save();
  context.lineWidth = lineWidth;
  context.strokeStyle = '#ffffff';
  context.beginPath();
  context.moveTo(xStart, y);
  context.lineTo(xEnd, y);
  context.stroke();
  context.font = `bold ${fontSize}px sans-serif`;
  context.textBaseline = 'bottom';
  context.textAlign = 'right';
  context.fillStyle = '#ffffff';
  context.fillText(label, xEnd, y - lineWidth);
  context.restore();
}
export function composite(
  channels: Pixels[],
  width: number,
  height: number,
  colors: string[],
  limits?: [number, number][],
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba[i * 4 + 3] = 255;
  channels.forEach((channel, c) => {
    const range = limits?.[c] ?? contrastLimits(channel),
      normalized = normalize(channel, ...range),
      color = colors[c] ?? 'FFFFFF',
      rgb = [0, 2, 4].map((start) => parseInt(color.slice(start, start + 2), 16));
    for (let i = 0; i < channel.length; i++)
      for (let j = 0; j < 3; j++)
        rgba[i * 4 + j] = Math.min(255, rgba[i * 4 + j] + (normalized[i] * rgb[j]) / 255);
  });
  return rgba;
}
export function outline(
  mask: Uint32Array,
  width: number,
  height: number,
  label: number,
): Uint8Array {
  const edges = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (
        mask[i] === label &&
        (x === 0 ||
          y === 0 ||
          x === width - 1 ||
          y === height - 1 ||
          mask[i - 1] !== label ||
          mask[i + 1] !== label ||
          mask[i - width] !== label ||
          mask[i + width] !== label)
      )
        edges[i] = 1;
    }
  return edges;
}
export function seededOrder<T>(records: T[], seed: string): T[] {
  const a = [...records],
    rng = random(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export interface DisplayOptions {
  context?: boolean;
  limits?: [number, number][];
}
export function drawCrop(
  canvas: HTMLCanvasElement,
  cell: Cell,
  colors: string[],
  overlay: boolean,
  size: number,
  options: DisplayOptions = {},
) {
  const { crop } = cell;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#050505';
  context.fillRect(0, 0, size, size);
  const pixels = composite(crop.channels, crop.width, crop.height, colors, options.limits);
  if (options.context === false)
    for (let i = 0; i < cell.mask.length; i++)
      if (cell.mask[i] !== cell.label) {
        pixels[i * 4] = 0;
        pixels[i * 4 + 1] = 0;
        pixels[i * 4 + 2] = 0;
      }
  if (overlay) {
    const edges = outline(cell.mask, crop.width, crop.height, cell.label);
    for (let i = 0; i < edges.length; i++)
      if (edges[i]) {
        pixels[i * 4] = 0;
        pixels[i * 4 + 1] = 255;
        pixels[i * 4 + 2] = 0;
      }
  }
  const buffer = document.createElement('canvas');
  buffer.width = crop.width;
  buffer.height = crop.height;
  buffer
    .getContext('2d')!
    .putImageData(new ImageData(new Uint8ClampedArray(pixels), crop.width, crop.height), 0, 0);
  const physicalWidth = crop.width * cell.scale_x,
    physicalHeight = crop.height * cell.scale_y,
    scale = (size - 12) / Math.max(physicalWidth, physicalHeight),
    w = physicalWidth * scale,
    h = physicalHeight * scale;
  context.imageSmoothingEnabled = false;
  context.drawImage(buffer, (size - w) / 2, (size - h) / 2, w, h);
  drawScaleBar(context, size, cell, scale);
}
