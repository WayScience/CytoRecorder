import { expect, test } from '@playwright/test';
import { idrUrl, installIdrFixtures, source } from './support/idr-fixtures';

test('biological context is visible above the mosaic before image loading', async ({
  page,
  context,
}) => {
  await installIdrFixtures(context);
  await page.goto(`/?source=${encodeURIComponent(source)}&count=100000`);
  const biology = page.locator('#image-biology');
  await expect(biology).toBeVisible();
  await expect(biology.getByRole('heading')).toContainText('Breast tumour tissue');
  await expect(biology).toContainText('2D cell-section masks');
  await expect(biology).toContainText('Ali et al.');
  await expect(page.locator('#source')).toBeHidden();
  const beforeMosaic = await page.evaluate(() => {
    const biology = document.querySelector('#image-biology')!;
    const mosaic = document.querySelector('#mosaic-scroll')!;
    return biology.getBoundingClientRect().bottom <= mosaic.getBoundingClientRect().top;
  });
  expect(beforeMosaic).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(biology.getByRole('heading')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('custom images are never attributed to the default study', async ({ page, context }) => {
  const network = await installIdrFixtures(context);
  await page.goto(idrUrl('/?source=https%3A%2F%2Fexample.org%2Fcustom.zarr%2F&count=100000'));
  const biology = page.locator('#image-biology');
  await expect(biology).toContainText('Custom OME-Zarr image');
  await expect(biology).toContainText('Biological metadata has not been curated');
  await expect(biology).not.toContainText('Ali et al.');
  await expect(page.locator('#credit')).not.toContainText('IDR0076');
  expect(network.requests).toEqual([]);
});
