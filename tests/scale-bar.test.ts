import { afterEach, expect, it, vi } from 'vitest';
import { drawCrop } from '../src/render';
import type { Cell } from '../src/pipeline';

afterEach(() => vi.unstubAllGlobals());

function fakeContext() {
  const calls: Record<string, unknown[][]> = {};
  const record = (name: string) => (calls[name] ??= []);
  return {
    context: {
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textBaseline: '',
      imageSmoothingEnabled: true,
      fillRect: (...args: unknown[]) => record('fillRect').push(args),
      drawImage: (...args: unknown[]) => record('drawImage').push(args),
      save: (...args: unknown[]) => record('save').push(args),
      restore: (...args: unknown[]) => record('restore').push(args),
      beginPath: (...args: unknown[]) => record('beginPath').push(args),
      moveTo: (...args: unknown[]) => record('moveTo').push(args),
      lineTo: (...args: unknown[]) => record('lineTo').push(args),
      stroke: (...args: unknown[]) => record('stroke').push(args),
      strokeText: (...args: unknown[]) => record('strokeText').push(args),
      fillText: (...args: unknown[]) => record('fillText').push(args),
    },
    calls,
  };
}

function stubCanvas() {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ putImageData: () => {} }) }),
  });
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(..._args: unknown[]) {}
    },
  );
}

function cropCell(overrides: Partial<Cell> = {}): Cell {
  return {
    crop: { width: 100, height: 100, channels: [new Uint16Array(10000)] },
    scale_x: 0.5,
    scale_y: 0.5,
    label: 1,
    mask: new Uint32Array(10000).fill(1),
    ...overrides,
  } as unknown as Cell;
}

it('draws a white scale bar at the bottom-right, sized from real NGFF physical pixel calibration', () => {
  stubCanvas();
  const { context, calls } = fakeContext();
  drawCrop(
    { getContext: () => context } as unknown as HTMLCanvasElement,
    cropCell({ unit: 'micrometer' } as Partial<Cell>),
    ['FFFFFF'],
    false,
    200,
  );
  expect(calls.fillText).toHaveLength(1);
  expect(calls.fillText![0]![0]).toBe('20 µm');
  const marginRight = Math.max(10, 200 * 0.045),
    pxPerUnit = (200 - 12) / 50,
    barPx = 20 * pxPerUnit,
    xEnd = 200 - marginRight;
  // Right-anchored: both the label and the bar end at the same right margin.
  expect(calls.fillText![0]![1]).toBeCloseTo(xEnd, 1);
  expect(calls.lineTo![0]![0]).toBeCloseTo(xEnd, 1);
  expect(calls.moveTo![0]![0]).toBeCloseTo(xEnd - barPx, 1);
  expect(context.strokeStyle).toBe('#ffffff');
  expect(context.fillStyle).toBe('#ffffff');
  expect(context.font).toBe('bold 13px sans-serif');
});

it('sits inset from the bottom-right corner rather than flush against it', () => {
  stubCanvas();
  const { context, calls } = fakeContext();
  drawCrop(
    { getContext: () => context } as unknown as HTMLCanvasElement,
    cropCell({ unit: 'micrometer' } as Partial<Cell>),
    ['FFFFFF'],
    false,
    200,
  );
  const barY = calls.lineTo![0]![1] as number,
    barRightX = calls.lineTo![0]![0] as number;
  // Vertically well clear of the bottom edge (more "north" than the horizontal inset is "west").
  expect(200 - barY).toBeGreaterThan(200 - barRightX);
  expect(200 - barY).toBeGreaterThan(10);
  expect(200 - barRightX).toBeGreaterThan(5);
});

it('scales the scale bar label and stroke weight up with a larger displayed image', () => {
  stubCanvas();
  const small = fakeContext();
  drawCrop(
    { getContext: () => small.context } as unknown as HTMLCanvasElement,
    cropCell({ unit: 'micrometer' } as Partial<Cell>),
    ['FFFFFF'],
    false,
    90,
  );
  const big = fakeContext();
  drawCrop(
    { getContext: () => big.context } as unknown as HTMLCanvasElement,
    cropCell({ unit: 'micrometer' } as Partial<Cell>),
    ['FFFFFF'],
    false,
    900,
  );
  const fontSize = (f: string) => Number(/(\d+)px/.exec(f)![1]);
  expect(fontSize(big.context.font)).toBeGreaterThan(fontSize(small.context.font));
  expect(big.context.lineWidth).toBeGreaterThan(small.context.lineWidth);
});

it('draws no scale bar for an uncalibrated pixel grid', () => {
  stubCanvas();
  const { context, calls } = fakeContext();
  drawCrop(
    { getContext: () => context } as unknown as HTMLCanvasElement,
    cropCell({ unit: 'pixel' } as Partial<Cell>),
    ['FFFFFF'],
    false,
    200,
  );
  expect(calls.fillText).toBeUndefined();
});

it('draws no scale bar when metadata never supplied a unit at all', () => {
  stubCanvas();
  const { context, calls } = fakeContext();
  drawCrop(
    { getContext: () => context } as unknown as HTMLCanvasElement,
    cropCell(),
    ['FFFFFF'],
    false,
    200,
  );
  expect(calls.fillText).toBeUndefined();
});
