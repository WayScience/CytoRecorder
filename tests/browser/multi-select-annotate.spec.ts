import { test, expect } from '@playwright/test';
import { idrUrl, installIdrFixtures } from './support/idr-fixtures';

test.use({ viewport: { width: 1440, height: 1000 } });

test('selecting several tiles and saving one note annotates every selected object, shown with a border', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  const tiles = page.locator('#mosaic .object-tile'),
    cellIdA = await tiles.nth(0).getAttribute('data-id'),
    cellIdB = await tiles.nth(1).getAttribute('data-id');
  await expect(page.locator('#multi-select-bar')).toBeHidden();
  // Neither selected nor annotated before anything happens.
  await expect(tiles.nth(0)).not.toHaveClass(/multi-selected/);
  await expect(tiles.nth(0)).not.toHaveClass(/annotated/);
  const selectButtons = page.locator('.tile-select');
  await selectButtons.nth(0).click();
  await selectButtons.nth(1).click();
  await expect(page.locator('#multi-select-bar')).toBeVisible();
  await expect(page.locator('#multi-select-count')).toHaveText('2 objects selected');
  await expect(tiles.nth(0)).toHaveClass(/multi-selected/);
  await expect(tiles.nth(1)).toHaveClass(/multi-selected/);
  await expect(tiles.nth(2)).not.toHaveClass(/multi-selected/);
  await page.locator('#multi-select-annotate').click();
  await expect(page.locator('#voice-notes-dialog')).toBeVisible();
  await expect(page.locator('#voice-title')).toHaveText('Record annotations · 2 objects');
  await page.locator('#voice-text').fill('Both show the same morphology.');
  await page.locator('#voice-save').click();
  await expect(page.locator('.voice-saved-note')).toHaveCount(1);
  await expect(page.locator('.voice-saved-note .hint')).toContainText(cellIdA!);
  await expect(page.locator('.voice-saved-note .hint')).toContainText(cellIdB!);
  await page.locator('#voice-close').click();
  // Both newly annotated tiles get the border; a third, untouched tile does not.
  await expect(tiles.nth(0)).toHaveClass(/annotated/);
  await expect(tiles.nth(1)).toHaveClass(/annotated/);
  await expect(tiles.nth(2)).not.toHaveClass(/annotated/);
  await expect(page.locator('.tile-voice-notes.has-notes')).toHaveCount(2);
  await page.locator('#multi-select-clear').click();
  await expect(page.locator('#multi-select-bar')).toBeHidden();
  await expect(tiles.nth(0)).not.toHaveClass(/multi-selected/);
  // The outline survives a reload (it comes from saved notes, not transient state).
  await page.reload();
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  await expect(page.locator('#mosaic .object-tile').nth(0)).toHaveClass(/annotated/);
  await expect(page.locator('#mosaic .object-tile').nth(1)).toHaveClass(/annotated/);
});
