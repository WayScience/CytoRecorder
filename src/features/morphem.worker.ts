import { embedMorphEm } from './morphem';
import type { Crop } from '../core';

self.onmessage = async (event: MessageEvent<{ id: number; crop: Crop; assetBase: string }>) => {
  const { id, crop, assetBase } = event.data;
  try {
    const result = await embedMorphEm(crop, { assetBase });
    self.postMessage({ id, type: 'result', result });
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
