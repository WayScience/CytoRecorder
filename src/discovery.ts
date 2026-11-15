import { DEFAULT_SETTINGS, validateSettings, type Settings } from './core';
import type { Dataset } from './datasets';
import { DuckDBZarrSource } from './sources/duckdb-zarr';
import { planChunks } from './sources/chunks';

export const BIA_SEARCH = 'https://beta.bioimagearchive.org/search/v1/search/fts/image';
const HISTORY_KEY = 'musivarium-bia-discovery-v1';
const PAGE_SIZE = 50;
type RecordData = Record<string, any>;
const record = (value: unknown): RecordData =>
  value && typeof value === 'object' ? (value as RecordData) : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const list = (value: unknown): any[] => (Array.isArray(value) ? value : []);
const canonical = (source: string) => {
  const u = new URL(source);
  return u.origin + u.pathname.replace(/\/+$/, '');
};
const randomIndex = (size: number) => crypto.getRandomValues(new Uint32Array(1))[0] % size;

/** Only archive-hosted converted stores are eligible for automatic discovery. */
export function archiveImageId(source: string): string | undefined {
  try {
    const u = new URL(source);
    if (u.origin !== 'https://livingobjects.ebi.ac.uk' || u.username || u.password) return;
    return /^\/bioimaging-integrator-data\/S-BIAD\d+\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\//i.exec(
      u.pathname,
    )?.[1];
  } catch {
    return;
  }
}
function accession(source: string): string | undefined {
  if (archiveImageId(source)) return /\/(S-BIAD\d+)\//.exec(new URL(source).pathname)?.[1];
}
async function json(url: string, signal: AbortSignal): Promise<RecordData> {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    cache: 'no-store',
  });
  if (!response.ok) throw Error(`BioImage Archive HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw Error('Empty archive response');
  const parts: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw Error('Archive metadata exceeds the 8 MiB limit');
      parts.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }
  return record(JSON.parse(new TextDecoder().decode(all)));
}
/** Scientific context is copied from the returned record, not inferred from another study. */
export function datasetFromRecord(value: unknown): Dataset {
  const source = record(value);
  const id = text(source.uuid),
    study = text(source.accession_id);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id) ||
    !/^S-BIAD\d+$/.test(study)
  )
    throw Error('Missing archive image/study identity');
  const urls = list(source.representation)
    .filter((r) => text(r.image_format).replace(/^\./, '') === 'ome.zarr')
    .flatMap((r) => list(r.file_uri));
  const uri = urls.find(
    (u) => typeof u === 'string' && archiveImageId(u) === id && accession(u) === study,
  );
  if (!uri) throw Error('No directly readable archive OME-Zarr representation');
  const title =
    text(source.study_title) || text(source.dataset_title) || `BioImage Archive ${study}`;
  const organisms = list(source.organism_classification)
    .map((o) => text(o.scientific_name))
    .filter(Boolean)
    .join(', ');
  const methods = list(source.imaging_method)
    .filter((m) => typeof m === 'string')
    .join(', ');
  const specimen = list(record(record(source.creation_process).subject).sample_of)
    .map((s) => [text(s.title), text(s.biological_entity_description)].filter(Boolean).join(': '))
    .join('; ');
  const file =
    text(source.label) || list(source.file_path).filter((p) => typeof p === 'string')[0] || id;
  const fileAnnotations = list(source.file_list_attributes)
    .flatMap((entry) =>
      Object.entries(record(record(entry.value).attributes))
        .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
        .map(([key, value]) => `${key}: ${value}`),
    )
    .join('; ');
  const license =
    text(record(source.licence_details).label) || 'License not supplied; check source';
  const author = list(source.author_display_name).filter((a) => typeof a === 'string')[0];
  const doi = text(list(source.publication).find((p) => text(p.doi))?.doi);
  const publicationUrl = doi ? (doi.startsWith('10.') ? `https://doi.org/${doi}` : doi) : undefined;
  return {
    id: `bia-${id}`,
    name: `${study} · ${file}`,
    url: canonical(uri) + '/',
    accession: study,
    imageId: id,
    attribution: `${author ? author + ' et al. · ' : ''}BioImage Archive ${study} · ${license}`,
    semantics:
      'Live archive discovery; one plane with exploratory predicted nuclei, not validated whole cells.',
    biology: {
      title,
      description: [
        organisms && `Organism: ${organisms}.`,
        methods && `Imaging: ${methods}.`,
        specimen && `Archive specimen: ${specimen}.`,
        `Image: ${file}.`,
        fileAnnotations && `File annotations: ${fileAnnotations}.`,
        'Biological context is reported by the archive; file-specific stains or treatments are not inferred.',
      ]
        .filter(Boolean)
        .join(' '),
      studyUrl: `https://www.ebi.ac.uk/biostudies/bioimages/studies/${study}`,
      ...(publicationUrl?.startsWith('https://doi.org/') ? { publicationUrl } : {}),
    },
  };
}

/** Inspect actual NGFF axes, levels, codecs and chunk budgets before selecting settings. */
export async function qualifyImage(sample: Dataset, signal: AbortSignal): Promise<Settings> {
  const check = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  let source: DuckDBZarrSource;
  try {
    source = await DuckDBZarrSource.open(sample.url, check);
  } catch (error) {
    check.throwIfAborted();
    if (!sample.url.endsWith('.ome.zarr/')) throw error;
    // Some converter roots contain an image group named 0; others are images themselves.
    source = await DuckDBZarrSource.open(sample.url + '0/', check);
  }
  const axes = source.metadata.axes.map((a) => a.name);
  let level = 0,
    info = await source.level(0);
  for (let i = 0; i < Math.min(source.metadata.levels.length, 13); i++) {
    const candidate = i === 0 ? info : await source.level(i);
    if (Math.min(candidate.shape[axes.indexOf('x')], candidate.shape[axes.indexOf('y')]) < 128)
      break;
    info = candidate;
    level = i;
    if (Math.max(info.shape[axes.indexOf('x')], info.shape[axes.indexOf('y')]) <= 768) break;
  }
  for (const axis of ['t', 'z']) {
    const index = axes.indexOf(axis);
    if (index >= 0 && (info.shape[index] !== 1 || info.chunks[index] !== 1))
      throw Error('Discovery requires a single Z/time plane per chunk');
  }
  const c = axes.indexOf('c'),
    channels = Array.from({ length: c < 0 ? 1 : info.shape[c] }, (_, i) => i);
  if (!channels.length || channels.length > 4) throw Error('Discovery supports 1–4 channels');
  const nuclear = source.metadata.channels.findIndex((ch) =>
    /dapi|hoechst|dna|draq|syto|nucle/i.test(ch.name),
  );
  if (nuclear < 0 && channels.length > 1)
    throw Error('No identifiable nuclear channel in multichannel image metadata');
  const segmentChannel = nuclear >= 0 && channels.includes(nuclear) ? nuclear : 0;
  const width = info.shape[axes.indexOf('x')],
    height = info.shape[axes.indexOf('y')];
  for (const channel of channels)
    planChunks(info, axes, {
      x: 0,
      y: 0,
      width: Math.min(512, width),
      height: Math.min(512, height),
      channel,
      t: 0,
      z: 0,
    });
  sample.url = source.url;
  sample.semantics +=
    nuclear >= 0
      ? ` Segmentation channel: ${source.metadata.channels[nuclear].name}.`
      : ' No nuclear channel is identified in metadata; channel 0 is an exploratory default.';
  return validateSettings({
    ...DEFAULT_SETTINGS,
    source: sample.url,
    segmentation: 'model',
    labelPath: '',
    level,
    channels,
    segmentChannel,
    count: Math.min(4, Math.ceil(width / 512) * Math.ceil(height / 512)),
    target: 10,
    cropSize: 64,
    seed: crypto.getRandomValues(new Uint32Array(1))[0].toString(),
  });
}

/** Persistent per-tab history; never recycle a small pool when live search fails. */
export class LiveImageDiscovery {
  private images = new Set<string>();
  private studies = new Set<string>();
  constructor() {
    try {
      const history = record(JSON.parse(sessionStorage.getItem(HISTORY_KEY) ?? '{}'));
      for (const value of list(history.images))
        if (typeof value === 'string') this.images.add(value);
      for (const value of list(history.studies))
        if (typeof value === 'string') this.studies.add(value);
    } catch {
      /* Memory-only history when storage is disabled. */
    }
  }
  remember(source: string): void {
    if (!archiveImageId(source)) return;
    this.images.add(archiveImageId(source)!);
    this.studies.add(accession(source)!);
    try {
      sessionStorage.setItem(
        HISTORY_KEY,
        JSON.stringify({ images: [...this.images], studies: [...this.studies] }),
      );
    } catch {
      /* Keep in-memory history. */
    }
  }
  async next(
    signal: AbortSignal,
    progress: (text: string) => void = () => {},
  ): Promise<{ sample: Dataset; settings: Settings }> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(60000)]);
    const params = new URLSearchParams({
      query: 'DAPI',
      includeDerivedImages: 'false',
      'has.converted_image': 'True',
      'size_z.lt': '2',
      'size_t.lt': '2',
      'size_c.lt': '5',
      'size_x.gt': '128',
      'size_y.gt': '128',
      'size_x.lt': '4097',
      'size_y.lt': '4097',
      'pagination.page_size': String(PAGE_SIZE),
      'pagination.page': '1',
    });
    for (const organism of ['homo sapiens', 'mus musculus'])
      params.append('facet.organism.or', organism);
    for (const method of [
      'fluorescence microscopy',
      'confocal microscopy',
      'array-scan confocal microscopy',
      'spinning disk confocal microscopy',
    ])
      params.append('facet.imaging_method.or', method);
    for (const method of [
      'transmission electron microscopy (tem)',
      'scanning electron microscopy (sem)',
      'simulated fluorescence microscopy',
    ])
      params.append('facet.imaging_method.not', method);
    for (const study of this.studies) params.append('facet.accession_id.not', study);
    progress('Searching BioImage Archive for an unseen dataset…');
    let response = await json(`${BIA_SEARCH}?${params}`, deadline);
    if (!Array.isArray(record(response.hits).hits))
      throw Error('Unexpected BioImage Archive search response');
    const pages = Math.max(
      1,
      Math.min(
        Number(record(response.pagination).total_pages) || 1,
        Math.floor(10000 / PAGE_SIZE),
        1000,
      ),
    );
    const triedPages = new Set<number>();
    const triedImages = new Set<string>();
    let checked = 0,
      lastError = '';
    for (let attempt = 0; attempt < Math.min(3, pages); attempt++) {
      let page = 1 + randomIndex(pages);
      while (triedPages.has(page)) page = (page % pages) + 1;
      triedPages.add(page);
      if (page !== 1 || attempt > 0) {
        params.set('pagination.page', String(page));
        response = await json(`${BIA_SEARCH}?${params}`, deadline);
      }
      const hits = [...list(record(response.hits).hits)];
      while (hits.length && checked < 12) {
        deadline.throwIfAborted();
        const hit = record(hits.splice(randomIndex(hits.length), 1)[0]);
        let sample: Dataset;
        try {
          sample = datasetFromRecord(hit._source);
        } catch {
          continue;
        }
        if (
          this.images.has(sample.imageId!) ||
          this.studies.has(sample.accession!) ||
          triedImages.has(sample.imageId!)
        )
          continue;
        triedImages.add(sample.imageId!);
        checked++;
        progress(`Checking new archive image ${checked} · ${sample.accession}…`);
        try {
          const settings = await qualifyImage(sample, deadline);
          deadline.throwIfAborted();
          this.remember(sample.url);
          sample.settings = settings;
          return { sample, settings };
        } catch (error) {
          deadline.throwIfAborted();
          lastError = error instanceof Error ? error.message : String(error);
        }
      }
    }
    throw Error(
      `No new compatible archive image found in this search. Previously viewed datasets are not repeated; try again later.${lastError ? ' Last compatibility check: ' + lastError : ''}`,
    );
  }
}

/** Restore live provenance for a reproducible source URL without replacing its settings. */
export async function describeArchiveSource(
  source: string,
  signal: AbortSignal,
): Promise<Dataset | undefined> {
  const id = archiveImageId(source);
  if (!id) return;
  const body = await json(
    `https://beta.bioimagearchive.org/search/v1/website/doc?uuid=${encodeURIComponent(id)}`,
    signal,
  );
  const hit = list(body.hits)[0];
  const sample = datasetFromRecord(record(hit)._source);
  if (
    canonical(sample.url) !== canonical(source) &&
    canonical(sample.url) + '/0' !== canonical(source)
  )
    throw Error('Archive metadata does not match the shared image URL');
  sample.url = source;
  return sample;
}
