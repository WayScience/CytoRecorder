import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';

const directory = new URL('../fixtures/bia-search/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
export const discoveryResponse = readFileSync(new URL('page-1.json', directory));
export const firstDiscoveryRecord = JSON.parse(discoveryResponse.toString()).hits.hits[0]._source;

/** Original API, metadata and compressed pixel responses, never synthetic microscopy. */
export async function installDiscoveryFixtures(context: BrowserContext) {
  const entries = new Map<string, { body: Buffer; contentType: string }>();
  for (const entry of manifest.entries) {
    const body = readFileSync(new URL(entry.file, directory));
    if (
      body.length !== entry.bytes ||
      createHash('sha256').update(body).digest('hex') !== entry.sha256
    )
      throw Error(`Corrupt archive discovery fixture: ${entry.file}`);
    entries.set(entry.url, { body, contentType: entry.contentType });
  }
  const queries: string[] = [];
  await context.route('https://livingobjects.ebi.ac.uk/**', async (route) => {
    const entry = entries.get(route.request().url());
    if (!entry) return route.fallback();
    await route.fulfill({
      status: 200,
      body: entry.body,
      contentType: entry.contentType,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  await context.route(
    'https://beta.bioimagearchive.org/search/v1/search/fts/image**',
    async (route) => {
      queries.push(route.request().url());
      await route.fulfill({
        status: 200,
        body: discoveryResponse,
        contentType: 'application/json',
      });
    },
  );
  return queries;
}
