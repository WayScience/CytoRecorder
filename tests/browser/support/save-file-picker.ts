import type { Page } from '@playwright/test';

/** The File System Access API's `showSaveFilePicker` opens a native OS
 * dialog — unsupported by Playwright and, in headless Chromium, hangs
 * forever waiting for a dialog that can never render. Production code
 * correctly uses the real API (with a plain-download fallback when it is
 * absent, e.g. Firefox); tests instead stub the API boundary itself, the
 * same way voice-recorder specs fake the microphone rather than needing a
 * real one. Captured writes land in `window.__savedFiles` for assertions. */
export async function stubSaveFilePicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __savedFiles: { name: string; text: string }[] }).__savedFiles = [];
    (
      window as unknown as {
        showSaveFilePicker: (options: { suggestedName?: string }) => Promise<{
          name: string;
          createWritable: () => Promise<{
            write: (data: Uint8Array) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }
    ).showSaveFilePicker = async (options) => {
      const name = options?.suggestedName ?? 'download';
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      return {
        name,
        createWritable: async () => ({
          write: async (data: Uint8Array) => {
            chunks.push(new Uint8Array(data));
          },
          close: async () => {
            const buffer = await new Blob(chunks).arrayBuffer();
            (
              window as unknown as { __savedFiles: { name: string; text: string }[] }
            ).__savedFiles.push({ name, text: new TextDecoder().decode(buffer) });
          },
        }),
      };
    };
  });
}
