import type { Crop } from '../core';
import type { MorphEmFeatureResult } from './morphem';

export interface FeatureCell {
  cell_id: string;
  crop: Crop;
}
export interface FeatureClient {
  embed(crop: Crop): Promise<MorphEmFeatureResult>;
  cancel(): void;
}
export interface FeatureProgress {
  phase: 'idle' | 'running' | 'paused' | 'complete' | 'error';
  completed: number;
  total: number;
  error?: string;
}
/** One sequential, cancellable job per sampled image; no inference on the UI thread. */
export class MorphEmBackground {
  readonly results = new Map<string, MorphEmFeatureResult>();
  state: FeatureProgress = { phase: 'idle', completed: 0, total: 0 };
  private epoch = 0;
  private cells: FeatureCell[] = [];
  private pauses = new Set<string>();
  private wake = new Set<() => void>();
  private waiting = new Map<
    string,
    { resolve: (v: MorphEmFeatureResult) => void; reject: (e: Error) => void }[]
  >();
  private publish: (cell: FeatureCell, result: MorphEmFeatureResult) => Promise<void> =
    async () => {};

  constructor(
    private readonly client: FeatureClient,
    private readonly onChange: (state: FeatureProgress) => void = () => {},
  ) {}

  start(cells: FeatureCell[], publish: typeof this.publish): void {
    this.stop();
    this.results.clear();
    this.cells = cells;
    this.publish = publish;
    this.launch();
  }
  private change(phase: FeatureProgress['phase'], error?: string) {
    this.state = {
      phase,
      completed: this.results.size,
      total: this.cells.length,
      ...(error ? { error } : {}),
    };
    this.onChange(this.state);
  }
  stop(): void {
    this.epoch++;
    if (this.cells.length) this.client.cancel();
    this.rejectWaiting(new DOMException('Image changed or featurization stopped', 'AbortError'));
    this.cells = [];
    for (const wake of this.wake) wake();
    this.wake.clear();
    this.change('idle');
  }
  pause(reason: string): void {
    this.pauses.add(reason);
    if (this.state.phase === 'running') {
      this.client.cancel(); // immediate worker termination also releases the model
      this.change('paused');
    }
  }
  resume(reason: string): void {
    this.pauses.delete(reason);
    if (this.pauses.size) return;
    for (const wake of this.wake) wake();
    this.wake.clear();
  }
  retry(): void {
    if (this.state.phase !== 'error') return;
    this.launch();
  }
  waitFor(cellId: string): Promise<MorphEmFeatureResult> {
    const cached = this.results.get(cellId);
    if (cached) return Promise.resolve(cached);
    if (this.state.phase === 'error') return Promise.reject(new Error(this.state.error));
    if (!this.cells.some((cell) => cell.cell_id === cellId))
      return Promise.reject(new Error('Crop does not belong to the active sample'));
    return new Promise((resolve, reject) => {
      const waiting = this.waiting.get(cellId) ?? [];
      waiting.push({ resolve, reject });
      this.waiting.set(cellId, waiting);
    });
  }
  private rejectWaiting(error: Error) {
    for (const waiting of this.waiting.values()) for (const waiter of waiting) waiter.reject(error);
    this.waiting.clear();
  }
  private launch() {
    const epoch = ++this.epoch;
    this.change(this.pauses.size ? 'paused' : 'running');
    void this.run(epoch);
  }
  private async run(epoch: number) {
    try {
      while (epoch === this.epoch) {
        const cell =
          this.cells.find((c) => this.waiting.has(c.cell_id) && !this.results.has(c.cell_id)) ??
          this.cells.find((c) => !this.results.has(c.cell_id));
        if (!cell) break;
        while (!this.results.has(cell.cell_id)) {
          if (epoch !== this.epoch) return;
          if (this.pauses.size) {
            this.change('paused');
            await new Promise<void>((resolve) => this.wake.add(resolve));
            continue;
          }
          this.change('running');
          let features: MorphEmFeatureResult;
          try {
            features = await this.client.embed(cell.crop);
          } catch (error) {
            if (epoch !== this.epoch) return;
            if (error instanceof Error && error.name === 'AbortError') continue;
            throw error;
          }
          if (epoch !== this.epoch) return;
          await this.publish(cell, features);
          if (epoch !== this.epoch) return;
          this.results.set(cell.cell_id, features);
          for (const waiting of this.waiting.get(cell.cell_id) ?? []) waiting.resolve(features);
          this.waiting.delete(cell.cell_id);
          this.change(this.pauses.size ? 'paused' : 'running');
        }
      }
      if (epoch === this.epoch) {
        this.client.cancel();
        this.change('complete');
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.client.cancel();
      const message = error instanceof Error ? error.message : String(error);
      this.change('error', message);
      this.rejectWaiting(new Error(message));
    }
  }
}
