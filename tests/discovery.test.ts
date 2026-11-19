import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  describeArchiveSource,
  archiveImageId,
  datasetFromRecord,
  LiveImageDiscovery,
  qualifyImage,
} from '../src/discovery';

const directory = new URL('./browser/fixtures/bia-search/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
const searchBytes = readFileSync(new URL('page-1.json', directory));
const searchBody = JSON.parse(searchBytes.toString());
const original = searchBody.hits.hits[0]._source;
const captured = new Map<string, Buffer>(
  manifest.entries.map((entry: any) => {
    const bytes = readFileSync(new URL(entry.file, directory));
    if (
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256 ||
      bytes.length !== entry.bytes
    )
      throw Error('Corrupt original archive fixture');
    return [entry.url, bytes];
  }),
);
const href = (url: string | Request | URL) => (url instanceof Request ? url.url : String(url));
function network() {
  const fetch = vi.fn(async (url: string | Request | URL) => {
    const path = href(url);
    const bytes = path.includes('/search/fts/image') ? searchBytes : captured.get(path);
    return new Response(bytes ? Uint8Array.from(bytes) : 'not captured', {
      status: bytes ? 200 : 404,
    });
  });
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((array: any) => array.fill(0));
  return fetch;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('live archive discovery', () => {
  it('preserves actual image identity, imaging method and license, but excludes organism/biological-context text', () => {
    const sample = datasetFromRecord(original);
    expect(sample.accession).toBe('S-BIAD2258');
    expect(sample.imageId).toBe(original.uuid);
    expect(sample.biology?.description).toContain('Imaging: bright-field microscopy');
    expect(sample.biology?.description).toContain('Archive specimen: Plankton');
    expect(sample.attribution).toContain('CC BY 4.0');
    expect(sample.biology?.description).not.toContain('Organism');
    expect(sample.biology?.description).not.toContain('marine plankton environmental sample');
    expect(sample.biology?.description).not.toContain('Biological context');
    expect(sample.biology?.description).not.toContain('U2OS');
    expect(sample.biology?.studyUrl).toContain('S-BIAD2258');
  });
  it('qualifies real recorded NGFF metadata rather than reusing fixed reference channels and level', async () => {
    network();
    const sample = datasetFromRecord(original);
    const settings = await qualifyImage(sample, new AbortController().signal);
    expect(settings.channels).toEqual([0, 1, 2, 3]);
    expect(settings.segmentChannel).toBe(0); // actual Hoechst label in NGFF
    expect(settings.level).toBe(2);
    expect(settings.source).toBe(sample.url);
    expect(settings.count).toBe(1);
    expect(sample.semantics).toContain('Hoechst');
  });
  it('searches live and excludes seen studies; never resets history when the API repeats a page', async () => {
    const fetch = network();
    const discovery = new LiveImageDiscovery();
    const first = await discovery.next(new AbortController().signal);
    expect(first.sample.accession).toBe('S-BIAD2258');
    await expect(discovery.next(new AbortController().signal)).rejects.toThrow(
      'Previously viewed datasets are not repeated',
    );
    const queries = fetch.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes('/search/fts/image'));
    expect(new URL(queries[1]).searchParams.getAll('facet.accession_id.not')).toContain(
      'S-BIAD2258',
    );
  });
  it('keeps no-repeat history across reloads within the same tab', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const fetch = network();
    new LiveImageDiscovery().remember(datasetFromRecord(original).url);
    await expect(new LiveImageDiscovery().next(new AbortController().signal)).rejects.toThrow(
      'not repeated',
    );
    const query = String(fetch.mock.calls[0][0]);
    expect(new URL(query).searchParams.getAll('facet.accession_id.not')).toEqual(['S-BIAD2258']);
  });
  it('restores shared-image provenance from the document endpoint array wrapper', async () => {
    // The document endpoint differs from search: its hits field is an array.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ hits: [{ _source: original }] }))),
    );
    const source = datasetFromRecord(original).url;
    const sample = await describeArchiveSource(source, new AbortController().signal);
    expect(sample?.imageId).toBe(original.uuid);
    expect(sample?.url).toBe(source);
    expect(sample?.biology?.title).toBe(original.study_title);
    await expect(
      describeArchiveSource(
        source.replace(original.uuid, '11111111-1111-1111-1111-111111111111'),
        new AbortController().signal,
      ),
    ).rejects.toThrow('does not match');
  });
  it('reports API failure instead of substituting one of the curated examples', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );
    await expect(new LiveImageDiscovery().next(new AbortController().signal)).rejects.toThrow(
      'HTTP 503',
    );
  });
  it('rejects unsupported sharding before opening any image chunks', async () => {
    const fetch = network();
    const infoEntry = [...captured.keys()].find((url) => url.endsWith('/0/.zarray'))!;
    fetch.mockImplementation(async (url) =>
      href(url) === infoEntry
        ? new Response(
            JSON.stringify({
              zarr_format: 3,
              node_type: 'array',
              data_type: 'uint8',
              shape: [4, 2048, 2048],
              chunk_grid: { name: 'regular', configuration: { chunk_shape: [1, 2048, 2048] } },
              codecs: [{ name: 'sharding_indexed' }],
            }),
          )
        : new Response(Uint8Array.from(captured.get(href(url)) ?? Buffer.alloc(0)), {
            status: captured.has(href(url)) ? 200 : 404,
          }),
    );
    await expect(
      qualifyImage(datasetFromRecord(original), new AbortController().signal),
    ).rejects.toThrow('sharded arrays are not enabled');
    expect(fetch.mock.calls.every(([url]) => /\.z(group|attrs|array)$/.test(href(url)))).toBe(true);
  });
  it('accepts only exact archive origins and well-formed image identities', () => {
    const source = datasetFromRecord(original).url;
    expect(archiveImageId(source)).toBe(original.uuid);
    expect(archiveImageId(source.replace('https:', 'http:'))).toBeUndefined();
    expect(
      archiveImageId(source.replace('livingobjects.ebi.ac.uk', 'livingobjects.ebi.ac.uk:8443')),
    ).toBeUndefined();
    expect(archiveImageId(source.replace(original.uuid, '-'.repeat(36)))).toBeUndefined();
  });
});
