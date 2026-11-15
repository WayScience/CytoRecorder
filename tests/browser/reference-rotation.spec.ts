import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installImageFixtures } from './support/idr-fixtures';
import { firstDiscoveryRecord, installDiscoveryFixtures } from './support/bia-discovery-fixtures';
const directory = new URL('./fixtures/bia3204/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));

test('an unpinned fresh page discovers an archive image rather than a daily fixed example', async ({
  page,
  context,
}) => {
  await installImageFixtures(context, directory, manifest);
  const queries = await installDiscoveryFixtures(context);
  await page.addInitScript(() => {
    crypto.getRandomValues = ((array: Uint32Array) =>
      array.fill(0)) as typeof crypto.getRandomValues;
  });
  await page.goto('/');
  await expect(page.locator('#image-title')).toHaveText(firstDiscoveryRecord.study_title);
  await expect(page.locator('#csv')).toBeEnabled({ timeout: 45000 });
  expect(queries.length).toBeGreaterThan(0);
  expect(new URL(page.url()).searchParams.get('source')).toContain('/S-BIAD2258/');
  // A stale search response cannot reintroduce an already seen study on reload.
  await page.goto('/');
  await expect(page.locator('#status')).toContainText(
    'Previously viewed datasets are not repeated',
  );
  expect(new URL(queries.at(-1)!).searchParams.getAll('facet.accession_id.not')).toContain(
    'S-BIAD2258',
  );
});

test('explicit example links remain reproducible without live discovery', async ({
  page,
  context,
}) => {
  const network = await installImageFixtures(context, directory, manifest);
  for (const [id, title] of [
    ['bia3204-ring-rep2', 'Human U2OS cells under heat stress'],
    ['bia1735-dsb-nuclei', 'Fluorescently stained human nuclei'],
  ]) {
    await page.goto(`/?reference=${id}&count=100000`);
    await expect(page.locator('#image-title')).toHaveText(title);
    await expect(page.locator('#status')).toContainText('count');
  }
  expect(network.requests).toEqual([]);
});
