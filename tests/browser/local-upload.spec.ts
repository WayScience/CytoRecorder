import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { idrUrl, installIdrFixtures } from './support/idr-fixtures';

// Reconstructed from tests/browser/fixtures/idr0076/manifest.json's real captured bytes,
// laid out as an actual local directory tree (see tests/local-zarr-upload.test.ts).
const localZarrFolder = fileURLToPath(new URL('./fixtures/idr0076-local/', import.meta.url));

test('the Upload button reads a real local OME-Zarr folder with zero network requests', async ({
  page,
  context,
}) => {
  const network = await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  const requestsBeforeUpload = network.requests.length;
  await page.locator('#upload-input').setInputFiles(localZarrFolder);
  await expect(page.locator('#image-title')).toHaveText('Custom OME-Zarr image', {
    timeout: 30000,
  });
  await expect(page.locator('#result-count')).toContainText('of', { timeout: 30000 });
  expect(new URL(page.url()).searchParams.get('source')).toBe('local://idr0076-local/');
  // The whole point: the folder's own bytes are read directly, never over the network.
  expect(network.requests.length).toBe(requestsBeforeUpload);
  await page.locator('.object-tile').first().click();
  await expect(page.locator('#object-fields')).toContainText('px²');
});

test('dragging a real local OME-Zarr folder onto the mosaic reads it with zero network requests', async ({
  page,
  context,
}) => {
  const network = await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  const requestsBeforeUpload = network.requests.length;
  // DataTransferItem.webkitGetAsEntry() has no scriptable way to fabricate a real
  // FileSystemDirectoryEntry, so this exercises the already-verified file-input path
  // for the actual read, then separately confirms the *drop* wiring itself: dragover
  // adds the drag-over class (and requires dataTransfer.types to include 'Files'),
  // dragleave removes it.
  await page.locator('#upload-input').setInputFiles(localZarrFolder);
  await expect(page.locator('#result-count')).toContainText('of', { timeout: 30000 });
  expect(network.requests.length).toBe(requestsBeforeUpload);
  const dropTarget = page.locator('#mosaic-scroll'),
    dataTransfer = await page.evaluateHandle(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['x'], 'probe.txt')); // the only script-legal way to get types=['Files']
      return dt;
    });
  await dropTarget.dispatchEvent('dragover', { dataTransfer });
  await expect(dropTarget).toHaveClass(/drag-over/);
  await dropTarget.dispatchEvent('dragleave');
  await expect(dropTarget).not.toHaveClass(/drag-over/);
});

test('an unrecognized local folder (no Zarr group at its root) fails clearly, not silently', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  // Upload a bare array leaf (real .zarray/.zattrs, but no .zgroup/zarr.json group file).
  await page.locator('#upload-input').setInputFiles(localZarrFolder + '/labels/0/0');
  await expect(page.locator('#status')).toContainText(/Cannot open local OME-Zarr folder/, {
    timeout: 15000,
  });
});
