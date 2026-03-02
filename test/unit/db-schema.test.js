/**
 * db-schema.test.js — Schema separation tests
 *
 * Verifies that LOCAL_SCHEMA_DDL and HOSTED_SCHEMA_DDL create distinct schemas,
 * that initDatabase selects the right DDL based on mode, and that the v13→v14
 * migration correctly drops hosted-only columns from existing local vaults.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LOCAL_SCHEMA_DDL,
  HOSTED_SCHEMA_DDL,
  SCHEMA_DDL,
  initDatabase,
  prepareStatements,
} from "@context-vault/core/db";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), "cv-schema-test-"));
  return {
    dir,
    dbPath: join(dir, "vault.db"),
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function getColumns(db) {
  return db
    .prepare("PRAGMA table_info(vault)")
    .all()
    .map((r) => r.name);
}

function getIndexes(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='vault'",
    )
    .all()
    .map((r) => r.name);
}

function getVersion(db) {
  return db.prepare("PRAGMA user_version").get().user_version;
}

// ─── DDL export tests ─────────────────────────────────────────────────────────

describe("schema DDL exports", () => {
  it("LOCAL_SCHEMA_DDL does not include hosted-only columns", () => {
    const hostedCols = [
      "user_id",
      "team_id",
      "body_encrypted",
      "title_encrypted",
      "meta_encrypted",
      "iv",
    ];
    for (const col of hostedCols) {
      expect(LOCAL_SCHEMA_DDL).not.toContain(`${col}`);
    }
  });

  it("HOSTED_SCHEMA_DDL includes all six hosted-only columns", () => {
    const hostedCols = [
      "user_id",
      "team_id",
      "body_encrypted",
      "title_encrypted",
      "meta_encrypted",
      "iv",
    ];
    for (const col of hostedCols) {
      expect(HOSTED_SCHEMA_DDL).toContain(col);
    }
  });

  it("SCHEMA_DDL is an alias for HOSTED_SCHEMA_DDL", () => {
    expect(SCHEMA_DDL).toBe(HOSTED_SCHEMA_DDL);
  });

  it("LOCAL_SCHEMA_DDL identity index scopes to category=entity only", () => {
    expect(LOCAL_SCHEMA_DDL).toContain("category = 'entity'");
    expect(LOCAL_SCHEMA_DDL).not.toContain("user_id");
  });

  it("HOSTED_SCHEMA_DDL identity index includes user_id", () => {
    expect(HOSTED_SCHEMA_DDL).toContain("idx_vault_identity");
    expect(HOSTED_SCHEMA_DDL).toContain("user_id, kind, identity_key");
  });
});

// ─── initDatabase — fresh local DB ───────────────────────────────────────────

describe("initDatabase — local mode (default)", () => {
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

  it("creates local schema without hosted-only columns", () => {
    const cols = getColumns(db);
    expect(cols).not.toContain("user_id");
    expect(cols).not.toContain("team_id");
    expect(cols).not.toContain("body_encrypted");
    expect(cols).not.toContain("title_encrypted");
    expect(cols).not.toContain("meta_encrypted");
    expect(cols).not.toContain("iv");
  });

  it("includes all core local columns", () => {
    const cols = getColumns(db);
    const expected = [
      "id",
      "kind",
      "category",
      "title",
      "body",
      "meta",
      "tags",
      "source",
      "file_path",
      "identity_key",
      "expires_at",
      "superseded_by",
      "created_at",
      "updated_at",
      "hit_count",
      "last_accessed_at",
      "source_files",
      "tier",
      "related_to",
    ];
    for (const col of expected) {
      expect(cols).toContain(col);
    }
  });

  it("sets version to CURRENT_VERSION (14)", () => {
    expect(getVersion(db)).toBe(14);
  });

  it("does not create user or team indexes", () => {
    const indexes = getIndexes(db);
    expect(indexes).not.toContain("idx_vault_user");
    expect(indexes).not.toContain("idx_vault_team");
  });

  it("creates identity index without user_id", () => {
    const indexes = getIndexes(db);
    expect(indexes).toContain("idx_vault_identity");
    // Verify the index definition does not reference user_id
    const indexDef = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_vault_identity'",
      )
      .get();
    expect(indexDef.sql).not.toContain("user_id");
    expect(indexDef.sql).toContain("category = 'entity'");
  });
});

// ─── initDatabase — fresh hosted DB ──────────────────────────────────────────

describe("initDatabase — hosted mode", () => {
  let tmp, db;

  beforeEach(async () => {
    tmp = makeTmp();
    db = await initDatabase(tmp.dbPath, { mode: "hosted" });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {}
    tmp.cleanup();
  });

  it("creates hosted schema with all six hosted-only columns", () => {
    const cols = getColumns(db);
    expect(cols).toContain("user_id");
    expect(cols).toContain("team_id");
    expect(cols).toContain("body_encrypted");
    expect(cols).toContain("title_encrypted");
    expect(cols).toContain("meta_encrypted");
    expect(cols).toContain("iv");
  });

  it("creates user and team indexes", () => {
    const indexes = getIndexes(db);
    expect(indexes).toContain("idx_vault_user");
    expect(indexes).toContain("idx_vault_team");
  });

  it("creates identity index with user_id", () => {
    const indexDef = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_vault_identity'",
      )
      .get();
    expect(indexDef.sql).toContain("user_id");
    expect(indexDef.sql).not.toContain("category = 'entity'");
  });

  it("sets version to CURRENT_VERSION (14)", () => {
    expect(getVersion(db)).toBe(14);
  });
});

// ─── v13→v14 migration — local mode ──────────────────────────────────────────

describe("v13→v14 migration — local mode drops hosted columns", () => {
  let tmp;

  afterEach(() => tmp.cleanup());

  it("drops all six hosted-only columns from an existing v13 local vault", async () => {
    tmp = makeTmp();
    // Simulate a v13 hosted-schema vault (the old default)
    const oldDb = await initDatabase(tmp.dbPath, { mode: "hosted" });
    // Force version back to 13 so the migration re-runs
    oldDb.exec("PRAGMA user_version = 13");
    oldDb.close();

    // Re-open in local mode — migration should drop hosted columns
    const localDb = await initDatabase(tmp.dbPath, { mode: "local" });
    const cols = getColumns(localDb);
    expect(cols).not.toContain("user_id");
    expect(cols).not.toContain("team_id");
    expect(cols).not.toContain("body_encrypted");
    expect(cols).not.toContain("title_encrypted");
    expect(cols).not.toContain("meta_encrypted");
    expect(cols).not.toContain("iv");
    expect(getVersion(localDb)).toBe(14);
    localDb.close();
  });

  it("drops user/team indexes and rebuilds identity index without user_id", async () => {
    tmp = makeTmp();
    const oldDb = await initDatabase(tmp.dbPath, { mode: "hosted" });
    oldDb.exec("PRAGMA user_version = 13");
    oldDb.close();

    const localDb = await initDatabase(tmp.dbPath, { mode: "local" });
    const indexes = getIndexes(localDb);
    expect(indexes).not.toContain("idx_vault_user");
    expect(indexes).not.toContain("idx_vault_team");
    expect(indexes).toContain("idx_vault_identity");

    const indexDef = localDb
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_vault_identity'",
      )
      .get();
    expect(indexDef.sql).not.toContain("user_id");
    expect(indexDef.sql).toContain("category = 'entity'");
    localDb.close();
  });

  it("preserves existing entry data when migrating hosted v13 → local v14", async () => {
    tmp = makeTmp();
    const oldDb = await initDatabase(tmp.dbPath, { mode: "hosted" });
    // Insert a test entry via hosted insertEntry (with user_id)
    oldDb
      .prepare(
        `INSERT INTO vault (id, user_id, kind, category, title, body, source, created_at, updated_at, tier)
         VALUES (?, NULL, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?)`,
      )
      .run(
        "test-id-001",
        "insight",
        "knowledge",
        "Migration test",
        "Body text",
        "test",
        "working",
      );
    oldDb.exec("PRAGMA user_version = 13");
    oldDb.close();

    const localDb = await initDatabase(tmp.dbPath, { mode: "local" });
    const row = localDb
      .prepare("SELECT * FROM vault WHERE id = ?")
      .get("test-id-001");
    expect(row).toBeTruthy();
    expect(row.kind).toBe("insight");
    expect(row.title).toBe("Migration test");
    // user_id column is gone
    expect(row.user_id).toBeUndefined();
    localDb.close();
  });

  it("hosted mode v13→v14 is a no-op — keeps all columns", async () => {
    tmp = makeTmp();
    const oldDb = await initDatabase(tmp.dbPath, { mode: "hosted" });
    oldDb.exec("PRAGMA user_version = 13");
    oldDb.close();

    const hostedDb = await initDatabase(tmp.dbPath, { mode: "hosted" });
    const cols = getColumns(hostedDb);
    expect(cols).toContain("user_id");
    expect(cols).toContain("team_id");
    expect(cols).toContain("body_encrypted");
    expect(getVersion(hostedDb)).toBe(14);
    hostedDb.close();
  });
});

// ─── prepareStatements — mode-aware ──────────────────────────────────────────

describe("prepareStatements — mode selection", () => {
  let tmp, localDb, hostedDb;

  beforeEach(async () => {
    tmp = makeTmp();
    localDb = await initDatabase(tmp.dbPath);
  });

  afterEach(() => {
    try {
      localDb?.close();
    } catch {}
    try {
      hostedDb?.close();
    } catch {}
    tmp.cleanup();
  });

  it("local mode stmts have _mode = 'local'", () => {
    const stmts = prepareStatements(localDb, "local");
    expect(stmts._mode).toBe("local");
  });

  it("hosted mode stmts have _mode = 'hosted'", async () => {
    const tmp2 = makeTmp();
    try {
      hostedDb = await initDatabase(tmp2.dbPath, { mode: "hosted" });
      const stmts = prepareStatements(hostedDb, "hosted");
      expect(stmts._mode).toBe("hosted");
    } finally {
      try {
        hostedDb?.close();
      } catch {}
      tmp2.cleanup();
    }
  });

  it("local mode stmts have no insertEntryEncrypted", () => {
    const stmts = prepareStatements(localDb, "local");
    expect(stmts.insertEntryEncrypted).toBeUndefined();
  });

  it("hosted mode stmts have insertEntryEncrypted", async () => {
    const tmp2 = makeTmp();
    try {
      hostedDb = await initDatabase(tmp2.dbPath, { mode: "hosted" });
      const stmts = prepareStatements(hostedDb, "hosted");
      expect(stmts.insertEntryEncrypted).toBeDefined();
    } finally {
      try {
        hostedDb?.close();
      } catch {}
      tmp2.cleanup();
    }
  });

  it("local insertEntry accepts 15 params (no user_id)", () => {
    const stmts = prepareStatements(localDb, "local");
    // Should not throw — verifies correct param count
    expect(() =>
      stmts.insertEntry.run(
        "test-local-01",
        "insight",
        "knowledge",
        "Title",
        "Body",
        null,
        null,
        "test",
        null,
        null,
        null,
        new Date().toISOString(),
        new Date().toISOString(),
        null,
        "working",
      ),
    ).not.toThrow();
  });

  it("local getByIdentityKey accepts 2 params (no user_id)", () => {
    const stmts = prepareStatements(localDb, "local");
    // Should not throw
    expect(() =>
      stmts.getByIdentityKey.get("insight", "some-key"),
    ).not.toThrow();
    // Passing extra args throws in node:sqlite
    expect(() =>
      stmts.getByIdentityKey.get("insight", "some-key", null),
    ).toThrow();
  });
});
