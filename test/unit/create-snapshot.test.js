/**
 * Unit tests for the create_snapshot tool handler.
 *
 * The LLM call is mocked via vi.mock so tests run without a real ANTHROPIC_API_KEY.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestCtx } from "../helpers/ctx.js";
import { captureAndIndex } from "@context-vault/core/capture";
import * as createSnapshotTool from "../../packages/core/src/server/tools/create-snapshot.js";

const FAKE_BRIEF = `# Test Topic — Context Brief
## Status
Active project in development.
## Key Decisions
- Use SQLite for local storage.
## Patterns & Conventions
- Consistent use of ULID identifiers.
## Active Constraints
- Node.js >= 24 required.
## Open Questions
- None at this time.
## Audit Notes
No contradictions detected.`;

const mockMessagesCreate = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: FAKE_BRIEF }],
});

vi.mock("@anthropic-ai/sdk", () => ({
  Anthropic: class {
    messages = { create: mockMessagesCreate };
  },
}));

const shared = { ensureIndexed: async () => {}, reindexFailed: false };

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

describe("create_snapshot handler — validation", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it("rejects missing topic", async () => {
    const result = await createSnapshotTool.handler({}, ctx, shared);
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("rejects empty topic string", async () => {
    const result = await createSnapshotTool.handler(
      { topic: "   " },
      ctx,
      shared,
    );
    isErr(result, "INVALID_INPUT");
  }, 30000);

  it("returns NO_ENTRIES when vault is empty", async () => {
    const result = await createSnapshotTool.handler(
      { topic: "empty vault topic" },
      ctx,
      shared,
    );
    isErr(result, "NO_ENTRIES");
  }, 30000);

  it("returns VAULT_NOT_FOUND when vault directory is missing", async () => {
    const brokenCtx = {
      ...ctx,
      config: { ...ctx.config, vaultDirExists: false },
    };
    const result = await createSnapshotTool.handler(
      { topic: "anything" },
      brokenCtx,
      shared,
    );
    isErr(result, "VAULT_NOT_FOUND");
  }, 30000);
});

describe("create_snapshot handler — happy path", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    await captureAndIndex(ctx, {
      kind: "insight",
      title: "SQLite WAL mode",
      body: "WAL mode allows concurrent reads and writes in SQLite databases",
      tags: ["sqlite", "database"],
      source: "test",
    });
    await captureAndIndex(ctx, {
      kind: "decision",
      title: "Use SQLite for storage",
      body: "We chose SQLite over PostgreSQL for local-first storage",
      tags: ["database", "architecture"],
      source: "test",
    });
    await captureAndIndex(ctx, {
      kind: "pattern",
      title: "ULID identifiers",
      body: "Use ULID for all entity IDs to ensure sortable unique keys",
      tags: ["patterns", "database"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("creates a brief and returns a ULID", async () => {
    const result = await createSnapshotTool.handler(
      { topic: "Test Topic" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("✓ Snapshot created");
    expect(text).toContain("id:");
    expect(text).toContain("identity_key:");
    expect(text).toContain("synthesized from:");
  }, 30000);

  it("saves brief with kind 'brief' in the vault", async () => {
    await createSnapshotTool.handler({ topic: "Test Topic" }, ctx, shared);
    const row = ctx.db
      .prepare("SELECT * FROM vault WHERE kind = 'brief' LIMIT 1")
      .get();
    expect(row).toBeTruthy();
    expect(row.kind).toBe("brief");
    expect(row.title).toContain("Context Brief");
  }, 30000);

  it("uses provided identity_key for deterministic retrieval", async () => {
    const result = await createSnapshotTool.handler(
      { topic: "Test Topic", identity_key: "my-custom-key" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("my-custom-key");

    const row = ctx.db
      .prepare("SELECT * FROM vault WHERE identity_key = ?")
      .get("my-custom-key");
    expect(row).toBeTruthy();
    expect(row.kind).toBe("brief");
  }, 30000);

  it("defaults identity_key to snapshot-<slugified-topic>", async () => {
    const result = await createSnapshotTool.handler(
      { topic: "My Project" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("snapshot-my-project");
  }, 30000);

  it("filters by tags when provided", async () => {
    const result = await createSnapshotTool.handler(
      { topic: "Test Topic", tags: ["patterns"] },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("synthesized from: 1");
  }, 30000);

  it("filters by kinds when provided", async () => {
    const result = await createSnapshotTool.handler(
      { topic: "Test Topic", kinds: ["insight"] },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("synthesized from:");
  }, 30000);

  it("stores synthesized_from metadata on the brief entry", async () => {
    await createSnapshotTool.handler(
      { topic: "Test Topic", identity_key: "meta-test-key" },
      ctx,
      shared,
    );
    const row = ctx.db
      .prepare("SELECT * FROM vault WHERE identity_key = ?")
      .get("meta-test-key");
    expect(row).toBeTruthy();
    const meta = JSON.parse(row.meta);
    expect(meta.topic).toBe("Test Topic");
    expect(meta.entry_count).toBeGreaterThan(0);
    expect(Array.isArray(meta.synthesized_from)).toBe(true);
  }, 30000);

  it("body of saved brief contains LLM output", async () => {
    await createSnapshotTool.handler(
      { topic: "Test Topic", identity_key: "body-check-key" },
      ctx,
      shared,
    );
    const row = ctx.db
      .prepare("SELECT * FROM vault WHERE identity_key = ?")
      .get("body-check-key");
    expect(row.body).toContain("Context Brief");
    expect(row.body).toContain("Key Decisions");
  }, 30000);
});

describe("create_snapshot handler — noise suppression", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    await captureAndIndex(ctx, {
      kind: "insight",
      title: "Core insight about caching",
      body: "Use LRU cache for frequently accessed data in the caching layer",
      tags: ["caching", "performance"],
      source: "test",
    });
    await captureAndIndex(ctx, {
      kind: "prompt-history",
      title: "Prompt log 001",
      body: "Caching performance discussion prompt history entry",
      tags: ["caching"],
      source: "test",
    });
    await captureAndIndex(ctx, {
      kind: "task-notification",
      title: "Task done: review caching",
      body: "Reviewed caching strategy for the caching module",
      tags: ["caching"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("excludes noise kinds from synthesis entries", async () => {
    const result = await createSnapshotTool.handler(
      { topic: "caching", identity_key: "caching-snapshot" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("noise superseded:");

    const row = ctx.db
      .prepare("SELECT * FROM vault WHERE identity_key = ?")
      .get("caching-snapshot");
    const meta = JSON.parse(row.meta);
    expect(meta.noise_superseded).toBeGreaterThan(0);
    expect(meta.entry_count).toBeGreaterThanOrEqual(1);
  }, 30000);

  it("marks noise entries as superseded_by the brief", async () => {
    const briefRow = ctx.db
      .prepare("SELECT * FROM vault WHERE identity_key = 'caching-snapshot'")
      .get();
    if (!briefRow) return;

    const supersededRows = ctx.db
      .prepare(
        "SELECT * FROM vault WHERE superseded_by = ? AND kind IN ('prompt-history', 'task-notification')",
      )
      .all(briefRow.id);
    expect(supersededRows.length).toBeGreaterThan(0);
  }, 30000);
});

describe("create_snapshot handler — LLM error handling", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    await captureAndIndex(ctx, {
      kind: "insight",
      title: "Some insight",
      body: "Content for LLM error test",
      tags: ["test"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("returns LLM_ERROR when Anthropic call fails", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error("API key invalid"));

    const result = await createSnapshotTool.handler(
      { topic: "test error topic" },
      ctx,
      shared,
    );

    isErr(result, "LLM_ERROR");
  }, 30000);
});
