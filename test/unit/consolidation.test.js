/**
 * Unit tests for consolidation utilities — findHotTags() and findColdEntries().
 *
 * All tests use an isolated in-memory DB via createTestCtx so they are
 * completely independent of the user's real vault.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCtx } from "../helpers/ctx.js";
import { captureAndIndex } from "@context-vault/core/capture";
import {
  findHotTags,
  findColdEntries,
} from "../../packages/core/src/consolidation/index.js";

// ─── findHotTags ─────────────────────────────────────────────────────────────

describe("findHotTags — empty vault", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it("returns empty array when vault has no entries", () => {
    const result = findHotTags(ctx.db);
    expect(result).toEqual([]);
  });

  it("returns empty array with explicit options when vault is empty", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 1,
      maxSnapshotAgeDays: 7,
    });
    expect(result).toEqual([]);
  });
});

describe("findHotTags — below threshold", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    for (let i = 0; i < 5; i++) {
      await captureAndIndex(ctx, {
        kind: "insight",
        title: `Insight ${i}`,
        body: `Body for insight ${i}`,
        tags: ["react"],
        source: "test",
      });
    }
  }, 60000);

  afterAll(() => cleanup());

  it("does not flag tags below the threshold", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 10,
      maxSnapshotAgeDays: 7,
    });
    expect(result).toEqual([]);
  });

  it("flags tags when threshold is lowered to match count", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 5,
      maxSnapshotAgeDays: 7,
    });
    const tags = result.map((r) => r.tag);
    expect(tags).toContain("react");
  });
});

describe("findHotTags — above threshold", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    for (let i = 0; i < 12; i++) {
      await captureAndIndex(ctx, {
        kind: "insight",
        title: `React insight ${i}`,
        body: `React hooks insight body ${i}`,
        tags: ["react", "hooks"],
        source: "test",
      });
    }
    for (let i = 0; i < 3; i++) {
      await captureAndIndex(ctx, {
        kind: "insight",
        title: `Vue insight ${i}`,
        body: `Vue component body ${i}`,
        tags: ["vue"],
        source: "test",
      });
    }
  }, 60000);

  afterAll(() => cleanup());

  it("returns hot tags sorted by entry count descending", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 10,
      maxSnapshotAgeDays: 7,
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].entryCount).toBeGreaterThanOrEqual(
        result[i].entryCount,
      );
    }
  });

  it("includes entryCount in each result", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 10,
      maxSnapshotAgeDays: 7,
    });
    const reactEntry = result.find((r) => r.tag === "react");
    expect(reactEntry).toBeDefined();
    expect(reactEntry.entryCount).toBe(12);
  });

  it("does not flag tags below the threshold", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 10,
      maxSnapshotAgeDays: 7,
    });
    const vueEntry = result.find((r) => r.tag === "vue");
    expect(vueEntry).toBeUndefined();
  });

  it("sets lastSnapshotAge to null when no snapshot exists", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 10,
      maxSnapshotAgeDays: 7,
    });
    const reactEntry = result.find((r) => r.tag === "react");
    expect(reactEntry).toBeDefined();
    expect(reactEntry.lastSnapshotAge).toBeNull();
  });
});

describe("findHotTags — suppressed by recent snapshot", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    for (let i = 0; i < 15; i++) {
      await captureAndIndex(ctx, {
        kind: "insight",
        title: `Auth insight ${i}`,
        body: `Auth system insight ${i}`,
        tags: ["auth"],
        source: "test",
      });
    }
    await captureAndIndex(ctx, {
      kind: "brief",
      title: "Auth — Context Brief",
      body: "Summary of auth system",
      tags: ["auth", "snapshot"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("skips tags that already have a recent brief", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 10,
      maxSnapshotAgeDays: 7,
    });
    const authEntry = result.find((r) => r.tag === "auth");
    expect(authEntry).toBeUndefined();
  });
});

describe("findHotTags — lastSnapshotAge when old snapshot exists", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    for (let i = 0; i < 12; i++) {
      await captureAndIndex(ctx, {
        kind: "insight",
        title: `Perf insight ${i}`,
        body: `Performance optimization ${i}`,
        tags: ["performance"],
        source: "test",
      });
    }
    ctx.db
      .prepare(
        `INSERT INTO vault (id, kind, category, title, body, tags, source, created_at)
         VALUES (?, 'brief', 'knowledge', 'Perf Brief', 'old brief', ?, 'test', ?)`,
      )
      .run(
        "TEST-OLD-BRIEF-ID",
        JSON.stringify(["performance", "snapshot"]),
        new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      );
  }, 60000);

  afterAll(() => cleanup());

  it("reports lastSnapshotAge when an older brief exists", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 10,
      maxSnapshotAgeDays: 7,
    });
    const perfEntry = result.find((r) => r.tag === "performance");
    expect(perfEntry).toBeDefined();
    expect(perfEntry.lastSnapshotAge).toBeGreaterThan(0);
  });
});

describe("findHotTags — ignores superseded entries", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    const entries = [];
    for (let i = 0; i < 12; i++) {
      const e = await captureAndIndex(ctx, {
        kind: "insight",
        title: `Legacy insight ${i}`,
        body: `Legacy body ${i}`,
        tags: ["legacy"],
        source: "test",
      });
      entries.push(e);
    }
    for (const e of entries) {
      ctx.db
        .prepare(`UPDATE vault SET superseded_by = 'SOME-BRIEF' WHERE id = ?`)
        .run(e.id);
    }
  }, 60000);

  afterAll(() => cleanup());

  it("does not count superseded entries toward the tag threshold", () => {
    const result = findHotTags(ctx.db, {
      tagThreshold: 10,
      maxSnapshotAgeDays: 7,
    });
    const legacyEntry = result.find((r) => r.tag === "legacy");
    expect(legacyEntry).toBeUndefined();
  });
});

// ─── findColdEntries ─────────────────────────────────────────────────────────

describe("findColdEntries — empty vault", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it("returns empty array when vault is empty", () => {
    const result = findColdEntries(ctx.db);
    expect(result).toEqual([]);
  });
});

describe("findColdEntries — recent entries excluded", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    await captureAndIndex(ctx, {
      kind: "insight",
      title: "Recent entry",
      body: "This was created just now",
      tags: ["new"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  it("does not return recently created entries", () => {
    const result = findColdEntries(ctx.db, { maxAgeDays: 90, maxHitCount: 0 });
    expect(result).toEqual([]);
  });
});

describe("findColdEntries — old entries returned", () => {
  let ctx, cleanup;
  let coldId;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    const e = await captureAndIndex(ctx, {
      kind: "insight",
      title: "Old stale entry",
      body: "This entry is very old and was never accessed",
      tags: ["stale"],
      source: "test",
    });
    coldId = e.id;
    ctx.db
      .prepare(
        `UPDATE vault SET created_at = datetime('now', '-100 days'), hit_count = 0 WHERE id = ?`,
      )
      .run(coldId);
  }, 60000);

  afterAll(() => cleanup());

  it("returns IDs of old never-accessed entries", () => {
    const result = findColdEntries(ctx.db, { maxAgeDays: 90, maxHitCount: 0 });
    expect(result).toContain(coldId);
  });

  it("does not return the entry if hit_count exceeds maxHitCount", () => {
    ctx.db.prepare(`UPDATE vault SET hit_count = 5 WHERE id = ?`).run(coldId);
    const result = findColdEntries(ctx.db, { maxAgeDays: 90, maxHitCount: 0 });
    expect(result).not.toContain(coldId);
    ctx.db.prepare(`UPDATE vault SET hit_count = 0 WHERE id = ?`).run(coldId);
  });
});

describe("findColdEntries — protected kinds excluded", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    for (const kind of ["decision", "architecture", "brief"]) {
      const e = await captureAndIndex(ctx, {
        kind,
        title: `Protected ${kind}`,
        body: `This is a protected ${kind} entry`,
        tags: ["test"],
        source: "test",
      });
      ctx.db
        .prepare(
          `UPDATE vault SET created_at = datetime('now', '-100 days'), hit_count = 0 WHERE id = ?`,
        )
        .run(e.id);
    }
  }, 60000);

  afterAll(() => cleanup());

  it("does not return decision entries", () => {
    const result = findColdEntries(ctx.db, { maxAgeDays: 90, maxHitCount: 0 });
    expect(result).toHaveLength(0);
  });
});

describe("findColdEntries — superseded entries excluded", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
    const e = await captureAndIndex(ctx, {
      kind: "insight",
      title: "Superseded old entry",
      body: "This was superseded by a newer entry",
      tags: ["old"],
      source: "test",
    });
    ctx.db
      .prepare(
        `UPDATE vault SET created_at = datetime('now', '-100 days'), hit_count = 0, superseded_by = 'SOME-ID' WHERE id = ?`,
      )
      .run(e.id);
  }, 60000);

  afterAll(() => cleanup());

  it("does not return superseded entries", () => {
    const result = findColdEntries(ctx.db, { maxAgeDays: 90, maxHitCount: 0 });
    expect(result).toEqual([]);
  });
});
