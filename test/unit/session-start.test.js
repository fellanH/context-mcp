import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCtx } from "../helpers/ctx.js";
import { captureAndIndex } from "@context-vault/core/capture";
import * as sessionStartTool from "../../packages/core/src/server/tools/session-start.js";

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

describe("session_start handler — tool metadata", () => {
  it("exports correct tool name", () => {
    expect(sessionStartTool.name).toBe("session_start");
  });

  it("exports a description string", () => {
    expect(typeof sessionStartTool.description).toBe("string");
    expect(sessionStartTool.description.length).toBeGreaterThan(10);
  });

  it("exports inputSchema with project and max_tokens", () => {
    expect(sessionStartTool.inputSchema).toHaveProperty("project");
    expect(sessionStartTool.inputSchema).toHaveProperty("max_tokens");
  });
});

describe("session_start handler — empty vault", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it("returns a brief even with an empty vault", async () => {
    const result = await sessionStartTool.handler(
      { project: "test-project" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Session Brief");
    expect(text).toContain("test-project");
  }, 30000);

  it("returns VAULT_NOT_FOUND when vault directory is missing", async () => {
    const brokenCtx = {
      ...ctx,
      config: { ...ctx.config, vaultDirExists: false },
    };
    const result = await sessionStartTool.handler(
      { project: "anything" },
      brokenCtx,
      shared,
    );
    isErr(result, "VAULT_NOT_FOUND");
  }, 30000);
});

describe("session_start handler — with data", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    await captureAndIndex(ctx, {
      kind: "decision",
      title: "Use SQLite for storage",
      body: "We chose SQLite over PostgreSQL for local-first architecture",
      tags: ["myapp", "architecture"],
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "insight",
      title: "WAL mode improves concurrency",
      body: "SQLite WAL mode allows concurrent reads and writes",
      tags: ["myapp", "sqlite"],
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "pattern",
      title: "ULID for identifiers",
      body: "Use ULID for all entity IDs to ensure sortable unique keys",
      tags: ["myapp", "patterns"],
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "session",
      title: "Last session summary",
      body: "Worked on implementing the search pipeline with RRF and MMR reranking.",
      tags: ["myapp"],
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "note",
      title: "Random note",
      body: "This is a general note not tagged with myapp",
      tags: ["other-project"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("returns a structured brief with all sections", async () => {
    const result = await sessionStartTool.handler(
      { project: "myapp" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Session Brief");
    expect(text).toContain("myapp");
    expect(text).toContain("Last Session Summary");
    expect(text).toContain("Active Decisions, Insights & Patterns");
  }, 30000);

  it("includes last session summary in the brief", async () => {
    const result = await sessionStartTool.handler(
      { project: "myapp" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("search pipeline");
  }, 30000);

  it("includes decisions, insights, and patterns", async () => {
    const result = await sessionStartTool.handler(
      { project: "myapp" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Use SQLite for storage");
    expect(text).toContain("WAL mode improves concurrency");
    expect(text).toContain("ULID for identifiers");
  }, 30000);

  it("works without explicit project (auto-detect fallback)", async () => {
    const result = await sessionStartTool.handler({}, ctx, shared);
    const text = isOk(result);
    expect(text).toContain("Session Brief");
  }, 30000);

  it("includes _meta with token usage info", async () => {
    const result = await sessionStartTool.handler(
      { project: "myapp" },
      ctx,
      shared,
    );
    expect(result._meta).toBeTruthy();
    expect(result._meta.tokens_budget).toBe(4000);
    expect(result._meta.tokens_used).toBeGreaterThan(0);
    expect(result._meta.project).toBe("myapp");
    expect(result._meta.sections).toBeTruthy();
  }, 30000);

  it("shows token usage in footer", async () => {
    const result = await sessionStartTool.handler(
      { project: "myapp" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toMatch(/\d+ \/ 4000 tokens used/);
  }, 30000);
});

describe("session_start handler — token budget", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    for (let i = 0; i < 20; i++) {
      await captureAndIndex(ctx, {
        kind: "insight",
        title: `Insight number ${i}`,
        body: `This is a fairly long insight body for entry ${i}. `.repeat(10),
        tags: ["bigproject"],
        source: "test",
      });
    }

    await captureAndIndex(ctx, {
      kind: "session",
      title: "Previous session",
      body: "Long session summary content. ".repeat(20),
      tags: ["bigproject"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("respects custom max_tokens parameter", async () => {
    const result = await sessionStartTool.handler(
      { project: "bigproject", max_tokens: 500 },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(result._meta.tokens_budget).toBe(500);
    expect(result._meta.tokens_used).toBeLessThanOrEqual(550);
  }, 30000);

  it("defaults to 4000 token budget", async () => {
    const result = await sessionStartTool.handler(
      { project: "bigproject" },
      ctx,
      shared,
    );
    expect(result._meta.tokens_budget).toBe(4000);
  }, 30000);

  it("stays within token budget with many entries", async () => {
    const result = await sessionStartTool.handler(
      { project: "bigproject", max_tokens: 1000 },
      ctx,
      shared,
    );
    expect(result._meta.tokens_used).toBeLessThanOrEqual(1100);
  }, 30000);
});

describe("session_start handler — project scoping", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    await captureAndIndex(ctx, {
      kind: "decision",
      title: "Project A decision",
      body: "Decision for project A",
      tags: ["project-a"],
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "decision",
      title: "Project B decision",
      body: "Decision for project B",
      tags: ["project-b"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("scopes entries to the specified project tag", async () => {
    const result = await sessionStartTool.handler(
      { project: "project-a" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Project A decision");
    expect(text).not.toContain("Project B decision");
  }, 30000);

  it("scopes to project-b when requested", async () => {
    const result = await sessionStartTool.handler(
      { project: "project-b" },
      ctx,
      shared,
    );
    const text = isOk(result);
    expect(text).toContain("Project B decision");
    expect(text).not.toContain("Project A decision");
  }, 30000);
});
