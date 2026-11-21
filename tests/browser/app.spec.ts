import { test, expect } from '@playwright/test';
import { idrUrl, installIdrFixtures } from './support/idr-fixtures';
test('settings stay collapsed and the mosaic remains usable on desktop and mobile', async ({
  page,
  context,
}) => {
  const network = await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#source')).toBeHidden();
  await expect(page.locator('#result-count')).toHaveText('100 of 100 objects', {
    timeout: 15000,
  });
  expect(network.requests.length).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Show settings', exact: true }).click();
  await expect(page.locator('#source')).toBeVisible();
});
test('rejects invalid and unavailable sources, then can recover', async ({ page, context }) => {
  await installIdrFixtures(context);
  await page.goto(idrUrl('/'));
  await expect(page.locator('#result-count')).toHaveText('100 of 100 objects', { timeout: 15000 });
  await page.getByRole('button', { name: 'Show settings', exact: true }).click();
  await page.locator('#source').fill('http://127.0.0.1:5183/missing.zarr/');
  await page.getByRole('button', { name: 'Sample objects', exact: true }).click();
  await expect(page.locator('#status')).toContainText(/Cannot open|404|metadata|node/, {
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Sample objects', exact: true })).toBeEnabled();
});
