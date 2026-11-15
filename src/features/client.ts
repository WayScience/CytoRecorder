import type { Crop } from '../core';
import type { MorphEmFeatureResult } from './morphem';
import type { FeatureClient } from './background';

/** One model worker, one native crop at a time; original crop buffers stay intact. */
export class MorphEmClient implements FeatureClient {
  private worker?: Worker;
  private epoch = 0;
  private nextId = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: {
    id: number;
    resolve: (r: MorphEmFeatureResult) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };

  embed(crop: Crop): Promise<MorphEmFeatureResult> {
    const epoch = this.epoch;
    const next = this.queue
      .catch(() => {})
      .then(() => {
        if (epoch !== this.epoch) throw new DOMException('MorphEm cancelled', 'AbortError');
        return new Promise<MorphEmFeatureResult>((resolve, reject) => {
          const id = ++this.nextId;
          const timer = setTimeout(
            () => this.fail(new Error('MorphEm worker timed out after 120 seconds')),
            120000,
          );
          this.pending = { id, resolve, reject, timer };
          try {
            if (!this.worker) {
              this.worker = new Worker(new URL('./morphem.worker.ts', import.meta.url), {
                type: 'module',
              });
              this.worker.onmessage = (event) => {
                if (!this.pending || event.data.id !== this.pending.id) return;
                if (event.data.type === 'error') {
                  this.fail(new Error(event.data.message));
                  return;
                }
                const pending = this.pending;
                this.pending = undefined;
                clearTimeout(pending.timer);
                pending.resolve(event.data.result);
              };
              this.worker.onerror = (event) => {
                event.preventDefault();
                this.fail(new Error(event.message || 'MorphEm worker failed'));
              };
              this.worker.onmessageerror = () =>
                this.fail(new Error('Cannot decode MorphEm worker response'));
            }
            // Resolve against the document base, not the hashed worker asset URL.
            const assetBase = new URL(import.meta.env.BASE_URL, document.baseURI).href;
            this.worker.postMessage({ id, crop, assetBase }); // deliberately no transfer of native pixels
          } catch (error) {
            this.fail(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    this.queue = next;
    return next;
  }
  cancel(): void {
    this.fail(new DOMException('MorphEm cancelled', 'AbortError'));
  }
  private fail(error: Error): void {
    this.epoch++;
    this.worker?.terminate();
    this.worker = undefined;
    const pending = this.pending;
    this.pending = undefined;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
}
