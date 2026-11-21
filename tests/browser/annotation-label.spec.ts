import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { idrUrl, installIdrFixtures } from './support/idr-fixtures';

test.use({ viewport: { width: 1440, height: 1000 } });

test('a custom annotation label saved via the real UI reaches the labels table and the CSV export column', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.goto(idrUrl('/?v.labelOptions=Mitotic,Interphase,Apoptotic'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  // The URL-configured presets populate the datalist, without restricting free text.
  const optionValues = await page
    .locator('#voice-label-options option')
    .evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  expect(optionValues).toEqual(['Mitotic', 'Interphase', 'Apoptotic']);
  const cellId = await page.locator('#mosaic .object-tile').first().getAttribute('data-id');
  await page.locator('.object-tile').first().click();
  await page.locator('#voice-text').fill('Looks apoptotic under this stain.');
  await page.locator('#voice-label').fill('Apoptotic');
  await page.locator('#voice-save').click();
  await expect(page.locator('.voice-saved-note .hint')).toContainText('Label: Apoptotic');
  await page.locator('#voice-close').click();
  await expect
    .poll(
      () =>
        page.evaluate(async (id) => {
          const modulePath = '/src/database.ts';
          const db = await import(modulePath);
          const rows = (
            await db.queryCells(`SELECT annotation_label FROM labels WHERE cell_id = '${id}'`)
          ).rows;
          return rows[0]?.annotation_label;
        }, cellId),
      { timeout: 15000 },
    )
    .toBe('Apoptotic');
  const pendingDownload = page.waitForEvent('download');
  await page.locator('#csv').click();
  const download = await pendingDownload;
  const path = test.info().outputPath(download.suggestedFilename());
  await download.saveAs(path);
  const csv = await readFile(path, 'utf8');
  const lines = csv.split('\n');
  expect(lines[0]).toContain('annotation_label');
  const row = lines.find((line) => line.includes(cellId!));
  expect(row).toContain('Apoptotic');
});
