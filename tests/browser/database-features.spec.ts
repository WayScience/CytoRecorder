import { test, expect } from '@playwright/test';

// Tiny metadata/embedding controls exercise real Arrow/DuckDB export scheduling,
// not microscopy or model accuracy (covered by the real-crop suites).
test('incremental features join exports without changing base measurements or filling missing features with zero', async ({
  page,
}) => {
  await page.goto('/src/database.ts');
  const result = await page.evaluate(async () => {
    const path = '/src/database.ts';
    const { loadCells, queryCells, publishCellFeatures, exportTable, database } = await import(
      path
    );
    const cells = ['a', 'b'].map((cell_id) => ({
      cell_id,
      source: 'https://example.invalid/control',
      label: 1,
      area: 1,
      channels: [42],
      means: [42],
      crop: { x: 0, y: 0, width: 1, height: 1, channels: [new Uint8Array([42])] },
    }));
    const feature = {
      modelId: 'control',
      modelRevision: 'control',
      embeddings: [Float32Array.from({ length: 384 }, (_, i) => i + 0.5)],
      featureNames: [],
      cropWidth: 1,
      cropHeight: 1,
      ms: 1,
    };
    await loadCells(cells);
    const before = (await queryCells('SELECT * FROM cells ORDER BY cell_id')).rows;
    const publish = publishCellFeatures(cells, 'a', feature);
    const bytes = await exportTable('SELECT * FROM cells', 'parquet', true);
    await publish;
    const { db, connection } = await database();
    await db.registerFileBuffer('control.parquet', bytes);
    try {
      const rows = (
        await connection.query(
          "SELECT cell_id, morphem_status, morphem_model_id, morphem_channels, MorphEm_Feature0_Channel0 AS first, MorphEm_Feature383_Channel0 AS last FROM read_parquet('control.parquet') ORDER BY cell_id",
        )
      )
        .toArray()
        .map((r: unknown) => JSON.parse(JSON.stringify(r)));
      return {
        rows,
        before,
        after: (await queryCells('SELECT * FROM cells ORDER BY cell_id')).rows,
      };
    } finally {
      await db.dropFile('control.parquet');
    }
  });
  expect(result.after).toEqual(result.before);
  expect(result.rows).toEqual([
    {
      cell_id: 'a',
      morphem_status: 'ready',
      morphem_model_id: 'control',
      morphem_channels: '42',
      first: 0.5,
      last: 383.5,
    },
    {
      cell_id: 'b',
      morphem_status: 'pending',
      morphem_model_id: null,
      morphem_channels: '42',
      first: null,
      last: null,
    },
  ]);
});

test('late features for an old image cannot contaminate a new image reusing the same cell ID', async ({
  page,
}) => {
  await page.goto('/src/database.ts');
  const result = await page.evaluate(async () => {
    const path = '/src/database.ts';
    const { loadCells, publishCellFeatures, queryCells } = await import(path);
    const record = (source: string) => [
      {
        cell_id: 'same-id',
        source,
        label: 1,
        area: 1,
        channels: [0],
        means: [1],
        crop: { x: 0, y: 0, width: 1, height: 1, channels: [new Uint8Array([42])] },
      },
    ];
    const old = record('https://example.invalid/old'),
      current = record('https://example.invalid/new');
    await loadCells(old);
    const replacement = loadCells(current);
    const accepted = await publishCellFeatures(old, 'same-id', {
      modelId: 'control',
      modelRevision: 'control',
      embeddings: [new Float32Array(384).fill(99)],
      featureNames: [],
      cropWidth: 1,
      cropHeight: 1,
      ms: 1,
    });
    await replacement;
    return {
      accepted,
      rows: (await queryCells('SELECT cell_id, morphem_status FROM morphem_features')).rows,
    };
  });
  expect(result).toEqual({
    accepted: false,
    rows: [{ cell_id: 'same-id', morphem_status: 'pending' }],
  });
});
