/// <reference lib="webworker" />
import { runPipeline } from './pipeline';
import { openImageSource } from './sources/factory';
import { DuckDBZarrSource } from './sources/duckdb-zarr';
import type { Settings } from './core';
import { ReadSession } from './sources/read-session';
self.onmessage = async (
  event: MessageEvent<{
    id: number;
    action: 'run' | 'inspect';
    settings: Settings;
    files?: [string, File][];
  }>,
) => {
  const { id, settings, action, files } = event.data,
    controller = new AbortController();
  const send = (type: string, data: unknown) => self.postMessage({ id, type, data });
  try {
    const local = files ? new Map(files) : undefined;
    const openSource = (session: ReadSession) =>
      local
        ? DuckDBZarrSource.openLocal(local, settings.source, controller.signal)
        : openImageSource(settings.source, settings.reader, controller.signal, session);
    if (action === 'inspect') {
      const source = await openSource(
          new ReadSession(controller.signal, (p) => send('network', p)),
        ),
        array = await source.level(settings.level);
      send('metadata', {
        metadata: source.metadata,
        alignment: await source.alignment(settings.level),
        dtype: array.dtype,
        chunks: array.chunks,
      });
      return;
    }
    const result = await runPipeline(settings, {
      signal: controller.signal,
      source: local
        ? await DuckDBZarrSource.openLocal(local, settings.source, controller.signal)
        : undefined,
      onProgress: (p) => send('progress', p),
      onNetwork: (p) => send('network', p),
      onBatch: (p) => send('batch', p),
    });
    send('result', result);
  } catch (error) {
    send('error', error instanceof Error ? error.message : String(error));
  }
};
