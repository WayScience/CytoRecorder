import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installImageFixtures } from './support/idr-fixtures';

const directory = new URL('./fixtures/bia3204/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));

test('fresh pages sample a pinned BIA image and explain its biology without searching at runtime', async ({
  page,
  context,
}) => {
  const network = await installImageFixtures(context, directory, manifest);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Pin the pool member this suite's fixtures captured, independent of the daily rotation.
  await page.goto('/?reference=bia3204-ring-rep2');
  await expect(page.locator('#image-title')).toHaveText('Human U2OS cells under heat stress');
  const biology = page.locator('#image-biology');
  await expect(biology).toContainText('G3BP1/2-knockout');
  await expect(biology).toContainText('GFP-MKRN2 RING');
  await expect(biology).toContainText('CC0');
  await expect(biology.getByRole('link', { name: 'Source study' })).toHaveAttribute(
    'href',
    'https://www.ebi.ac.uk/biostudies/bioimages/studies/S-BIAD3204',
  );
  await expect(page.locator('#result-count')).toHaveText('10 of 10 objects', { timeout: 45000 });
  await expect(page.locator('#image-plane')).toContainText('mCher-T1, EGFP-T2, DAPI-T3');
  await expect(page.locator('#image-plane')).toContainText('level 2');
  const run = JSON.parse((await page.locator('#run-details').textContent())!);
  expect(run.settings.source).toBe(manifest.source);
  expect(run.settings.segmentChannel).toBe(2);
  expect(run.settings.segmentation).toBe('model');
  expect(run.model_id).toBe('stardist-dsb2018-90430209');
  expect(run.alignment.shape).toEqual([1, 3, 1, 359, 359]);
  expect(run.stats.decoding_backend).toBe('duckdb-zarr');
  expect(run.stats.bytes).toBe(
    manifest.entries.reduce((sum: number, entry: { bytes: number }) => sum + entry.bytes, 0),
  );
  expect(run.warnings.join(' ')).toContain('exploratory');
  expect(network.requests.every((url) => url.startsWith(manifest.source))).toBe(true);
  expect(network.unexpected).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.locator('.tile-voice-notes')).toHaveCount(10);
  await page.locator('.tile-voice-notes').first().click();
  await page.locator('#voice-text').fill('Reference image note: heat-stressed U2OS nucleus.');
  await page.locator('#voice-save').click();
  await expect(page.locator('#voice-status')).toContainText('Saved locally');
  await page.locator('#voice-close').click();
  await page.reload();
  await expect(page.locator('#result-count')).toHaveText('10 of 10 objects', { timeout: 45000 });
  await page.locator('#voice-all').click();
  await expect(page.locator('.voice-saved-note')).toHaveCount(1);
  await page.locator('#voice-close').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await expect(page.locator('#image-title')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Show settings', exact: true }).click();
  await expect(page.locator('#preset')).toHaveValue('reference');
});
