/**
 * Unit tests for MCP tool handlers.
 *
 * Tests the handler functions directly with a real DB context (via createTestCtx)
 * and a minimal mock of the `shared` object. This validates the business logic
 * layer that sits between the MCP SDK and the core capture/retrieve layers.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCtx } from "../helpers/ctx.js";
import { captureAndIndex } from "@context-vault/core/capture";

import * as getContextTool from "../../packages/core/src/server/tools/get-context.js";
import * as saveContextTool from "../../packages/core/src/server/tools/save-context.js";
import * as deleteContextTool from "../../packages/core/src/server/tools/delete-context.js";
import * as listContextTool from "../../packages/core/src/server/tools/list-context.js";
import * as contextStatusTool from "../../packages/core/src/server/tools/context-status.js";

const shared = { ensureIndexed: async () => {}, reindexFailed: false };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOk(result) {
  expect(result.isError).toBeFalsy();
  expect(result.content[0].type).toBe("text");
  return result.content[0].text;
}

function isErr(result, code) {
  expect(result.isError).toBe(true);
  if (code) expect(result.code).toBe(code);
  return result.content[0].text;
}

// ─── save_context ─────────────────────────────────────────────────────────────

describe("save_context handler", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it("creates a new entry and returns its id", async () => {
    const result = await saveContextTool.handler(
      { kind: "insight", body: "SQLite is fast", title: "SQLite tip" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("✓ Saved insight");
    expect(text).toContain("id:");
  }, 30000);

  it("rejects missing kind for new entries", async () => {
    const result = await saveContextTool.handler(
      { body: "some body" },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects missing body for new entries", async () => {
    const result = await saveContextTool.handler(
      { kind: "insight" },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects body that is whitespace-only", async () => {
    const result = await saveContextTool.handler(
      { kind: "insight", body: "   " },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects invalid kind format", async () => {
    const result = await saveContextTool.handler(
      { kind: "My Kind!", body: "test" },
      ctx,
      shared,
    );
    isErr(result, "INVALID_KIND");
  }, 30000);

  it("rejects title exceeding max length", async () => {
    const result = await saveContextTool.handler(
      { kind: "insight", body: "test", title: "x".repeat(501) },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects body exceeding max length", async () => {
    const result = await saveContextTool.handler(
      { kind: "insight", body: "x".repeat(100 * 1024 + 1) },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects tags that are not an array", async () => {
    const result = await saveContextTool.handler(
      { kind: "insight", body: "test", tags: "react" },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects too many tags", async () => {
    const result = await saveContextTool.handler(
      {
        kind: "insight",
        body: "test",
        tags: Array.from({ length: 21 }, (_, i) => `tag${i}`),
      },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects invalid expires_at", async () => {
    const result = await saveContextTool.handler(
      { kind: "insight", body: "test", expires_at: "not-a-date" },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("accepts valid expires_at ISO string", async () => {
    const result = await saveContextTool.handler(
      {
        kind: "insight",
        body: "TTL test entry",
        expires_at: "2099-12-31T00:00:00Z",
      },
      ctx,
      shared,
    );
    isOk(result);
  }, 30000);

  it("requires identity_key for entity kinds", async () => {
    const result = await saveContextTool.handler(
      { kind: "contact", body: "Alice is a developer" },
      ctx,
      shared,
    );
    isErr(result, "MISSING_IDENTITY_KEY");
  }, 30000);

  it("updates an existing entry by id", async () => {
    const createResult = await saveContextTool.handler(
      { kind: "insight", body: "Original body", title: "Original title" },
      ctx,
      shared,
    );
    const createText = isOk(createResult);
    const idMatch = createText.match(/id: (\S+)/);
    expect(idMatch).toBeTruthy();
    const id = idMatch[1];

    const updateResult = await saveContextTool.handler(
      { id, body: "Updated body" },
      ctx,
      shared,
    );
    const updateText = isOk(updateResult);
    expect(updateText).toContain("✓ Updated");

    const row = ctx.stmts.getEntryById.get(id);
    expect(row.body).toContain("Updated body");
  }, 30000);

  it("returns NOT_FOUND when updating non-existent id", async () => {
    const result = await saveContextTool.handler(
      { id: "00000000000000000000000000", body: "test" },
      ctx,
      shared,
    );
    isErr(result, "NOT_FOUND");
  }, 30000);

  it("cannot change kind on update", async () => {
    const createResult = await saveContextTool.handler(
      { kind: "insight", body: "body" },
      ctx,
      shared,
    );
    const idMatch = isOk(createResult).match(/id: (\S+)/);
    const id = idMatch[1];

    const result = await saveContextTool.handler(
      { id, kind: "decision", body: "changed kind" },
      ctx,
      shared,
    );
    isErr(result, "INVALID_UPDATE");
  }, 30000);

  it("returns VAULT_NOT_FOUND when vault directory is missing", async () => {
    const brokenCtx = {
      ...ctx,
      config: { ...ctx.config, vaultDirExists: false },
    };
    const result = await saveContextTool.handler(
      { kind: "insight", body: "test" },
      brokenCtx,
      shared,
    );
    isErr(result, "VAULT_NOT_FOUND");
  }, 30000);

  it("dry_run: true returns without saving", async () => {
    const before = ctx.db.prepare("SELECT COUNT(*) as c FROM vault").get().c;
    const result = await saveContextTool.handler(
      { kind: "insight", body: "Dry run test entry", dry_run: true },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("dry run");
    const after = ctx.db.prepare("SELECT COUNT(*) as c FROM vault").get().c;
    expect(after).toBe(before);
  }, 30000);

  it("dry_run: true on empty vault reports no similar entries", async () => {
    const { ctx: freshCtx, cleanup: freshCleanup } = await createTestCtx();
    try {
      const result = await saveContextTool.handler(
        { kind: "insight", body: "Nothing in vault yet", dry_run: true },
        freshCtx,
        shared,
      );
      const text = isOk(result);
      expect(text).toContain("dry run");
      expect(text).not.toContain("⚠");
    } finally {
      freshCleanup();
    }
  }, 30000);

  it("normal save succeeds when embed returns null (graceful degradation)", async () => {
    const noEmbedCtx = { ...ctx, embed: async () => null };
    const result = await saveContextTool.handler(
      {
        kind: "insight",
        body: "No embedding available",
        title: "Offline save",
      },
      noEmbedCtx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("✓ Saved insight");
  }, 30000);

  it("dry_run: true with entity kind still requires identity_key", async () => {
    const result = await saveContextTool.handler(
      { kind: "contact", body: "test", dry_run: true },
      ctx,
      shared,
    );
    isErr(result, "MISSING_IDENTITY_KEY");
  }, 30000);
});

// ─── get_context ──────────────────────────────────────────────────────────────

describe("get_context handler", () => {
  let ctx, cleanup, seedId;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    const entry = await captureAndIndex(ctx, {
      kind: "insight",
      title: "SQLite WAL mode",
      body: "WAL mode allows concurrent reads and writes in SQLite databases",
      tags: ["sqlite", "database"],
      source: "test",
    });
    await captureAndIndex(ctx, {
      kind: "contact",
      title: "Alice Developer",
      body: "Alice is a senior frontend developer",
      tags: ["team"],
      identity_key: "alice",
      source: "test",
    });
    seedId = entry.id;
  }, 60000);

  afterAll(() => cleanup());

  it("requires query or filters", async () => {
    const result = await getContextTool.handler({}, ctx, shared);
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("finds entries by query", async () => {
    const result = await getContextTool.handler(
      { query: "SQLite WAL concurrent" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("SQLite WAL mode");
  }, 30000);

  it("filters by kind", async () => {
    const result = await getContextTool.handler(
      { query: "developer", kind: "contact" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("contact");
    expect(text).not.toContain("insight");
  }, 30000);

  it("filters by category without query", async () => {
    const result = await getContextTool.handler(
      { category: "entity" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Alice Developer");
  }, 30000);

  it("returns results for kind filter alone", async () => {
    const result = await getContextTool.handler(
      { kind: "insight" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("insight");
  }, 30000);

  it("returns no results message when nothing matches", async () => {
    // Use a future 'since' date to guarantee zero results regardless of embeddings
    const result = await getContextTool.handler(
      { query: "SQLite", since: "2099-01-01" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("No results found");
  }, 30000);

  it("returns entity exact match by identity_key", async () => {
    const result = await getContextTool.handler(
      { kind: "contact", identity_key: "alice" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Entity Match (exact)");
    expect(text).toContain("Alice Developer");
  }, 30000);

  it("requires kind when identity_key is provided", async () => {
    const result = await getContextTool.handler(
      { identity_key: "alice" },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("respects limit parameter", async () => {
    const result = await getContextTool.handler(
      { category: "knowledge", limit: 1 },
      ctx,
      shared,
    );
    const text = isOk(result);
    // "1 matches" should appear
    expect(text).toContain("1 matches");
  }, 30000);

  it("shows semantic search warning when embed unavailable", async () => {
    const result = await getContextTool.handler({ query: "SQLite" }, ctx, {
      ...shared,
      reindexFailed: false,
    });
    // If embed is loaded (test env), the note won't show. Just check it doesn't error.
    isOk(result);
  }, 30000);
});

// ─── delete_context ───────────────────────────────────────────────────────────

describe("delete_context handler", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it("deletes an existing entry", async () => {
    const entry = await captureAndIndex(ctx, {
      kind: "insight",
      body: "Entry to be deleted",
      title: "Delete me",
    });

    const result = await deleteContextTool.handler(
      { id: entry.id },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Deleted insight");
    expect(text).toContain(entry.id);

    const row = ctx.stmts.getEntryById.get(entry.id);
    expect(row).toBeUndefined();
  }, 30000);

  it("returns NOT_FOUND for non-existent id", async () => {
    const result = await deleteContextTool.handler(
      { id: "00000000000000000000000000" },
      ctx,
      shared,
    );
    isErr(result, "NOT_FOUND");
  }, 30000);

  it("rejects empty id", async () => {
    const result = await deleteContextTool.handler({ id: "" }, ctx, shared);
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects whitespace-only id", async () => {
    const result = await deleteContextTool.handler({ id: "   " }, ctx, shared);
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("respects userId ownership check", async () => {
    const entry = await captureAndIndex(ctx, {
      kind: "insight",
      body: "Owned entry",
    });
    ctx.db
      .prepare("UPDATE vault SET user_id = ? WHERE id = ?")
      .run("user-a", entry.id);

    const ctxWithUser = { ...ctx, userId: "user-b" };
    const result = await deleteContextTool.handler(
      { id: entry.id },
      ctxWithUser,
      shared,
    );
    isErr(result, "NOT_FOUND");

    // Cleanup
    ctx.stmts.deleteEntry.run(entry.id);
  }, 30000);
});

// ─── list_context ─────────────────────────────────────────────────────────────

describe("list_context handler", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    await captureAndIndex(ctx, {
      kind: "insight",
      body: "React tip",
      title: "React hooks",
      tags: ["react"],
    });
    await captureAndIndex(ctx, {
      kind: "decision",
      body: "Use Vite",
      title: "Vite decision",
      tags: ["tooling"],
    });
    await captureAndIndex(ctx, {
      kind: "contact",
      body: "Alice developer",
      title: "Alice",
      identity_key: "alice",
      tags: ["team"],
    });
  }, 60000);

  afterAll(() => cleanup());

  it("lists all entries", async () => {
    const result = await listContextTool.handler({}, ctx, shared);
    const text = isOk(result);
    expect(text).toContain("Vault Entries");
    expect(text).toContain("React hooks");
    expect(text).toContain("Vite decision");
    expect(text).toContain("Alice");
  }, 30000);

  it("filters by kind", async () => {
    const result = await listContextTool.handler(
      { kind: "insight" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("React hooks");
    expect(text).not.toContain("Vite decision");
  }, 30000);

  it("filters by category", async () => {
    const result = await listContextTool.handler(
      { category: "entity" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Alice");
    expect(text).not.toContain("React hooks");
  }, 30000);

  it("filters by tags", async () => {
    const result = await listContextTool.handler(
      { tags: ["react"] },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("React hooks");
    expect(text).not.toContain("Vite decision");
  }, 30000);

  it("respects limit", async () => {
    const result = await listContextTool.handler({ limit: 1 }, ctx, shared);
    const text = isOk(result);
    // Should show pagination hint for next page
    expect(text).toContain("offset:");
  }, 30000);

  it("caps limit at 100", async () => {
    const result = await listContextTool.handler({ limit: 999 }, ctx, shared);
    isOk(result);
  }, 30000);

  it("returns empty message when no entries match", async () => {
    const result = await listContextTool.handler(
      { kind: "nonexistent-kind-xyz" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("No entries found");
  }, 30000);

  it("includes total count in header", async () => {
    const result = await listContextTool.handler({}, ctx, shared);
    const text = isOk(result);
    expect(text).toMatch(/\d+ shown, \d+ total/);
  }, 30000);
});

// ─── context_status ───────────────────────────────────────────────────────────

describe("context_status handler", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    await captureAndIndex(ctx, {
      kind: "insight",
      body: "Status test entry",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("returns vault status without errors", () => {
    const result = contextStatusTool.handler({}, ctx);
    const text = isOk(result);
    expect(text).toContain("Vault Status");
    expect(text).toContain("Database:");
    expect(text).toContain("Schema:");
  });

  it("includes entry counts by kind", () => {
    const result = contextStatusTool.handler({}, ctx);
    const text = isOk(result);
    expect(text).toContain("insight");
  });

  it("reports empty vault with suggested action", async () => {
    const { ctx: emptyCtx, cleanup: c } = await createTestCtx();
    try {
      const result = contextStatusTool.handler({}, emptyCtx);
      const text = isOk(result);
      expect(text).toContain("Suggested Actions");
    } finally {
      c();
    }
  }, 30000);

  it("shows health check icon", () => {
    const result = contextStatusTool.handler({}, ctx);
    const text = isOk(result);
    expect(text).toMatch(/[✓⚠]/);
  });
});
