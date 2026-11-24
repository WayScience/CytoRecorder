import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { firstDiscoveryRecord, installDiscoveryFixtures } from './support/bia-discovery-fixtures';
import { idrUrl, installIdrFixtures, installImageFixtures } from './support/idr-fixtures';
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

test('a local folder of PNG/TIFF images opens as a tiled overview and labels flow per image', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });

  await page.locator('#upload-input').setInputFiles(imageQueueFolder);
  // Tiled overview like the object mosaic: one tile per queued image.
  await expect(page.locator('#mode-objects')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mode-objects')).toBeEnabled();
  await expect(page.locator('#result-count')).toContainText('2 local images');
  await expect(page.locator('#image-queue-nav')).toBeHidden();
  await expect(page.locator('#voice-notes')).toBeHidden();
  await expect(page.locator('#mosaic button.image-tile')).toHaveCount(2);
  // Thumbnails are decoded client-side; both tiles end up with real canvases.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const canvases = [
          ...document.querySelectorAll<HTMLCanvasElement>('#mosaic button.image-tile canvas'),
        ];
        return canvases.every((c) =>
          [...c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data].some((v) => v > 0),
        );
      }),
    )
    .toBe(true);

  // Clicking a tile opens that image in single-image mode, where the QC panel binds to it.
  await page.locator('#mosaic button.image-tile').first().click();
  await expect(page.locator('#quality-panel')).toBeVisible();
  await expect(page.locator('#image-queue-position')).toHaveText('1 of 2');
  const firstPath = await page.locator('#qc-path').textContent();

  await page.locator('#qc-annotator').fill('Alice');
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(page.locator('#qc-count')).toContainText('1 quality label');

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

  // Back to the tiled overview, the tile for the labeled image stays available.
  await page.locator('#mode-objects').click();
  await expect(page.locator('#quality-panel')).toBeHidden();
  await expect(page.locator('#voice-notes')).toBeHidden();
  await expect(page.locator('#mosaic button.image-tile')).toHaveCount(2);
});

test('batch quality labeling from the tiled overview labels several images at once and exports them', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await stubSaveFilePicker(page);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });

  await page.locator('#upload-input').setInputFiles(imageQueueFolder);
  await expect(page.locator('#image-queue-nav')).toBeHidden();
  await expect(page.locator('#image-select-bar')).toBeHidden();

  // Select both tiles with their corner toggles; the batch bar appears.
  const tiles = page.locator('#mosaic button.image-tile');
  await tiles
    .nth(0)
    .getByRole('button', { name: /Select .* for batch/ })
    .click();
  await tiles
    .nth(1)
    .getByRole('button', { name: /Select .* for batch/ })
    .click();
  await expect(page.locator('#image-select-bar')).toBeVisible();
  await expect(page.locator('#image-select-count')).toHaveText('2 images selected');
  // The batch bar shares the QC panel's persisted annotator identity.
  await page.locator('#image-select-annotator').fill('Alice');
  await page
    .locator('#image-select-labels')
    .getByRole('button', { name: 'Out-of-focus', exact: true })
    .click();
  await expect(page.locator('#image-select-status')).toHaveText(
    'Saved "Out-of-focus" for 2 images.',
  );
  // Selection cleared after applying; labeled tiles wear the .annotated badge.
  await expect(page.locator('#image-select-bar')).toBeHidden();
  const badges = await page.locator('#mosaic button.image-tile.annotated').count();
  expect(badges).toBe(2);

  // The batch Export CSV button captures both records through the real
  // picker boundary (stubbed), same bytes the single-image panel exports.
  await tiles
    .first()
    .getByRole('button', { name: /Select .* for batch/ })
    .click();
  await expect(page.locator('#image-select-bar')).toBeVisible();
  await page.locator('#image-select-export').click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (window as unknown as { __savedFiles?: { name: string; text: string }[] }).__savedFiles
              ?.length,
        ),
      { timeout: 5000 },
    )
    .toBeGreaterThan(0);
  const saved = await page.evaluate(
    () => (window as unknown as { __savedFiles: { name: string; text: string }[] }).__savedFiles,
  );
  expect(saved[0].name).toBe('quality_labels.csv');
  const rows = saved[0].text.trim().split('\r\n');
  expect(rows[0]).toBe('image_path,project,annotator,quality_label,created_at,updated_at');
  for (const row of rows.slice(1)) expect(row).toMatch(/^[^,]+,(?!.*,,)[^,]*,Alice,Out-of-focus,/);
  expect(rows).toHaveLength(3);

  // The single-image panel's count reflects the batch too.
  await page
    .locator('#mosaic button.image-tile')
    .first()
    .getByRole('button', { name: /Deselect .* for batch/ })
    .click();
  await expect(page.locator('#image-select-bar')).toBeHidden();
  await tiles.first().click();
  await expect(page.locator('#quality-panel')).toBeVisible();
  await expect(page.locator('#qc-count')).toContainText('2 quality labels');
  await expect(page.locator('#qc-status')).toContainText('Saved "Out-of-focus" by Alice');
});

test('a ?project= URL param (as opened by the cytorecorder review CLI) prefills the Project field and skips the auto-demo', async ({
  page,
  context,
}) => {
  const queries = await installDiscoveryFixtures(context);
  await page.goto('/?project=Bandicoot');
  // Prefilled before any image is loaded or Single image mode is even opened.
  await expect(page.locator('#qc-project')).toHaveValue('Bandicoot');
  await expect(page.locator('#status')).toContainText('Bandicoot');
  await expect(page.locator('#status')).toContainText('Drag the image folder');
  await expect(page.locator('#csv')).toBeDisabled();
  expect(queries).toEqual([]);

  await page.locator('#upload-image-input').setInputFiles(samplePng);
  // A manually loaded image's own project never overwrites an already-set field.
  await expect(page.locator('#qc-project')).toHaveValue('Bandicoot');
});

test('?project= with ?voice=1 (cytorecorder review --enable_voice_notes) keeps the default demo', async ({
  page,
  context,
}) => {
  const directory = new URL('./fixtures/bia3204/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
  await installImageFixtures(context, directory, manifest);
  const queries = await installDiscoveryFixtures(context);
  await page.addInitScript(() => {
    crypto.getRandomValues = ((array: Uint32Array) =>
      array.fill(0)) as typeof crypto.getRandomValues;
  });
  await page.goto('/?project=Bandicoot&voice=1');
  await expect(page.locator('#qc-project')).toHaveValue('Bandicoot');
  await expect(page.locator('#image-title')).toHaveText(firstDiscoveryRecord.study_title);
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  expect(queries.length).toBeGreaterThan(0);
  await expect(page.locator('#mode-objects')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#voice-notes')).toBeVisible();
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
