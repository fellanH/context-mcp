/**
 * db-schema.test.js — Schema tests
 *
 * Verifies that initDatabase creates the correct schema and that
 * prepareStatements works correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SCHEMA_DDL, initDatabase, prepareStatements } from '../../packages/core/src/db.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'cv-schema-test-'));
  return {
    dir,
    dbPath: join(dir, 'vault.db'),
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function getColumns(db) {
  return db
    .prepare('PRAGMA table_info(vault)')
    .all()
    .map((r) => r.name);
}

function getIndexes(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='vault'")
    .all()
    .map((r) => r.name);
}

function getVersion(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

// ─── DDL export tests ─────────────────────────────────────────────────────────

describe('schema DDL exports', () => {
  it('SCHEMA_DDL is a non-empty string', () => {
    expect(typeof SCHEMA_DDL).toBe('string');
    expect(SCHEMA_DDL.length).toBeGreaterThan(100);
  });

  it('SCHEMA_DDL creates the vault table', () => {
    expect(SCHEMA_DDL).toContain('CREATE TABLE IF NOT EXISTS vault');
  });

  it('SCHEMA_DDL includes all core columns', () => {
    const cols = [
      'id',
      'kind',
      'category',
      'title',
      'body',
      'meta',
      'tags',
      'source',
      'file_path',
      'identity_key',
      'expires_at',
      'superseded_by',
      'created_at',
      'updated_at',
      'hit_count',
      'last_accessed_at',
      'source_files',
      'tier',
      'related_to',
    ];
    for (const col of cols) {
      expect(SCHEMA_DDL).toContain(col);
    }
  });

  it('SCHEMA_DDL does not include hosted-only columns', () => {
    const hostedCols = [
      'user_id',
      'team_id',
      'body_encrypted',
      'title_encrypted',
      'meta_encrypted',
      'iv',
    ];
    for (const col of hostedCols) {
      expect(SCHEMA_DDL).not.toContain(col);
    }
  });

  it('SCHEMA_DDL identity index scopes to category=entity only', () => {
    expect(SCHEMA_DDL).toContain("category = 'entity'");
  });

  it('SCHEMA_DDL creates vault_fts virtual table', () => {
    expect(SCHEMA_DDL).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS vault_fts');
  });

  it('SCHEMA_DDL creates vault_vec virtual table', () => {
    expect(SCHEMA_DDL).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS vault_vec');
  });
});

// ─── initDatabase — fresh DB ──────────────────────────────────────────────────

describe('initDatabase', () => {
  let tmp, db;

  beforeEach(async () => {
    tmp = makeTmp();
    db = await initDatabase(tmp.dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    tmp.cleanup();
  });

  it('creates schema without hosted-only columns', () => {
    const cols = getColumns(db);
    expect(cols).not.toContain('user_id');
    expect(cols).not.toContain('team_id');
    expect(cols).not.toContain('body_encrypted');
    expect(cols).not.toContain('title_encrypted');
    expect(cols).not.toContain('meta_encrypted');
    expect(cols).not.toContain('iv');
  });

  it('includes all core columns', () => {
    const cols = getColumns(db);
    const expected = [
      'id',
      'kind',
      'category',
      'title',
      'body',
      'meta',
      'tags',
      'source',
      'file_path',
      'identity_key',
      'expires_at',
      'superseded_by',
      'created_at',
      'updated_at',
      'hit_count',
      'last_accessed_at',
      'source_files',
      'tier',
      'related_to',
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  it('sets version to CURRENT_VERSION (15)', () => {
    expect(getVersion(db)).toBe(15);
  });

  it('does not create user or team indexes', () => {
    const indexes = getIndexes(db);
    expect(indexes).not.toContain('idx_vault_user');
    expect(indexes).not.toContain('idx_vault_team');
  });

  it('creates identity index without user_id', () => {
    const indexes = getIndexes(db);
    expect(indexes).toContain('idx_vault_identity');
    const indexDef = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_vault_identity'")
      .get();
    expect(indexDef.sql).not.toContain('user_id');
    expect(indexDef.sql).toContain("category = 'entity'");
  });

  it('rebuilds an outdated schema (v13 → v15)', async () => {
    const tmp2 = makeTmp();
    try {
      // Create a fresh DB and force version back to simulate outdated schema
      const oldDb = await initDatabase(tmp2.dbPath);
      oldDb.exec('PRAGMA user_version = 13');
      oldDb.close();

      // Re-open — migration should rebuild to v15
      const newDb = await initDatabase(tmp2.dbPath);
      expect(getVersion(newDb)).toBe(15);
      const cols = getColumns(newDb);
      expect(cols).toContain('id');
      expect(cols).toContain('kind');
      newDb.close();
    } finally {
      tmp2.cleanup();
    }
  });
});

// ─── prepareStatements ────────────────────────────────────────────────────────

describe('prepareStatements', () => {
  let tmp, db;

  beforeEach(async () => {
    tmp = makeTmp();
    db = await initDatabase(tmp.dbPath);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    tmp.cleanup();
  });

  it('returns an object with insertEntry', () => {
    const stmts = prepareStatements(db);
    expect(stmts.insertEntry).toBeDefined();
  });

  it('returns an object with getEntryById', () => {
    const stmts = prepareStatements(db);
    expect(stmts.getEntryById).toBeDefined();
  });

  it('returns an object with deleteEntry', () => {
    const stmts = prepareStatements(db);
    expect(stmts.deleteEntry).toBeDefined();
  });

  it('returns an object with getByIdentityKey', () => {
    const stmts = prepareStatements(db);
    expect(stmts.getByIdentityKey).toBeDefined();
  });

  it('insertEntry accepts 15 params (no user_id)', () => {
    const stmts = prepareStatements(db);
    expect(() =>
      stmts.insertEntry.run(
        'test-local-01',
        'insight',
        'knowledge',
        'Title',
        'Body',
        null,
        null,
        'test',
        null,
        null,
        null,
        new Date().toISOString(),
        new Date().toISOString(),
        null,
        'working'
      )
    ).not.toThrow();
  });

  it('getByIdentityKey accepts 2 params (kind, identity_key)', () => {
    const stmts = prepareStatements(db);
    expect(() => stmts.getByIdentityKey.get('insight', 'some-key')).not.toThrow();
  });

  it('does not have insertEntryEncrypted (local-only schema)', () => {
    const stmts = prepareStatements(db);
    expect(stmts.insertEntryEncrypted).toBeUndefined();
  });
});
