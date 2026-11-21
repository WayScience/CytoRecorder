import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { DuckDBZarrSource } from '../src/sources/duckdb-zarr';

const fixtureDir = new URL('./browser/fixtures/idr0076-local/', import.meta.url);

function realFile(relative: string): File {
  const bytes = readFileSync(fileURLToPath(new URL(relative, fixtureDir)));
  return new File([bytes], relative.split('/').pop()!);
}

function realFolder(relatives: string[]): Map<string, File> {
  return new Map(relatives.map((r) => [r, realFile(r)]));
}

// Reconstructed from tests/browser/fixtures/idr0076/manifest.json's "key" paths — the
// same real captured IDR0076 bytes, just laid out as an actual local directory tree.
const IDR0076_KEYS = [
  '.zgroup',
  '.zattrs',
  '0/.zarray',
  '0/.zattrs',
  '0/42/0/0',
  '3/.zarray',
  '3/42/0/0',
];

it('opens a real local OME-Zarr folder (as the browser would hand it from a drop or file picker), with zero network', async () => {
  const files = realFolder(IDR0076_KEYS);
  const source = await DuckDBZarrSource.openLocal(
    files,
    'idr0076-local',
    new AbortController().signal,
  );
  expect(source.url).toBe('local://idr0076-local/');
  expect(source.metadata.version).toBeTruthy();
  expect(source.metadata.channels.length).toBeGreaterThan(0);
  expect(source.metadata.levels.length).toBeGreaterThanOrEqual(2);
  // Real local file reads were counted like network requests, just with zero bytes over the wire.
  expect(source.stats.requests).toBeGreaterThan(0);
});

it('caches a repeated local file read instead of re-reading it', async () => {
  const files = realFolder(IDR0076_KEYS);
  const source = await DuckDBZarrSource.openLocal(
    files,
    'idr0076-local',
    new AbortController().signal,
  );
  const requestsAfterOpen = source.stats.requests;
  // level()/array-info reads reuse the already-fetched '0/.zarray' file via the same cache.
  await source.level(0);
  const requestsAfterFirstLevel = source.stats.requests;
  expect(requestsAfterFirstLevel).toBeGreaterThan(requestsAfterOpen);
  await source.level(0);
  expect(source.stats.requests).toBe(requestsAfterFirstLevel);
});

it('fails clearly, not silently, when the dropped folder has no Zarr group at its root', async () => {
  const files = realFolder(['0/42/0/0']); // a lone chunk file, no .zgroup/zarr.json
  await expect(
    DuckDBZarrSource.openLocal(files, 'not-a-zarr-folder', new AbortController().signal),
  ).rejects.toThrow(/Cannot open local OME-Zarr folder/);
});
