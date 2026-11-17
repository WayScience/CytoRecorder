import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { idrUrl, installIdrFixtures } from './support/idr-fixtures';

/** Minimal RFC-4180 CSV parse: quoted fields, doubled quotes, commas and
 * newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

test('voice recording terminates in-flight features; close resumes and manual pause preserves exports', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
      value: async () => {
        throw new DOMException('Permission denied for lifecycle control', 'NotAllowedError');
      },
    });
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let modelRequests = 0,
    closedWorkers = 0;
  await page.route('**/models/morphem-vit.onnx', async (route) => {
    modelRequests++;
    await gate;
    await route.continue().catch(() => {}); // the paused worker's fetch may already be gone
  });
  page.on('worker', (worker) => {
    if (worker.url().includes('morphem.worker')) worker.on('close', () => closedWorkers++);
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(idrUrl('/?target=3'));
    await expect.poll(() => modelRequests, { timeout: 30000 }).toBe(1);
    await page.locator('.tile-voice-notes').first().click();
    await page.locator('#voice-record').click();
    await expect(page.locator('#voice-status')).toContainText(/denied|blocked/i);
    await expect(page.locator('#morphem-status')).toContainText('paused');
    await expect.poll(() => closedWorkers).toBe(1);
    await page.locator('#voice-close').click();
    await expect.poll(() => modelRequests, { timeout: 30000 }).toBe(2);
    await page.locator('#morphem-pause').click();
    await expect.poll(() => closedWorkers).toBe(2);
    await expect(page.locator('#morphem-status')).toContainText('paused');
    const download = page.waitForEvent('download');
    await page.locator('#csv').click();
    const file = test.info().outputPath('pending.csv');
    await (await download).saveAs(file);
    const rows = parseCsv(await readFile(file, 'utf8'));
    for (const row of rows.slice(1)) {
      expect(row[rows[0].indexOf('morphem_status')]).toBe('pending');
      expect(row[rows[0].indexOf('MorphEm_Feature0_Channel0')]).toBe('');
    }
    // Closing voice must not undo the user's manual pause.
    await page.locator('.tile-voice-notes').first().click();
    await page.locator('#voice-record').click();
    await expect(page.locator('#voice-status')).toContainText(/denied|blocked/i);
    await page.locator('#voice-close').click();
    await expect(page.locator('#morphem-status')).toContainText('paused');
    expect(modelRequests).toBe(2);
    release();
    await page.locator('#morphem-pause').click();
    await expect(page.locator('#morphem-status')).toContainText(
      'MorphEm ready: 3 objects embedded',
      { timeout: 60000 },
    );
    expect(errors).toEqual([]);
  } finally {
    release();
  }
});

test('MorphEm features are computed in the background after sampling and reach the dataset', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  const errors: string[] = [],
    workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(idrUrl('/?target=3'));
  await expect(page.locator('#result-count')).toHaveText('3 of 3 objects', { timeout: 15000 });
  // After the run finishes, background featurization must start on its own.
  await expect(page.locator('#morphem-status')).toContainText(/MorphEm: embedded \d+\/3/, {
    timeout: 60000,
  });
  // It completes for all three objects, then reports readiness.
  await expect(page.locator('#morphem-status')).toContainText('MorphEm ready: 3 objects embedded', {
    timeout: 120000,
  });
  // The CSV export now includes feature columns for the dataset.
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('#csv').click();
  const download = await downloadPromise;
  const file = test.info().outputPath('cells.csv');
  await download.saveAs(file);
  const csv = await readFile(file, 'utf8');
  const rows = parseCsv(csv);
  const header = rows[0]!;
  expect(header).toContain('MorphEm_Feature0_Channel0');
  expect(header).toContain('MorphEm_Feature383_Channel0');
  expect(rows).toHaveLength(4); // header + 3 objects
  for (const row of rows.slice(1)) {
    const feature0 = Number(row[header.indexOf('MorphEm_Feature0_Channel0')]);
    expect(Number.isFinite(feature0)).toBe(true);
    expect(feature0).not.toBe(0);
  }
  // The inspector now serves the cached embedding: the button completes
  // instantly and reports the same manifest without recomputation.
  await page.locator('#mosaic .object-tile').first().click();
  await expect(page.locator('#inspector')).toBeVisible();
  const manifestPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.locator('#inspector-morphem').click();
  const manifestDownload = await manifestPromise;
  const manifestFile = test.info().outputPath('morphem.json');
  await manifestDownload.saveAs(manifestFile);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  expect(manifest.embeddings).toHaveLength(1);
  expect(manifest.embeddings[0]).toHaveLength(384);
  expect(workers.some((url) => url.includes('morphem.worker'))).toBe(true);
  expect(errors).toEqual([]);
});
