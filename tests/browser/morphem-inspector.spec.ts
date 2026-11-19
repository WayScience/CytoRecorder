import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { idrUrl, installIdrFixtures } from './support/idr-fixtures';

test('MorphEm features embed the inspected crop in the browser and download JSON', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(idrUrl('/'));
  await expect(page.locator('#result-count')).toHaveText('100 of 100 objects', {
    timeout: 15000,
  });
  // Open the inspector for the first tile.
  await page.locator('#mosaic .object-tile').first().click();
  await expect(page.locator('#voice-notes-dialog')).toBeVisible();
  await expect(page.locator('#inspector-morphem')).toBeVisible();
  // The real 86 MB WASM graph must load from the dev server (not intercepted:
  // localhost requests continue) and embed the crop.
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  await page.locator('#inspector-morphem').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^morphem-.+\.json$/);
  const file = test.info().outputPath('morphem.json');
  await download.saveAs(file);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  // The default IDR reference displays one channel: one 384-dim embedding.
  expect(manifest.embeddings).toHaveLength(1);
  expect(manifest.embeddings[0]).toHaveLength(384);
  expect(manifest.model).toBe('morphem-vit-819132f2');
  expect(manifest.model_revision).toBe('0e8d58787421f83f975634d72420d85c5dfc9c2c');
  // Channel-last feature names as the pycytominer ecosystem expects.
  expect(manifest.feature_names[0]).toBe('MorphEm_Feature0_Channel0');
  expect(manifest.feature_names[383]).toBe('MorphEm_Feature383_Channel0');
  expect(manifest.feature_names).toHaveLength(384);
  // All values finite.
  for (const value of manifest.embeddings[0]) expect(Number.isFinite(value)).toBe(true);
  // The button is re-enabled; the status line reports either the manual
  // embedding or the concurrent background featurization progress.
  await expect(page.locator('#inspector-morphem')).toBeEnabled();
  await expect(page.locator('#status')).toContainText(/MorphEm/);
  expect(errors).toEqual([]);
});
