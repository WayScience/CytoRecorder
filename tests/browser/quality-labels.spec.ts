import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { idrUrl, installIdrFixtures } from './support/idr-fixtures';
import { stubSaveFilePicker } from './support/save-file-picker';

test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });

const fixtureDir = new URL('./fixtures/flat-images/', import.meta.url),
  samplePng = fileURLToPath(new URL('sample.png', fixtureDir)),
  imageQueueFolder = fileURLToPath(new URL('./fixtures/image-queue/', import.meta.url));

test('voice recording stays the default objects-mode capability; whole-image QC is only in image mode', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#result-count')).toContainText('of', { timeout: 30000 });
  await expect(page.locator('#mode-objects')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#voice-notes')).toBeVisible();
  await expect(page.locator('#quality-panel')).toBeHidden();

  await page.locator('#mode-image').click();
  await expect(page.locator('#voice-notes')).toBeHidden();
  await expect(page.locator('#quality-panel')).toBeVisible();

  await page.locator('#mode-objects').click();
  await expect(page.locator('#voice-notes')).toBeVisible();
  await expect(page.locator('#quality-panel')).toBeHidden();
});

test('labeling an uploaded whole image persists to IndexedDB, resumes under the same annotator, and exports real CSV columns via the Save-As picker', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await stubSaveFilePicker(page); // real showSaveFilePicker opens a native dialog Playwright can't drive
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });

  await page.locator('#upload-image-input').setInputFiles(samplePng);
  await expect(page.locator('#quality-panel')).toBeVisible();
  await expect(page.locator('#qc-path')).toHaveText('sample.png');

  await page.locator('#qc-project').fill('Bandicoot');
  await page.locator('#qc-annotator').fill('Alice');
  const goodButton = page.getByRole('button', { name: 'Good', exact: true });
  await goodButton.click();
  await expect(page.locator('#qc-status')).toContainText('Saved "Good" by Alice');
  await expect(goodButton).toHaveClass(/quality-label-selected/);
  await expect(page.locator('#qc-count')).toContainText('1 quality label');

  // Re-upload the same file under the same annotator: the saved label resumes, not re-prompted empty.
  await page.locator('#upload-image-input').setInputFiles(samplePng);
  await expect(page.locator('#qc-status')).toContainText('Saved "Good" by Alice');
  await expect(goodButton).toHaveClass(/quality-label-selected/);

  // A different annotator sees a clean slate for the same image (never clobbered).
  await page.locator('#qc-annotator').fill('Bob');
  await expect(page.locator('#qc-status')).toHaveText('');
  for (const label of ['Good', 'Out-of-focus', 'Debris'])
    await expect(page.getByRole('button', { name: label, exact: true })).not.toHaveClass(
      /quality-label-selected/,
    );
  await page.getByRole('button', { name: 'Debris', exact: true }).click();
  await expect(page.locator('#qc-count')).toContainText('2 quality labels');

  const downloadPromise = page.waitForEvent('download', { timeout: 2000 }).catch(() => undefined);
  await page.locator('#qc-export').click();
  await expect(page.locator('#qc-status')).toContainText(
    'Saved 2 quality label(s) to quality_labels.csv',
  );
  const download = await downloadPromise;
  expect(download).toBeUndefined(); // the picker path was taken, not the download fallback
  const saved = await page.evaluate(
    () => (window as unknown as { __savedFiles: { name: string; text: string }[] }).__savedFiles,
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe('quality_labels.csv');
  const lines = saved[0].text.trim().split('\r\n');
  expect(lines[0]).toBe('image_path,project,annotator,quality_label,created_at,updated_at');
  expect(lines).toHaveLength(3); // header + Alice's row + Bob's row
  expect(saved[0].text).toContain('sample.png,Bandicoot,Alice,Good,');
  expect(saved[0].text).toContain('sample.png,Bandicoot,Bob,Debris,');
});

test('a local folder of PNG/TIFF images (including a subdirectory) opens as a steppable queue, not an OME-Zarr error', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });

  await page.locator('#upload-input').setInputFiles(imageQueueFolder);
  await expect(page.locator('#image-queue-nav')).toBeVisible();
  await expect(page.locator('#image-queue-position')).toHaveText('1 of 2');
  await expect(page.locator('#mode-objects')).toBeDisabled();
  await expect(page.locator('#quality-panel')).toBeVisible();

  await page.locator('#qc-annotator').fill('Alice');
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(page.locator('#qc-count')).toContainText('1 quality label');
  const firstPath = await page.locator('#qc-path').textContent();

  await page.locator('#image-next').click();
  await expect(page.locator('#image-queue-position')).toHaveText('2 of 2');
  const secondPath = await page.locator('#qc-path').textContent();
  expect(secondPath).not.toBe(firstPath);
  // A fresh image under the same annotator has nothing saved yet.
  await expect(page.locator('#qc-status')).toHaveText('');
  await page.getByRole('button', { name: 'Debris', exact: true }).click();
  await expect(page.locator('#qc-count')).toContainText('2 quality labels');

  await page.locator('#image-prev').click();
  await expect(page.locator('#image-queue-position')).toHaveText('1 of 2');
  await expect(page.locator('#qc-status')).toContainText('Saved "Good" by Alice');
  await expect(page.locator('#image-prev')).toBeDisabled();
});

test('a ?project= URL param (as opened by the cytorecorder review CLI) prefills the Project field', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.goto(idrUrl('/?project=Bandicoot'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  // Prefilled before any image is loaded or Single image mode is even opened.
  await expect(page.locator('#qc-project')).toHaveValue('Bandicoot');

  await page.locator('#upload-image-input').setInputFiles(samplePng);
  // A manually loaded image's own project never overwrites an already-set field.
  await expect(page.locator('#qc-project')).toHaveValue('Bandicoot');
});

test('export falls back to a plain download when the Save-As picker API is unavailable (e.g. Firefox)', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });

  await page.locator('#upload-image-input').setInputFiles(samplePng);
  await page.locator('#qc-annotator').fill('Alice');
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(page.locator('#qc-count')).toContainText('1 quality label');

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#qc-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('quality-labels.csv');
  const csvPath = await download.path();
  const csv = await import('node:fs/promises').then((fs) => fs.readFile(csvPath!, 'utf8'));
  expect(csv.trim().split('\r\n')[0]).toBe(
    'image_path,project,annotator,quality_label,created_at,updated_at',
  );
  expect(csv).toContain('sample.png,sample.png,Alice,Good,');
});
