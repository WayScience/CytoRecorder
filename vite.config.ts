import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  // Bundle the curated public catalog without importing a Vite public asset as JS.
  define: {
    __DATASET_MANIFEST__: readFileSync(new URL('./public/datasets.json', import.meta.url), 'utf8'),
  },
  base: process.env.BASE_PATH || './',
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@duckdb/duckdb-wasm'] },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 },
});
