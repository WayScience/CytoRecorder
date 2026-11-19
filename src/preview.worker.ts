/// <reference lib="webworker" />
import { openImageSource } from './sources/factory';
import { fetchWholeImagePreview } from './preview';
import type { Settings } from './core';
/** Dedicated worker, separate from worker.ts, so loading a whole-image
 * preview never shares a generation counter with (or gets torn down by)
 * the sampling run or background MorphEm featurization. */
self.onmessage = async (event: MessageEvent<{ id: number; settings: Settings }>) => {
  const { id, settings } = event.data,
    controller = new AbortController();
  const send = (type: string, data: unknown) => self.postMessage({ id, type, data });
  try {
    const source = await openImageSource(settings.source, settings.reader, controller.signal),
      preview = await fetchWholeImagePreview(source, {
        z: settings.z,
        t: settings.t,
        channels: settings.channels,
      });
    if (!preview) {
      send(
        'unavailable',
        'No pyramid level is small enough for a lightweight whole-image preview.',
      );
      return;
    }
    send('preview', preview);
  } catch (error) {
    send('error', error instanceof Error ? error.message : String(error));
  }
};
