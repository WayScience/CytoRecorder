import { describe, expect, it, vi } from 'vitest';
import { MorphEmBackground } from '../src/features/background';
import type { MorphEmFeatureResult } from '../src/features/morphem';
import { deferred } from './support/voice-fakes';

// Deliberate worker-boundary controls for scheduling, not inference accuracy.
const cell = (cell_id: string) => ({
  cell_id,
  crop: { x: 0, y: 0, width: 1, height: 1, channels: [new Uint8Array([42])] },
});
const feature = (value: number): MorphEmFeatureResult => ({
  modelId: 'control',
  modelRevision: 'control',
  embeddings: [new Float32Array([value])],
  featureNames: ['control'],
  cropWidth: 1,
  cropHeight: 1,
  ms: 1,
});
const tick = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

describe('background MorphEm scheduling', () => {
  it('publishes incrementally and shares cached results with inspector requests', async () => {
    const a = deferred<MorphEmFeatureResult>(),
      b = deferred<MorphEmFeatureResult>();
    const client = {
      embed: vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise),
      cancel: vi.fn(),
    };
    const publish = vi.fn(async () => {});
    const job = new MorphEmBackground(client);
    job.start([cell('a'), cell('b')], publish);
    const waiting = job.waitFor('a');
    a.resolve(feature(42));
    await tick();
    expect((await waiting).embeddings[0][0]).toBe(42);
    expect(job.state.completed).toBe(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(client.embed).toHaveBeenCalledTimes(2);
    expect(await job.waitFor('a')).toBe(job.results.get('a'));
    b.resolve(feature(84));
    await tick();
    expect(job.state.phase).toBe('complete');
    expect(job.state.completed).toBe(2);
    expect(client.cancel).toHaveBeenCalled(); // release model/worker after completion
  });

  it('terminates in-flight work for voice, retains completed cells and resumes unfinished work', async () => {
    const active = deferred<MorphEmFeatureResult>(),
      resumed = deferred<MorphEmFeatureResult>();
    const client = {
      embed: vi
        .fn()
        .mockResolvedValueOnce(feature(1))
        .mockReturnValueOnce(active.promise)
        .mockReturnValueOnce(resumed.promise),
      cancel: vi.fn(() => active.reject(new DOMException('paused', 'AbortError'))),
    };
    const job = new MorphEmBackground(client);
    job.start([cell('a'), cell('b')], async () => {});
    await tick();
    expect(job.state.completed).toBe(1);
    job.pause('voice');
    await tick();
    expect(job.state.phase).toBe('paused');
    expect(client.embed).toHaveBeenCalledTimes(2);
    expect(job.results.has('a')).toBe(true);
    job.resume('voice');
    await tick();
    expect(client.embed).toHaveBeenCalledTimes(3);
    resumed.resolve(feature(2));
    await tick();
    expect(job.state.phase).toBe('complete');
    expect(job.state.completed).toBe(2);
  });

  it('ignores late results from an old image even when cell IDs are reused', async () => {
    const old = deferred<MorphEmFeatureResult>(),
      next = deferred<MorphEmFeatureResult>();
    const client = {
      embed: vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise),
      cancel: vi.fn(),
    };
    const publishOld = vi.fn(async () => {}),
      publishNew = vi.fn(async () => {});
    const job = new MorphEmBackground(client);
    job.start([cell('same-id')], publishOld);
    const waiting = job.waitFor('same-id').catch((e) => e.name);
    await tick();
    job.start([cell('same-id')], publishNew);
    old.resolve(feature(99));
    next.resolve(feature(3));
    await tick();
    expect(await waiting).toBe('AbortError');
    expect(publishOld).not.toHaveBeenCalled();
    expect(publishNew).toHaveBeenCalledTimes(1);
    expect(job.results.get('same-id')?.embeddings[0][0]).toBe(3);
  });

  it('reports model failure honestly and can retry without losing published results', async () => {
    const client = {
      embed: vi
        .fn()
        .mockResolvedValueOnce(feature(1))
        .mockRejectedValueOnce(new Error('model unavailable'))
        .mockResolvedValueOnce(feature(2)),
      cancel: vi.fn(),
    };
    const publish = vi.fn(async () => {});
    const job = new MorphEmBackground(client);
    job.start([cell('a'), cell('b')], publish);
    await tick();
    expect(job.state.phase).toBe('error');
    expect(job.state.error).toContain('model unavailable');
    expect(job.state.completed).toBe(1);
    await expect(job.waitFor('b')).rejects.toThrow('model unavailable');
    job.retry();
    await tick();
    expect(job.state.phase).toBe('complete');
    expect(job.state.completed).toBe(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('prioritizes an inspector request after the current crop without duplicate inference', async () => {
    const active = deferred<MorphEmFeatureResult>();
    const client = {
      embed: vi.fn().mockReturnValueOnce(active.promise).mockResolvedValue(feature(1)),
      cancel: vi.fn(),
    };
    const job = new MorphEmBackground(client);
    const cells = [cell('a'), cell('b'), cell('c')];
    job.start(cells, async () => {});
    const waiting = job.waitFor('c');
    active.resolve(feature(1));
    await tick();
    await waiting;
    expect(client.embed.mock.calls[1][0]).toBe(cells[2].crop);
    expect(client.embed).toHaveBeenCalledTimes(3);
  });

  it('does not resume a manually paused queue when voice closes', async () => {
    const client = { embed: vi.fn().mockResolvedValue(feature(1)), cancel: vi.fn() };
    const job = new MorphEmBackground(client);
    job.pause('manual');
    job.pause('voice');
    job.start([cell('a')], async () => {});
    job.resume('voice');
    await tick();
    expect(client.embed).not.toHaveBeenCalled();
    job.resume('manual');
    await tick();
    expect(job.state.phase).toBe('complete');
  });
});
