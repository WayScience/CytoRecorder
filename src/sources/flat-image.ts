import UTIF from 'utif2';
import type { Pixels } from '../core';

/** Flat, non-pyramid, non-chunked images: a true-color PNG draws directly; a
 * (possibly multi-page) TIFF exposes each page as a grayscale channel, reusing
 * the same channel toggle/composite machinery as OME-Zarr channels. Neither
 * format carries OME-NGFF physical scale, so no scale bar is fabricated for
 * either, and there is no segmentation/cropping pipeline for either in this
 * "single image" mode — display only. */
export type FlatImage =
  | { kind: 'rgb'; width: number; height: number; rgba: Uint8ClampedArray; name: string }
  | {
      kind: 'channels';
      width: number;
      height: number;
      channels: Pixels[];
      channelNames: string[];
      name: string;
    };

const MAX_DECODE_BYTES = 256 * 1024 * 1024; // Bounded local decode; not a network budget.

export async function decodeFlatImage(file: File): Promise<FlatImage> {
  if (file.size > MAX_DECODE_BYTES)
    throw Error(
      `${file.name} is ${(file.size / 1048576).toFixed(0)} MiB; local flat-image decode is bounded to ${MAX_DECODE_BYTES / 1048576} MiB.`,
    );
  const name = file.name.toLowerCase();
  if (name.endsWith('.png')) return decodePng(file);
  if (name.endsWith('.tif') || name.endsWith('.tiff')) return decodeTiff(file);
  throw Error(`Unsupported image format: ${file.name}. Use .png, .tif or .tiff.`);
}

async function decodePng(file: File): Promise<FlatImage> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw Error('2D canvas context unavailable to decode PNG');
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = context.getImageData(0, 0, width, height);
  return { kind: 'rgb', width, height, rgba: data, name: file.name };
}

async function decodeTiff(file: File): Promise<FlatImage> {
  const buffer = await file.arrayBuffer();
  const ifds = UTIF.decode(buffer);
  if (!ifds.length) throw Error(`${file.name} contains no TIFF image directories`);
  const channels: Pixels[] = [],
    channelNames: string[] = [];
  let width = 0,
    height = 0;
  ifds.forEach((ifd, i) => {
    UTIF.decodeImage(buffer, ifd);
    if (i === 0) {
      width = ifd.width;
      height = ifd.height;
    } else if (ifd.width !== width || ifd.height !== height) {
      // Multi-page TIFFs with mismatched page sizes are not a single aligned
      // image; only the pages matching the first page's dimensions are kept.
      return;
    }
    const rgba = UTIF.toRGBA8(ifd),
      gray = new Uint8Array(width * height);
    for (let p = 0; p < gray.length; p++) gray[p] = rgba[p * 4]; // toRGBA8 is grayscale-faithful on R for non-color TIFFs
    channels.push(gray);
    channelNames.push(`Page ${i}`);
  });
  if (!channels.length) throw Error(`${file.name} has no decodable TIFF pages`);
  return { kind: 'channels', width, height, channels, channelNames, name: file.name };
}
