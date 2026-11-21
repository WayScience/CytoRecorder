import { expect, it } from 'vitest';
import {
  createQualityLabel,
  DEFAULT_QUALITY_CATEGORIES,
  exportQualityLabelsCsv,
  qualityLabelId,
  validateQualityLabel,
} from '../src/quality/store';

// IndexedDB persistence (QualityLabelStore) is exercised in a real browser in
// tests/browser/quality-labels.spec.ts, matching how voice/notes-store.ts's
// NotesStore is tested — jsdom has no real IndexedDB to validate against.

it('exposes Good / Out-of-focus / Debris as the default categories from the issue', () => {
  expect(DEFAULT_QUALITY_CATEGORIES).toEqual(['Good', 'Out-of-focus', 'Debris']);
});

it('derives a composite id from image path and annotator so independent annotators never collide', () => {
  const a = createQualityLabel('plate1/wellA1.tif', 'Bandicoot', 'Alice', 'Good'),
    b = createQualityLabel('plate1/wellA1.tif', 'Bandicoot', 'Bob', 'Debris');
  expect(a.id).not.toBe(b.id);
  expect(a.id).toBe(qualityLabelId('plate1/wellA1.tif', 'Alice'));
});

it('resuming the same (image, annotator) preserves createdAt but bumps updatedAt', () => {
  const first = createQualityLabel('img.png', 'proj', 'Alice', 'Good'),
    second = createQualityLabel('img.png', 'proj', 'Alice', 'Out-of-focus', first);
  expect(second.id).toBe(first.id);
  expect(second.createdAt).toBe(first.createdAt);
  expect(Date.parse(second.updatedAt)).toBeGreaterThanOrEqual(Date.parse(first.updatedAt));
  expect(second.qualityLabel).toBe('Out-of-focus');
});

it('trims project and annotator, and is independently keyed per annotator', () => {
  const record = createQualityLabel('img.png', '  Bandicoot  ', '  Alice  ', 'Good');
  expect(record.project).toBe('Bandicoot');
  expect(record.annotator).toBe('Alice');
  expect(record.id).toBe(qualityLabelId('img.png', 'Alice'));
});

it('rejects a record whose id does not match its own image path and annotator', () => {
  const record = createQualityLabel('a.png', 'p', 'Alice', 'Good');
  expect(() => validateQualityLabel({ ...record, id: 'tampered' })).toThrow(/id does not match/);
});

it('rejects an empty quality label or annotator', () => {
  const record = createQualityLabel('a.png', 'p', 'Alice', 'Good');
  expect(() => validateQualityLabel({ ...record, qualityLabel: '' })).toThrow();
  expect(() => validateQualityLabel({ ...record, annotator: '' })).toThrow();
});

it('rejects an updatedAt earlier than createdAt', () => {
  const record = createQualityLabel('a.png', 'p', 'Alice', 'Good');
  expect(() => validateQualityLabel({ ...record, createdAt: '2030-01-01T00:00:00.000Z' })).toThrow(
    /timestamps/,
  );
});

it('exports image_path, project, annotator, quality_label, timestamps as CSV, matching the issue’s required columns', () => {
  const csv = exportQualityLabelsCsv([
    createQualityLabel('plate1/well,A1.tif', 'Bandicoot', 'Alice', 'Good'),
  ]);
  const [header, row] = csv.trim().split('\r\n');
  expect(header).toBe('image_path,project,annotator,quality_label,created_at,updated_at');
  expect(row).toMatch(/^"plate1\/well,A1\.tif",Bandicoot,Alice,Good,/); // comma-containing field quoted
});

it('export is empty-but-valid (header only) when nothing has been labeled yet', () => {
  expect(exportQualityLabelsCsv([]).trim()).toBe(
    'image_path,project,annotator,quality_label,created_at,updated_at',
  );
});
