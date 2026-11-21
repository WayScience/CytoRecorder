import { test, expect } from '@playwright/test';

// Real Arrow/DuckDB export scheduling, not microscopy or model accuracy.
test('a custom annotation label syncs to a real exported table column, by cell_id, and clears on resync', async ({
  page,
}) => {
  await page.goto('/src/database.ts');
  const result = await page.evaluate(async () => {
    const path = '/src/database.ts';
    const { loadCells, queryCells, syncLabels, exportTable, database } = await import(path);
    const cells = ['a', 'b'].map((cell_id) => ({
      cell_id,
      source: 'https://example.invalid/control',
      label: 1,
      area: 1,
      channels: [42],
      means: [42],
      crop: { x: 0, y: 0, width: 1, height: 1, channels: [new Uint8Array([42])] },
    }));
    await loadCells(cells);
    // Unlabeled cells export a real NULL, not a fabricated empty string.
    const beforeLabeling = (await queryCells('SELECT cell_id, annotation_label FROM labels')).rows;
    await syncLabels(cells, new Map([['a', 'Mitotic']]));
    const bytes = await exportTable('SELECT * FROM cells', 'parquet', false);
    const { db, connection } = await database();
    await db.registerFileBuffer('labels.parquet', bytes);
    let labeledExport;
    try {
      labeledExport = (
        await connection.query(
          "SELECT cell_id, annotation_label FROM read_parquet('labels.parquet') ORDER BY cell_id",
        )
      )
        .toArray()
        .map((r: unknown) => JSON.parse(JSON.stringify(r)));
    } finally {
      await db.dropFile('labels.parquet');
    }
    // A later resync with a different cell labeled must clear the first label, not accumulate it.
    await syncLabels(cells, new Map([['b', 'Apoptotic']]));
    const afterResync = (await queryCells('SELECT cell_id, annotation_label FROM labels')).rows;
    return { beforeLabeling, labeledExport, afterResync };
  });
  expect(result.beforeLabeling).toEqual([
    { cell_id: 'a', annotation_label: null },
    { cell_id: 'b', annotation_label: null },
  ]);
  expect(result.labeledExport).toEqual([
    { cell_id: 'a', annotation_label: 'Mitotic' },
    { cell_id: 'b', annotation_label: null },
  ]);
  expect(result.afterResync).toEqual([
    { cell_id: 'a', annotation_label: null },
    { cell_id: 'b', annotation_label: 'Apoptotic' },
  ]);
});

test('a label sync meant for an old, already-replaced run cannot contaminate the new one', async ({
  page,
}) => {
  await page.goto('/src/database.ts');
  const result = await page.evaluate(async () => {
    const path = '/src/database.ts';
    const { loadCells, syncLabels, queryCells } = await import(path);
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
    const accepted = await syncLabels(old, new Map([['same-id', 'Stale']]));
    await replacement;
    return {
      accepted,
      rows: (await queryCells('SELECT cell_id, annotation_label FROM labels')).rows,
    };
  });
  expect(result).toEqual({
    accepted: false,
    rows: [{ cell_id: 'same-id', annotation_label: null }],
  });
});
