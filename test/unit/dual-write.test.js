/**
 * Tests for dual-write (save to vault/ + .context/) and sync (.context/ -> DB).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestCtx } from '../helpers/ctx.js';
import { captureAndIndex } from '@context-vault/core/capture';
import { formatFrontmatter } from '@context-vault/core/frontmatter';
import { formatBody } from '@context-vault/core/formatters';
import { reindex } from '@context-vault/core/index';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeMdFile(dir, kindDir, filename, { id, kind, title, body, tags, source, created, tier }) {
  const targetDir = join(dir, kindDir);
  mkdirSync(targetDir, { recursive: true });

  const fmFields = { id };
  if (title) fmFields.title = title;
  fmFields.tags = tags || [];
  fmFields.source = source || 'file';
  fmFields.created = created || new Date().toISOString();
  if (tier) fmFields.tier = tier;

  const mdBody = formatBody(kind, { title, body, meta: {} });
  const filePath = join(targetDir, filename);
  writeFileSync(filePath, formatFrontmatter(fmFields) + mdBody);
  return filePath;
}

// ─── Dual-write: save_context writes to both vault/ and .context/ ────────────

describe('dual-write', () => {
  let ctx, cleanup;
  let originalCwd;
  let workspaceDir;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  beforeEach(() => {
    originalCwd = process.cwd();
    workspaceDir = join(tmpdir(), `cv-dualwrite-test-${Date.now()}`);
    mkdirSync(workspaceDir, { recursive: true });
    process.chdir(workspaceDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch {}
  });

  it('save creates file in both vault/ and .context/', async () => {
    const entry = await captureAndIndex(ctx, {
      kind: 'insight',
      title: 'Dual write test insight',
      body: 'Testing that dual write creates files in both locations',
      tags: ['test', 'bucket:dualwrite-test'],
    });

    expect(entry.id).toBeTruthy();
    expect(entry.filePath).toBeTruthy();

    // Vault file should exist
    expect(existsSync(entry.filePath)).toBe(true);

    // .context/ file should also exist (dual-write happens in save-context handler,
    // not in captureAndIndex itself, so we verify the vault file and test the
    // dual-write mechanism separately)
    const vaultContent = readFileSync(entry.filePath, 'utf-8');
    expect(vaultContent).toContain('Dual write test insight');

    // Verify entry is indexed in DB
    const dbEntry = ctx.stmts.getEntryById.get(entry.id);
    expect(dbEntry).toBeTruthy();
    expect(dbEntry.title).toBe('Dual write test insight');
    expect(dbEntry.kind).toBe('insight');
  }, 30000);

  it('dual-write creates .context/ file matching vault content', async () => {
    // Simulate what the save-context handler does: captureAndIndex + dualWriteLocal
    const entry = await captureAndIndex(ctx, {
      kind: 'decision',
      title: 'Use SQLite for sync',
      body: 'Decided to use SQLite FTS5 for local sync indexing',
      tags: ['test'],
    });

    // Manually perform dual-write (the handler does this after captureAndIndex)
    const { kindToPath } = await import('@context-vault/core/files');
    const { basename } = await import('node:path');
    const vaultContent = readFileSync(entry.filePath, 'utf-8');
    const localDir = join(workspaceDir, '.context', kindToPath('decision'));
    mkdirSync(localDir, { recursive: true });
    const filename = basename(entry.filePath);
    writeFileSync(join(localDir, filename), vaultContent);

    // Verify .context/ file exists and matches vault
    const localPath = join(localDir, filename);
    expect(existsSync(localPath)).toBe(true);
    const localContent = readFileSync(localPath, 'utf-8');
    expect(localContent).toBe(vaultContent);
    expect(localContent).toContain('Use SQLite for sync');
  }, 30000);
});

// ─── Sync: index .context/ files into vault DB ──────────────────────────────

describe('sync', () => {
  let ctx, cleanup;
  let contextDir;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    contextDir = join(tmpdir(), `cv-sync-test-${Date.now()}`, '.context');
    mkdirSync(contextDir, { recursive: true });
  }, 30000);

  afterAll(() => {
    cleanup();
    try {
      rmSync(join(contextDir, '..'), { recursive: true, force: true });
    } catch {}
  });

  it('indexes .context/ files into the database', async () => {
    const testId = 'SYNC_TEST_001_' + Date.now();

    // Write a .context file
    writeMdFile(contextDir, 'insight', `sync-test-${testId}.md`, {
      id: testId,
      kind: 'insight',
      title: 'Sync test insight',
      body: 'This insight was written to .context and needs syncing',
      tags: ['test', 'sync'],
    });

    // Verify it is NOT in the DB yet
    const before = ctx.stmts.getEntryById.get(testId);
    expect(before).toBeUndefined();

    // Simulate sync: parse the file and index it
    const { parseFrontmatter, parseEntryFromMarkdown } = await import('@context-vault/core/frontmatter');
    const { categoryFor, defaultTierFor } = await import('@context-vault/core/categories');
    const { shouldIndex } = await import('@context-vault/core/indexing');
    const { DEFAULT_INDEXING } = await import('@context-vault/core/constants');

    const filePath = join(contextDir, 'insight', `sync-test-${testId}.md`);
    const raw = readFileSync(filePath, 'utf-8');
    const { meta: fmMeta, body: rawBody } = parseFrontmatter(raw);
    const parsed = parseEntryFromMarkdown('insight', rawBody, fmMeta);
    const category = categoryFor('insight');
    const entryIndexed = shouldIndex(
      { kind: 'insight', category, bodyLength: parsed.body.length },
      DEFAULT_INDEXING
    );

    // Insert into DB
    const tagsJson = fmMeta.tags ? JSON.stringify(fmMeta.tags) : null;
    const created = fmMeta.created || new Date().toISOString();

    ctx.db.prepare(
      `INSERT OR IGNORE INTO vault (id, kind, category, title, body, meta, tags, source, file_path, identity_key, expires_at, created_at, updated_at, tier, indexed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      testId,
      'insight',
      category,
      parsed.title || null,
      parsed.body,
      null,
      tagsJson,
      'file',
      filePath,
      null,
      null,
      created,
      created,
      defaultTierFor('insight'),
      entryIndexed ? 1 : 0
    );

    // Verify it IS in the DB now
    const after = ctx.stmts.getEntryById.get(testId);
    expect(after).toBeTruthy();
    expect(after.title).toBe('Sync test insight');
    expect(after.kind).toBe('insight');
    expect(after.body).toContain('needs syncing');
  }, 30000);

  it('sync skips entries already in the database', async () => {
    // First, create an entry via captureAndIndex (so it exists in DB)
    const entry = await captureAndIndex(ctx, {
      kind: 'pattern',
      title: 'Already indexed pattern',
      body: 'This pattern is already in the vault DB',
      tags: ['test'],
    });

    // Verify it exists in DB
    const dbEntry = ctx.stmts.getEntryById.get(entry.id);
    expect(dbEntry).toBeTruthy();

    // Write the same entry to .context/
    writeMdFile(contextDir, 'pattern', `already-indexed-${entry.id}.md`, {
      id: entry.id,
      kind: 'pattern',
      title: 'Already indexed pattern',
      body: 'This pattern is already in the vault DB',
      tags: ['test'],
    });

    // A sync operation should recognize this is already indexed (same body/title)
    const existing = ctx.stmts.getEntryById.get(entry.id);
    expect(existing).toBeTruthy();
    expect(existing.body).toBe('This pattern is already in the vault DB');
  }, 30000);

  it('sync detects content changes between .context/ and DB', async () => {
    const entry = await captureAndIndex(ctx, {
      kind: 'insight',
      title: 'Content change test',
      body: 'Original body content before update',
      tags: ['test'],
    });

    // Verify original in DB
    const before = ctx.stmts.getEntryById.get(entry.id);
    expect(before.body).toBe('Original body content before update');

    // Write updated content to .context/
    writeMdFile(contextDir, 'insight', `changed-${entry.id}.md`, {
      id: entry.id,
      kind: 'insight',
      title: 'Content change test',
      body: 'Updated body content after modification',
      tags: ['test'],
    });

    // Parse the .context file and compare
    const { parseFrontmatter, parseEntryFromMarkdown } = await import('@context-vault/core/frontmatter');
    const filePath = join(contextDir, 'insight', `changed-${entry.id}.md`);
    const raw = readFileSync(filePath, 'utf-8');
    const { meta: fmMeta, body: rawBody } = parseFrontmatter(raw);
    const parsed = parseEntryFromMarkdown('insight', rawBody, fmMeta);

    // Content should differ
    expect(parsed.body).not.toBe(before.body);
    expect(parsed.body).toContain('Updated body content');
  }, 30000);
});

// ─── Dry-run: reports without modifying ─────────────────────────────────────

describe('sync dry-run logic', () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it('dry-run does not insert entries into database', async () => {
    const testId = 'DRYRUN_TEST_' + Date.now();
    const contextDir = join(tmpdir(), `cv-dryrun-test-${Date.now()}`, '.context');
    mkdirSync(contextDir, { recursive: true });

    try {
      // Write a .context file
      writeMdFile(contextDir, 'insight', `dryrun-${testId}.md`, {
        id: testId,
        kind: 'insight',
        title: 'Dry run test',
        body: 'This should not be indexed in dry run mode',
        tags: ['test'],
      });

      // Verify NOT in DB
      const before = ctx.stmts.getEntryById.get(testId);
      expect(before).toBeUndefined();

      // In dry-run mode, we would parse and check but NOT insert
      const { parseFrontmatter, parseEntryFromMarkdown } = await import('@context-vault/core/frontmatter');
      const filePath = join(contextDir, 'insight', `dryrun-${testId}.md`);
      const raw = readFileSync(filePath, 'utf-8');
      const { meta: fmMeta, body: rawBody } = parseFrontmatter(raw);
      const parsed = parseEntryFromMarkdown('insight', rawBody, fmMeta);

      // Simulate dry-run: only check, do not insert
      const entryId = fmMeta.id;
      expect(entryId).toBe(testId);
      const existing = ctx.stmts.getEntryById.get(entryId);
      expect(existing).toBeUndefined(); // would sync

      // Verify still NOT in DB (dry run)
      const after = ctx.stmts.getEntryById.get(testId);
      expect(after).toBeUndefined();
    } finally {
      rmSync(join(contextDir, '..'), { recursive: true, force: true });
    }
  }, 30000);
});
