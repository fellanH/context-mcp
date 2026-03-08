import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { createTestCtx } from '../helpers/ctx.js';
import { captureAndIndex, updateEntryFile } from '@context-vault/core/capture';
import { indexEntry } from '@context-vault/core/index';
import { hybridSearch } from '@context-vault/core/search';

describe('save → search → list → update → delete roundtrip', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  let savedId;
  let savedFilePath;

  it('saves an entry', async () => {
    const entry = await captureAndIndex(ctx, {
      kind: 'insight',
      title: 'SQLite WAL mode',
      body: 'WAL mode allows concurrent reads and writes in SQLite databases',
      tags: ['sqlite', 'database'],
      source: 'test',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.filePath).toBeTruthy();
    expect(existsSync(entry.filePath)).toBe(true);
    expect(entry.kind).toBe('insight');

    savedId = entry.id;
    savedFilePath = entry.filePath;
  }, 30000);

  it('searches and finds the entry', async () => {
    const results = await hybridSearch(ctx, 'SQLite WAL concurrent');
    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.id === savedId);
    expect(found).toBeTruthy();
    expect(found.kind).toBe('insight');
  }, 30000);

  it('lists the entry via SQL', () => {
    const rows = ctx.db
      .prepare(
        'SELECT id, title, kind, category, tags, created_at FROM vault ORDER BY created_at DESC'
      )
      .all();
    expect(rows.length).toBeGreaterThan(0);
    const found = rows.find((r) => r.id === savedId);
    expect(found).toBeTruthy();
    expect(found.kind).toBe('insight');
    expect(found.category).toBe('knowledge');
  });

  it('updates the entry body and tags', async () => {
    const existing = ctx.stmts.getEntryById.get(savedId);
    expect(existing).toBeTruthy();

    const updated = updateEntryFile(ctx, existing, {
      body: 'WAL mode is the recommended journal mode for most SQLite applications',
      tags: ['sqlite', 'database', 'performance'],
    });

    expect(updated.id).toBe(savedId);
    expect(updated.body).toContain('recommended journal mode');
    expect(updated.tags).toContain('performance');
    expect(updated.filePath).toBe(savedFilePath);

    // Re-index
    await indexEntry(ctx, updated);

    // Verify DB reflects update
    const dbRow = ctx.stmts.getEntryById.get(savedId);
    expect(dbRow.body).toContain('recommended journal mode');
    expect(JSON.parse(dbRow.tags)).toContain('performance');
  }, 30000);

  it('updates with only tags changed (no body change)', async () => {
    const existing = ctx.stmts.getEntryById.get(savedId);
    const updated = updateEntryFile(ctx, existing, {
      tags: ['sqlite', 'wal'],
    });
    expect(updated.body).toContain('recommended journal mode'); // body preserved
    expect(updated.tags).toEqual(['sqlite', 'wal']);
    await indexEntry(ctx, updated);
  }, 30000);

  it('searches and finds the updated entry', async () => {
    const results = await hybridSearch(ctx, 'recommended journal mode SQLite');
    const found = results.find((r) => r.id === savedId);
    expect(found).toBeTruthy();
  }, 30000);

  it('deletes the entry', () => {
    // Delete file from disk
    unlinkSync(savedFilePath);
    expect(existsSync(savedFilePath)).toBe(false);

    // Delete vector embedding
    const rowidResult = ctx.stmts.getRowid.get(savedId);
    if (rowidResult?.rowid) {
      try {
        ctx.deleteVec(Number(rowidResult.rowid));
      } catch {}
    }

    // Delete DB row
    ctx.stmts.deleteEntry.run(savedId);
  });

  it('confirms the entry is gone from DB', () => {
    const row = ctx.stmts.getEntryById.get(savedId);
    expect(row).toBeUndefined();
  });

  it('confirms the entry is gone from search', async () => {
    const results = await hybridSearch(ctx, 'WAL mode SQLite');
    const found = results.find((r) => r.id === savedId);
    expect(found).toBeUndefined();
  }, 30000);

  it('delete of already-deleted entry returns undefined', () => {
    const row = ctx.stmts.getEntryById.get(savedId);
    expect(row).toBeUndefined();
  });
});
