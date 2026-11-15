import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installImageFixtures } from './support/idr-fixtures';

const directory = new URL('./fixtures/bia3204/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
const discoveryDirectory = new URL('./fixtures/bia-search/', import.meta.url);
const response = readFileSync(new URL('page-1.json', discoveryDirectory));

test('pulling a new image searches the archive instead of recycling pinned examples', async ({
  page,
  context,
}) => {
  await installImageFixtures(context, directory, manifest);
  let searches = 0;
  await page.route(
    'https://beta.bioimagearchive.org/search/v1/search/fts/image**',
    async (route) => {
      searches++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: response });
    },
  );
  await page.goto('/?reference=bia3204-ring-rep2');
  await expect(page.locator('#shuffle')).toBeEnabled({ timeout: 45000 });
  await page.locator('#shuffle').click();
  await expect.poll(() => searches).toBeGreaterThan(0);
});
