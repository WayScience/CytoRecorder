import { describe, expect, it } from 'vitest';
import {
  datasetForSource,
  referenceForDate,
  REFERENCE_POOL,
  REFERENCE_SETTINGS,
} from '../src/datasets';
import { DEFAULT_SETTINGS, parseSettings, validateSettings } from '../src/core';

describe('curated biological context', () => {
  it('pins a BIA image with valid exploratory nuclei settings', () => {
    expect(validateSettings(REFERENCE_SETTINGS)).toEqual(REFERENCE_SETTINGS);
    const sample = datasetForSource(REFERENCE_SETTINGS.source)!;
    expect(sample.id).toBe('bia3204-ring-rep2');
    expect(sample.biology?.title).toBe('Human U2OS cells under heat stress');
    expect(sample.biology?.description).toContain('G3BP1/2-knockout');
    expect(sample.biology?.description).toContain('RING');
    expect(REFERENCE_SETTINGS.channels).toEqual([0, 1, 2]);
    expect(REFERENCE_SETTINGS.segmentChannel).toBe(2);
    expect(REFERENCE_SETTINGS.segmentation).toBe('model');
    expect(REFERENCE_SETTINGS.labelPath).toBe('');
  });
  it('matches image groups exactly but tolerates trailing slashes and query tokens', () => {
    const source = REFERENCE_SETTINGS.source;
    expect(datasetForSource(source.replace(/\/$/, ''))?.id).toBe('bia3204-ring-rep2');
    expect(datasetForSource(source + '?token=example')?.id).toBe('bia3204-ring-rep2');
    expect(datasetForSource(source + 'another-image/')).toBeUndefined();
    expect(
      datasetForSource(source.replace('livingobjects.ebi.ac.uk', 'example.org')),
    ).toBeUndefined();
    expect(datasetForSource('not a URL')).toBeUndefined();
    expect(datasetForSource('https://example.org/10501752.zarr/')).toBeUndefined();
    expect(datasetForSource(DEFAULT_SETTINGS.source)?.id).toBe('idr0076-10501752');
  });
  it('uses the new reference for fresh pages but preserves old incomplete image links', () => {
    expect(parseSettings('https://example.org/', REFERENCE_SETTINGS)).toEqual(REFERENCE_SETTINGS);
    expect(parseSettings('https://example.org/?seed=abc', REFERENCE_SETTINGS).source).toBe(
      REFERENCE_SETTINGS.source,
    );
    const legacy = parseSettings(
      'https://example.org/?source=' + encodeURIComponent(DEFAULT_SETTINGS.source),
      REFERENCE_SETTINGS,
    );
    expect(legacy.source).toBe(DEFAULT_SETTINGS.source);
    expect(legacy.channels).toEqual([42]);
    expect(legacy.level).toBe(0);
    expect(legacy.segmentation).toBe('labels');
  });
});

describe('daily rotating reference pool', () => {
  it('contains the three qualified BIA images in manifest order', () => {
    expect(REFERENCE_POOL.map((sample) => sample.id)).toEqual([
      'bia3204-ring-rep2',
      'bia2247-tpr-nih3t3',
      'bia1735-dsb-nuclei',
    ]);
    for (const sample of REFERENCE_POOL) {
      expect(sample.biology?.title).toBeTruthy();
      expect(sample.attribution).toContain('BioImage Archive S-BIAD');
      expect(sample.settings).toBeTruthy();
    }
  });
  it('picks a different image per day and cycles through the whole pool', () => {
    const day = (n: number) => referenceForDate(new Date(Date.UTC(2026, 10, 13 + n)));
    const picks = new Set<string>();
    for (let i = 0; i < REFERENCE_POOL.length; i++) {
      const settings = day(i);
      expect(validateSettings(settings)).toEqual(settings);
      picks.add(settings.source);
    }
    expect(picks.size).toBe(REFERENCE_POOL.length);
    expect(day(0).source).toBe(day(REFERENCE_POOL.length).source);
  });
  it('respects a pinned reference id and ignores unknown ones', () => {
    const pinned = referenceForDate(new Date(0), 'bia1735-dsb-nuclei');
    expect(datasetForSource(pinned.source)?.id).toBe('bia1735-dsb-nuclei');
    expect(() => referenceForDate(new Date(0), 'not-a-sample')).not.toThrow();
    const fallback = referenceForDate(new Date(0), 'not-a-sample');
    expect(REFERENCE_POOL.some((s) => s.url === fallback.source)).toBe(true);
  });
});
