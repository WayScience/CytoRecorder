import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installImageFixtures } from './support/idr-fixtures';

const directory = new URL('./fixtures/bia3204/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
const expected = JSON.parse(readFileSync(new URL('expected.json', directory), 'utf8'));

test('BIA TCZYX pixels decoded by DuckDB-Zarr match independent Python checksums', async ({
  page,
  context,
}) => {
  const network = await installImageFixtures(context, directory, manifest);
  // Pin the pool member whose chunks are captured; the pixel test reads its manifest source directly.
  await page.goto('/?reference=bia3204-ring-rep2&count=100000');
  const channels = await page.evaluate(
    async ({ source }) => {
      const path = '/src/sources/duckdb-zarr.ts';
      const { DuckDBZarrSource } = await import(path);
      const controller = new AbortController();
      const image = await DuckDBZarrSource.open(
        source,
        AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]),
      );
      try {
        const result = [];
        for (const channel of [0, 1, 2]) {
          const pixels = await image.readRegion(2, {
            channel,
            t: 0,
            z: 0,
            x: 0,
            y: 0,
            width: 359,
            height: 359,
          });
          if (!(pixels instanceof Uint8Array)) throw Error('Native uint8 dtype changed');
          const digest = new Uint8Array(
            await crypto.subtle.digest('SHA-256', new Uint8Array(pixels).buffer),
          );
          result.push({
            channel,
            dtype: 'uint8',
            shape: [359, 359],
            bytes: pixels.byteLength,
            sha256: Array.from(digest, (v) => v.toString(16).padStart(2, '0')).join(''),
          });
        }
        return result;
      } finally {
        controller.abort();
      }
    },
    { source: manifest.source },
  );
  expect(channels).toEqual(expected.channels);
  expect(network.unexpected).toEqual([]);
});
