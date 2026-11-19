import { test, expect } from '@playwright/test';
import { idrUrl, installIdrFixtures } from './support/idr-fixtures';

test.use({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });

test('whole-image preview starts collapsed, then renders the real coarsest pyramid level on demand', async ({
  page,
  context,
}) => {
  const network = await installIdrFixtures(context);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(idrUrl('/?target=3'));
  await expect(page.locator('#result-count')).toHaveText('3 of 3 objects', { timeout: 15000 });

  const details = page.locator('#whole-preview');
  await expect(details).toBeVisible();
  await expect(details).not.toHaveJSProperty('open', true);

  await page.locator('#whole-preview summary').click();
  await expect(page.locator('#whole-preview-note')).toHaveText(/58 × 61 px/, { timeout: 15000 });
  await expect(page.locator('#whole-preview-note')).toContainText('level 3');

  // The coarsest pyramid level actually decoded real (non-blank) pixels.
  const stats = await page.evaluate(() => {
    const canvas = document.querySelector('#whole-preview-canvas') as HTMLCanvasElement;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonZero = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 0) nonZero++;
    return { width: canvas.width, height: canvas.height, nonZero };
  });
  expect(stats).toEqual({ width: 58, height: 61, nonZero: 2929 });

  // Collapsing and reopening must not refetch (cached for this run).
  await page.locator('#whole-preview summary').click();
  await page.locator('#whole-preview summary').click();
  await expect(page.locator('#whole-preview-note')).toHaveText(/58 × 61 px/);
  expect(network.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});
