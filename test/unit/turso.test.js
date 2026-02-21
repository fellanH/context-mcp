/**
 * Unit tests for Turso storage adapter using local file mode.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createTursoClient,
  initTursoSchema,
  createTursoAdapter,
} from "../../packages/hosted/src/storage/turso.js";

describe("Turso storage adapter", () => {
  let client, adapter, tmpDir;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "turso-test-"));
    const dbPath = join(tmpDir, "test.db");
    client = createTursoClient(`file:${dbPath}`);
    await initTursoSchema(client);
    adapter = createTursoAdapter(client);
  });

  afterAll(() => {
    client.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the vault table", async () => {
    const rows = await adapter.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vault'",
    );
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("vault");
  });

  it("creates the FTS5 table", async () => {
    const rows = await adapter.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='vault_fts'",
    );
    expect(rows.length).toBe(1);
  });

  it("inserts and queries entries", async () => {
    await adapter.execute(
      "INSERT INTO vault (id, kind, category, title, body, tags, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "test-1",
        "insight",
        "knowledge",
        "Test Insight",
        "This is a test body",
        '["test"]',
        "test",
        new Date().toISOString(),
      ],
    );

    const rows = await adapter.query("SELECT * FROM vault WHERE id = ?", [
      "test-1",
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Test Insight");
    expect(rows[0].kind).toBe("insight");
  });

  it("FTS triggers populate vault_fts", async () => {
    const ftsRows = await adapter.query(
      "SELECT * FROM vault_fts WHERE vault_fts MATCH ?",
      ['"Test Insight"'],
    );
    expect(ftsRows.length).toBe(1);
  });

  it("queryOne returns single row", async () => {
    const row = await adapter.queryOne("SELECT COUNT(*) as c FROM vault");
    expect(row.c).toBe(1);
  });

  it("execute returns changes count", async () => {
    const result = await adapter.execute(
      "INSERT INTO vault (id, kind, category, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        "test-2",
        "decision",
        "knowledge",
        "Test Decision",
        "Decision body",
        new Date().toISOString(),
      ],
    );
    expect(result.changes).toBe(1);
  });

  it("handles encrypted columns", async () => {
    const fakeEncrypted = Buffer.from("encrypted-body-data");
    const fakeIv = Buffer.from("123456789012"); // 12 bytes

    await adapter.execute(
      "UPDATE vault SET body_encrypted = ?, iv = ?, version = 1 WHERE id = ?",
      [fakeEncrypted, fakeIv, "test-1"],
    );

    const row = await adapter.queryOne(
      "SELECT body_encrypted, iv FROM vault WHERE id = ?",
      ["test-1"],
    );
    expect(row.body_encrypted).toBeTruthy();
    expect(row.iv).toBeTruthy();
  });

  it("supports identity_key unique constraint", async () => {
    await adapter.execute(
      "INSERT INTO vault (id, kind, category, title, body, identity_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "entity-1",
        "contact",
        "entity",
        "John",
        "Contact info",
        "john@example.com",
        new Date().toISOString(),
      ],
    );

    // Duplicate identity_key for same kind should fail
    try {
      await adapter.execute(
        "INSERT INTO vault (id, kind, category, title, body, identity_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          "entity-2",
          "contact",
          "entity",
          "John 2",
          "More info",
          "john@example.com",
          new Date().toISOString(),
        ],
      );
      expect.fail("Should have thrown unique constraint error");
    } catch (e) {
      expect(e.message).toContain("UNIQUE");
    }
  });

  it("deletes entries and cleans up FTS", async () => {
    await adapter.execute("DELETE FROM vault WHERE id = ?", ["test-2"]);
    const rows = await adapter.query("SELECT * FROM vault WHERE id = ?", [
      "test-2",
    ]);
    expect(rows.length).toBe(0);

    // FTS should also be cleaned up via trigger
    const ftsRows = await adapter.query(
      "SELECT * FROM vault_fts WHERE vault_fts MATCH ?",
      ['"Decision body"'],
    );
    expect(ftsRows.length).toBe(0);
  });
});
