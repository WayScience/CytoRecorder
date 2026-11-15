import { DEFAULT_SETTINGS, validateSettings, type Settings } from './core';

export interface Dataset {
  id: string;
  name: string;
  url: string;
  attribution: string;
  semantics: string;
  /** Present for live API discovery; not inferred for custom images. */
  accession?: string;
  imageId?: string;
  settings?: Partial<Settings>;
  biology?: {
    title: string;
    description: string;
    studyUrl?: string;
    publicationUrl?: string;
  };
}
// Injected from public/datasets.json by Vite in both dev and production builds.
declare const __DATASET_MANIFEST__: { samples: Dataset[] };
const manifest = __DATASET_MANIFEST__;
/** Reference-pool samples, in manifest order. */
export const REFERENCE_POOL: Dataset[] = manifest.samples.filter((sample) =>
  ['bia3204-ring-rep2', 'bia2247-tpr-nih3t3', 'bia1735-dsb-nuclei'].includes(sample.id),
);
function settingsFor(sample: Dataset): Settings {
  return validateSettings({ ...DEFAULT_SETTINGS, ...sample.settings, source: sample.url });
}
/**
 * Resolve a checked example for explicit ?reference=<id> and legacy URLs.
 * The day-based fallback is retained for parsing; ordinary fresh-page loads and
 * the new-image button use live archive discovery, not this fixed example list.
 */
export function referenceForDate(date = new Date(), pinned?: string | null): Settings {
  if (pinned) {
    const sample = REFERENCE_POOL.find((s) => s.id === pinned);
    if (sample) return settingsFor(sample);
  }
  const day = Math.floor(date.getTime() / 86_400_000);
  const sample = REFERENCE_POOL[day % REFERENCE_POOL.length]!;
  return settingsFor(sample);
}
/** Settings for the first reference-pool image. */
export const REFERENCE_SETTINGS: Settings = settingsFor(REFERENCE_POOL[0]!);
function imageKey(source: string): string {
  const url = new URL(source);
  return url.origin + url.pathname.replace(/\/+$/, '');
}
const discovered = new Map<string, Dataset>();
export function registerDataset(sample: Dataset): void {
  discovered.set(imageKey(sample.url), sample);
}
/** Match exact image groups, never a substring or another store's numeric image ID. */
export function datasetForSource(source: string): Dataset | undefined {
  try {
    const key = imageKey(source);
    return discovered.get(key) ?? manifest.samples.find((sample) => imageKey(sample.url) === key);
  } catch {
    return undefined;
  }
}
