import * as duckdb from '@duckdb/duckdb-wasm';
import { tableFromJSON } from 'apache-arrow';
import { cellRow, type Cell } from './pipeline';
import { validateSelect } from './exports';
import runtimeAssets from '../scripts/runtime-assets.json';
import { MORPHEM_MODEL_INFO, MORPHEM_PREPROCESSING } from './features/config';
import type { MorphEmFeatureResult } from './features/morphem';
// Both dev modules (src/) and production bundles (assets/) are one level below
// the app root. Unlike location.href, this also works inside the app worker.
const vendor = new URL('../vendor/', import.meta.url).href.replace(/\/?$/, '/');
let enginePromise:
  Promise<{ db: duckdb.AsyncDuckDB; connection: duckdb.AsyncDuckDBConnection }> | undefined;
export function database() {
  return (enginePromise ??= openDatabase());
}
async function openDatabase() {
  let db: duckdb.AsyncDuckDB | undefined;
  let connection: duckdb.AsyncDuckDBConnection | undefined;
  try {
    const worker = new Worker(vendor + 'duckdb-browser-base.worker.js', { type: 'module' });
    db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
    await db.instantiate(vendor + 'duckdb-base.wasm');
    await db.open({
      // The official community WASM fails signature validation in this runtime
      // even though its source bytes are pinned. Only the hash-checked, same-
      // origin artifacts below are loaded; automatic installation stays off.
      allowUnsignedExtensions: true,
      query: { castBigIntToDouble: true, castTimestampToDate: true },
    });
    connection = await db.connect();
    const version = (await connection.query('SELECT version() AS version')).toArray()[0].version;
    if (version !== runtimeAssets.engine)
      throw Error(`Expected DuckDB ${runtimeAssets.engine}, received ${version}`);
    await connection.query('SET autoinstall_known_extensions=false');
    await connection.query('SET autoload_known_extensions=false');
    return { db, connection };
  } catch (e) {
    await connection?.close().catch(() => {});
    await db?.terminate().catch(() => {});
    enginePromise = undefined;
    throw Error(
      `Cannot start local DuckDB. Run npm run setup:assets and rebuild. ${e instanceof Error ? e.message : e}`,
    );
  }
}
let generation = 0;
let currentCells: Cell[] | undefined;
let operationQueue: Promise<unknown> = Promise.resolve();
/** Serialize the complete operation, not only its first query. */
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = operationQueue.catch(() => {}).then(work);
  operationQueue = next;
  return next;
}
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
function featureNames(channels: number): string[] {
  return Array.from({ length: channels }, (_, c) =>
    Array.from(
      { length: MORPHEM_MODEL_INFO.embedDim },
      (_, i) => `MorphEm_Feature${i}_Channel${c}`,
    ),
  ).flat();
}
export function loadCells(cells: Cell[]): Promise<boolean> {
  const id = ++generation;
  currentCells = cells;
  return enqueue(async () => {
    const { connection } = await database();
    if (id !== generation) return false;
    await connection.query('BEGIN TRANSACTION');
    try {
      await connection.query('DROP TABLE IF EXISTS cells');
      if (cells.length)
        await connection.insertArrowTable(tableFromJSON(cells.map(cellRow)), {
          name: 'cells',
          create: true,
        });
      else
        await connection.query(
          'CREATE TABLE cells(cell_id VARCHAR, area INTEGER, cx DOUBLE, cy DOUBLE)',
        );
      await connection.query('DROP TABLE IF EXISTS morphem_features');
      const names = featureNames(cells.reduce((n, cell) => Math.max(n, cell.channels.length), 0));
      await connection.query(`CREATE TABLE morphem_features AS SELECT cell_id, 'pending' AS morphem_status,
        CAST(NULL AS VARCHAR) AS morphem_model_id, CAST(NULL AS VARCHAR) AS morphem_model_revision,
        CAST(NULL AS VARCHAR) AS morphem_preprocessing, CAST(NULL AS VARCHAR) AS morphem_channels
        ${names.map((name) => `, CAST(NULL AS FLOAT) AS "${name}"`).join('')} FROM cells`);
      for (const cell of cells)
        await connection.query(
          `UPDATE morphem_features SET morphem_channels=${quote(cell.channels.join(','))} WHERE cell_id=${quote(cell.cell_id)}`,
        );
      await connection.query('COMMIT');
      return id === generation;
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    }
  });
}
/** Publish only into the exact run that supplied these native crops. */
export function publishCellFeatures(
  cells: Cell[],
  cellId: string,
  features: MorphEmFeatureResult,
): Promise<boolean> {
  return enqueue(async () => {
    if (currentCells !== cells) return false;
    const cell = cells.find((cell) => cell.cell_id === cellId);
    if (!cell) throw Error('Unknown feature cell');
    if (
      features.embeddings.length !== cell.channels.length ||
      features.embeddings.some(
        (e) => e.length !== MORPHEM_MODEL_INFO.embedDim || e.some((v) => !Number.isFinite(v)),
      )
    )
      throw Error('Invalid MorphEm feature shape or non-finite embedding');
    const values = features.embeddings.flatMap((e) => Array.from(e));
    const names = featureNames(cell.channels.length);
    const { connection } = await database();
    await connection.query(`UPDATE morphem_features SET morphem_status='ready',
      morphem_model_id=${quote(features.modelId)}, morphem_model_revision=${quote(features.modelRevision)},
      morphem_preprocessing=${quote(MORPHEM_PREPROCESSING)}
      ${names.map((name, i) => `, "${name}"=${values[i]}`).join('')} WHERE cell_id=${quote(cellId)}`);
    return currentCells === cells;
  });
}
export function queryCells(sql: string) {
  return enqueue(async () => {
    const { connection } = await database();
    const table = await connection.query(
      `SELECT * FROM (${validateSelect(sql)}) AS query_result LIMIT 10001`,
    );
    const rows = table
      .toArray()
      .map((row) =>
        JSON.parse(JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))),
      );
    if (rows.length > 10000) throw Error('Query result exceeds the 10,000-row limit');
    return {
      rows: rows as Record<string, unknown>[],
      columns: table.schema.fields.map((f) => f.name),
    };
  });
}
let parquetPromise: Promise<void> | undefined;
let zarrPromise: Promise<void> | undefined;
async function loadPinnedExtension(name: 'parquet' | 'zarr') {
  const asset = runtimeAssets.extensions.find((asset) =>
    asset.path.endsWith(`/${name}.duckdb_extension.wasm`),
  );
  if (!asset) throw Error(`Missing ${name} extension pin`);
  const url = new URL(asset.path, vendor);
  if (url.origin !== location.origin) throw Error('Extension must be served from the app origin');
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`Extension download: HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== asset.bytes) throw Error(`${name} extension size mismatch`);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== asset.sha256) throw Error(`${name} extension SHA-256 mismatch`);
  const { connection } = await database();
  // The WASM loader resolves LOAD by repository/name even after URL INSTALL.
  // Keep that resolution on the same pinned, same-origin repository too.
  await connection.query(
    `SET custom_extension_repository='${new URL('extensions', vendor).href.replaceAll("'", "''")}'`,
  );
  await connection.query(`INSTALL ${name}`);
  await connection.query(`LOAD ${name}`);
}
export async function ensureZarr(): Promise<void> {
  return (zarrPromise ??= loadPinnedExtension('zarr').catch((e) => {
    zarrPromise = undefined;
    throw Error(
      `Pinned official Zarr extension unavailable; run npm run setup:assets and rebuild. ${e instanceof Error ? e.message : e}`,
    );
  }));
}
async function ensureParquet() {
  return (parquetPromise ??= loadPinnedExtension('parquet').catch((e) => {
    parquetPromise = undefined;
    throw Error(
      `Pinned local Parquet extension unavailable; run npm run setup:assets and rebuild. ${e instanceof Error ? e.message : e}`,
    );
  }));
}
let exportId = 0;
export function exportTable(
  sql: string,
  format: 'csv' | 'parquet',
  includeFeatures = false,
): Promise<Uint8Array> {
  return enqueue(async () => {
    const { db, connection } = await database();
    const selected = validateSelect(sql);
    const query = includeFeatures
      ? `SELECT selected.*, features.* EXCLUDE (cell_id) FROM (${selected}) selected LEFT JOIN morphem_features features USING (cell_id)`
      : selected;
    const name = `cytorecorder-${++exportId}.${format}`;
    if (format === 'parquet') await ensureParquet();
    try {
      await connection.query(
        `COPY (${query}) TO '${name}' (FORMAT ${format.toUpperCase()}${format === 'csv' ? ', HEADER TRUE' : ''})`,
      );
      return await db.copyFileToBuffer(name);
    } finally {
      await db.dropFile(name).catch(() => {});
    }
  });
}
