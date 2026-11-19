import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installImageFixtures } from './support/idr-fixtures';
import {
  discoveryResponse,
  firstDiscoveryRecord,
  installDiscoveryFixtures,
} from './support/bia-discovery-fixtures';

const directory = new URL('./fixtures/bia3204/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));

test('pulling an image discovers a new study outside the three examples and runs real inference', async ({
  page,
  context,
}) => {
  await installImageFixtures(context, directory, manifest);
  const queries = await installDiscoveryFixtures(context);
  await page.addInitScript(() => {
    crypto.getRandomValues = ((array: Uint32Array) =>
      array.fill(0)) as typeof crypto.getRandomValues;
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?reference=bia3204-ring-rep2');
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  const firstSource = new URL(page.url()).searchParams.get('source');
  await page.locator('#shuffle').click();
  await expect(page.locator('#image-title')).toHaveText(firstDiscoveryRecord.study_title);
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  const source = new URL(page.url()).searchParams.get('source')!;
  expect(source).not.toBe(firstSource);
  expect(source).toContain('/S-BIAD2258/');
  expect(queries.length).toBeGreaterThan(0);
  expect(new URL(queries[0]).searchParams.getAll('facet.accession_id.not')).toContain('S-BIAD3204');
  await expect(page.locator('#image-biology')).toContainText('Archive specimen: Plankton');
  await expect(page.locator('#image-biology')).not.toContainText(
    'marine plankton environmental sample',
  );
  await expect(page.locator('#image-biology')).not.toContainText('Organism');
  await expect(page.locator('#image-biology')).toContainText('CC BY 4.0');
  const run = JSON.parse((await page.locator('#run-details').textContent())!);
  expect(run.cell_count).toBeGreaterThan(0);
  expect(run.settings.channels).toEqual([0, 1, 2, 3]);
  // Even if the API returns a stale page, the app must not recycle its study.
  await page.locator('#shuffle').click();
  await expect(page.locator('#status')).toContainText(
    'Previously viewed datasets are not repeated',
  );
  expect(new URL(page.url()).searchParams.get('source')).toBe(source);
  await expect(page.locator('#csv')).toBeEnabled();
  expect(new URL(queries.at(-1)!).searchParams.getAll('facet.accession_id.not')).toContain(
    'S-BIAD2258',
  );
  expect(errors).toEqual([]);
});

test('API failure preserves the current dataset and exports rather than cycling old examples', async ({
  page,
  context,
}) => {
  await installImageFixtures(context, directory, manifest);
  await page.route('https://beta.bioimagearchive.org/search/v1/search/fts/image**', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto('/?reference=bia3204-ring-rep2');
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  const source = new URL(page.url()).searchParams.get('source');
  await page.locator('#shuffle').click();
  await expect(page.locator('#status')).toContainText('BioImage Archive HTTP 503');
  await expect(page.locator('#result-count')).toHaveText('10 of 10 objects');
  await expect(page.locator('#csv')).toBeEnabled();
  expect(new URL(page.url()).searchParams.get('source')).toBe(source);
});

test('cancelling archive discovery prevents its late response from changing the image', async ({
  page,
  context,
}) => {
  await installImageFixtures(context, directory, manifest);
  let requested = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    'https://beta.bioimagearchive.org/search/v1/search/fts/image**',
    async (route) => {
      requested = true;
      await gate;
      await route
        .fulfill({ status: 200, contentType: 'application/json', body: discoveryResponse })
        .catch(() => {});
    },
  );
  try {
    await page.goto('/?reference=bia3204-ring-rep2');
    await expect(page.locator('#shuffle')).toBeEnabled({ timeout: 45000 });
    const source = new URL(page.url()).searchParams.get('source');
    await page.locator('#shuffle').click();
    await expect.poll(() => requested).toBe(true);
    await page.locator('#cancel').click();
    release();
    await expect(page.locator('#status')).toHaveText('Cancelled. No partial run was published.');
    await expect(page.locator('#shuffle')).toBeEnabled();
    expect(new URL(page.url()).searchParams.get('source')).toBe(source);
    await expect(page.locator('#image-title')).toHaveText('Human U2OS cells under heat stress');
  } finally {
    release();
  }
});
