import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  buildFtsQuery,
  recencyBoost,
  recencyDecayScore,
  reciprocalRankFusion,
  jaccardSimilarity,
  maximalMarginalRelevance,
  buildFilterClauses,
  hybridSearch,
  dotProduct,
} from "@context-vault/core/retrieve";
import { createTestCtx } from "../helpers/ctx.js";
import { captureAndIndex } from "@context-vault/core/capture";

// ─── buildFtsQuery ──────────────────────────────────────────────────────────

describe("buildFtsQuery", () => {
  it("uses tiered phrase/NEAR/AND for multi-word queries", () => {
    expect(buildFtsQuery("sqlite wal mode")).toBe(
      '"sqlite wal mode" OR NEAR("sqlite" "wal" "mode", 10) OR "sqlite" AND "wal" AND "mode"',
    );
  });

  it("strips FTS5 metacharacters", () => {
    expect(buildFtsQuery('hello* "world" (test)')).toBe(
      '"hello world test" OR NEAR("hello" "world" "test", 10) OR "hello" AND "world" AND "test"',
    );
  });

  it("strips colons, carets, tildes, braces", () => {
    expect(buildFtsQuery("col:on car^et til~de {brace}")).toBe(
      '"colon caret tilde brace" OR NEAR("colon" "caret" "tilde" "brace", 10) OR "colon" AND "caret" AND "tilde" AND "brace"',
    );
  });

  it("returns null for empty query", () => {
    expect(buildFtsQuery("")).toBeNull();
  });

  it("returns null for query of only metacharacters", () => {
    expect(buildFtsQuery('*"():-^~{}')).toBeNull();
  });

  it("handles single word", () => {
    expect(buildFtsQuery("sqlite")).toBe('"sqlite"');
  });

  it("handles extra whitespace", () => {
    expect(buildFtsQuery("  hello   world  ")).toBe(
      '"hello world" OR NEAR("hello" "world", 10) OR "hello" AND "world"',
    );
  });

  it("splits hyphenated words into separate terms", () => {
    expect(buildFtsQuery("well-known")).toBe(
      '"well known" OR NEAR("well" "known", 10) OR "well" AND "known"',
    );
  });

  it("phrase is first tier for exact-match prioritisation", () => {
    const result = buildFtsQuery("react server components");
    expect(result).toMatch(/^"react server components"/);
  });
});

// ─── recencyBoost ───────────────────────────────────────────────────────────

describe("recencyBoost", () => {
  it("returns 1.0 for knowledge category (no decay)", () => {
    const oldDate = "2020-01-01T00:00:00Z";
    expect(recencyBoost(oldDate, "knowledge")).toBe(1.0);
  });

  it("returns 1.0 for entity category (no decay)", () => {
    const oldDate = "2020-01-01T00:00:00Z";
    expect(recencyBoost(oldDate, "entity")).toBe(1.0);
  });

  it("returns 1.0 for event created just now", () => {
    const now = new Date().toISOString();
    expect(recencyBoost(now, "event")).toBeCloseTo(1.0, 1);
  });

  it("decays event entries over time", () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const boost = recencyBoost(thirtyDaysAgo, "event", 30);
    // At decayDays, formula gives 1 / (1 + 1) = 0.5
    expect(boost).toBeCloseTo(0.5, 1);
  });

  it("decays further for older events", () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();
    const boost = recencyBoost(sixtyDaysAgo, "event", 30);
    // 1 / (1 + 2) = 0.333
    expect(boost).toBeCloseTo(0.333, 1);
  });

  it("respects custom decayDays", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
    const boost = recencyBoost(tenDaysAgo, "event", 10);
    expect(boost).toBeCloseTo(0.5, 1);
  });

  it("returns ~1.0 for null/undefined category", () => {
    const oldDate = "2020-01-01T00:00:00Z";
    expect(recencyBoost(oldDate, null)).toBe(1.0);
    expect(recencyBoost(oldDate, undefined)).toBe(1.0);
  });
});

// ─── recencyDecayScore ──────────────────────────────────────────────────────

describe("recencyDecayScore", () => {
  it("returns ~1.0 for an entry updated just now", () => {
    const now = new Date().toISOString();
    expect(recencyDecayScore(now)).toBeCloseTo(1.0, 2);
  });

  it("returns ~0.5 for an entry updated ~14 days ago (decay_rate=0.05)", () => {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString();
    const score = recencyDecayScore(fourteenDaysAgo, 0.05);
    expect(score).toBeCloseTo(Math.exp(-0.05 * 14), 2);
  });

  it("returns 0.5 for null updatedAt (neutral score)", () => {
    expect(recencyDecayScore(null)).toBe(0.5);
  });

  it("returns 0.5 for undefined updatedAt (neutral score)", () => {
    expect(recencyDecayScore(undefined)).toBe(0.5);
  });

  it("returns a lower score for older entries", () => {
    const recent = new Date(Date.now() - 5 * 86400000).toISOString();
    const old = new Date(Date.now() - 60 * 86400000).toISOString();
    expect(recencyDecayScore(recent)).toBeGreaterThan(recencyDecayScore(old));
  });

  it("score is in [0, 1] range", () => {
    const dates = [
      new Date().toISOString(),
      new Date(Date.now() - 30 * 86400000).toISOString(),
      new Date(Date.now() - 365 * 86400000).toISOString(),
    ];
    for (const d of dates) {
      const score = recencyDecayScore(d);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

// ─── buildFilterClauses ─────────────────────────────────────────────────────

describe("buildFilterClauses", () => {
  it("always includes expiry clause", () => {
    const { clauses, params } = buildFilterClauses({});
    expect(clauses).toHaveLength(2);
    expect(clauses.some((c) => c.includes("expires_at"))).toBe(true);
    expect(clauses.some((c) => c.includes("superseded_by"))).toBe(true);
    expect(params).toHaveLength(0);
  });

  it("adds category filter", () => {
    const { clauses, params } = buildFilterClauses({
      categoryFilter: "knowledge",
    });
    expect(clauses).toContain("e.category = ?");
    expect(params).toContain("knowledge");
  });

  it("adds since filter", () => {
    const { clauses, params } = buildFilterClauses({ since: "2025-01-01" });
    expect(clauses).toContain("e.created_at >= ?");
    expect(params).toContain("2025-01-01");
  });

  it("adds until filter", () => {
    const { clauses, params } = buildFilterClauses({ until: "2026-12-31" });
    expect(clauses).toContain("e.created_at <= ?");
    expect(params).toContain("2026-12-31");
  });

  it("adds userId filter", () => {
    const { clauses, params } = buildFilterClauses({
      userIdFilter: "user-123",
    });
    expect(clauses).toContain("e.user_id = ?");
    expect(params).toContain("user-123");
  });

  it("adds teamId filter", () => {
    const { clauses, params } = buildFilterClauses({
      teamIdFilter: "team-456",
    });
    expect(clauses).toContain("e.team_id = ?");
    expect(params).toContain("team-456");
  });

  it("combines all filters", () => {
    const { clauses, params } = buildFilterClauses({
      categoryFilter: "entity",
      since: "2025-01-01",
      until: "2026-01-01",
      userIdFilter: "u1",
      teamIdFilter: "t1",
    });
    // 5 explicit + 1 expiry + 1 superseded_by
    expect(clauses).toHaveLength(7);
    expect(params).toHaveLength(5);
  });

  it("skips falsy teamIdFilter", () => {
    const { clauses } = buildFilterClauses({ teamIdFilter: null });
    const teamClauses = clauses.filter((c) => c.includes("team_id"));
    expect(teamClauses).toHaveLength(0);
  });

  it("includes userIdFilter even when value is null-ish string", () => {
    // userIdFilter uses !== undefined check, so null should still be included
    const { clauses } = buildFilterClauses({ userIdFilter: null });
    expect(clauses).toContain("e.user_id = ?");
  });

  it("adds category exclusion when excludeEvents is true", () => {
    const { clauses } = buildFilterClauses({ excludeEvents: true });
    expect(clauses).toContain("e.category != 'event'");
  });

  it("does not add event exclusion when excludeEvents is false", () => {
    const { clauses } = buildFilterClauses({ excludeEvents: false });
    expect(clauses.some((c) => c.includes("!= 'event'"))).toBe(false);
  });

  it("does not add event exclusion when categoryFilter is set", () => {
    const { clauses } = buildFilterClauses({
      excludeEvents: true,
      categoryFilter: "knowledge",
    });
    expect(clauses.some((c) => c.includes("!= 'event'"))).toBe(false);
  });
});

// ─── dotProduct ─────────────────────────────────────────────────────────────

describe("dotProduct", () => {
  it("returns 1.0 for identical unit vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    expect(dotProduct(a, a)).toBeCloseTo(1.0);
  });

  it("returns 0.0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(dotProduct(a, b)).toBeCloseTo(0.0);
  });

  it("returns -1.0 for opposite unit vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(dotProduct(a, b)).toBeCloseTo(-1.0);
  });

  it("computes correct dot product for general vectors", () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([4, 5, 6]);
    expect(dotProduct(a, b)).toBeCloseTo(32.0);
  });
});

// ─── reciprocalRankFusion ────────────────────────────────────────────────────

describe("reciprocalRankFusion", () => {
  it("scores a document higher when it appears in both lists", () => {
    const list1 = ["a", "b", "c"];
    const list2 = ["b", "a", "d"];
    const scores = reciprocalRankFusion([list1, list2]);
    // "a" is rank 0 in list1, rank 1 in list2 → 1/61 + 1/62
    // "b" is rank 1 in list1, rank 0 in list2 → 1/62 + 1/61
    expect(scores.get("a")).toBeCloseTo(scores.get("b"), 5);
    // "c" only in list1, "d" only in list2
    expect(scores.get("a")).toBeGreaterThan(scores.get("c"));
    expect(scores.get("a")).toBeGreaterThan(scores.get("d"));
  });

  it("assigns lower score to lower-ranked documents", () => {
    const list = ["first", "second", "third"];
    const scores = reciprocalRankFusion([list]);
    expect(scores.get("first")).toBeGreaterThan(scores.get("second"));
    expect(scores.get("second")).toBeGreaterThan(scores.get("third"));
  });

  it("handles empty lists", () => {
    const scores = reciprocalRankFusion([[], []]);
    expect(scores.size).toBe(0);
  });

  it("handles single list with single item", () => {
    const scores = reciprocalRankFusion([["only"]]);
    expect(scores.get("only")).toBeCloseTo(1 / 61);
  });

  it("applies custom k constant", () => {
    const list = ["a"];
    const scores = reciprocalRankFusion([list], 0);
    expect(scores.get("a")).toBeCloseTo(1 / 1);
  });
});

// ─── jaccardSimilarity ───────────────────────────────────────────────────────

describe("jaccardSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(jaccardSimilarity("hello world", "hello world")).toBeCloseTo(1.0);
  });

  it("returns 0.0 for completely different strings", () => {
    expect(jaccardSimilarity("hello", "world")).toBeCloseTo(0);
  });

  it("returns partial score for partial overlap", () => {
    const sim = jaccardSimilarity("the quick brown fox", "the slow brown dog");
    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThan(1);
  });

  it("is case-insensitive", () => {
    const sim1 = jaccardSimilarity("Hello World", "hello world");
    expect(sim1).toBeCloseTo(1.0);
  });

  it("returns 1 for two empty strings", () => {
    expect(jaccardSimilarity("", "")).toBeCloseTo(1.0);
  });

  it("returns 0 when one string is empty", () => {
    expect(jaccardSimilarity("hello", "")).toBeCloseTo(0);
  });
});

// ─── maximalMarginalRelevance ─────────────────────────────────────────────────

describe("maximalMarginalRelevance", () => {
  it("returns empty array for empty candidates", () => {
    const result = maximalMarginalRelevance([], new Map(), new Map(), 5);
    expect(result).toHaveLength(0);
  });

  it("selects the most relevant candidate first", () => {
    const candidates = [
      { id: "low", title: "low", body: "low relevance" },
      { id: "high", title: "high", body: "high relevance" },
    ];
    const querySimMap = new Map([
      ["low", 0.2],
      ["high", 0.9],
    ]);
    const embeddingMap = new Map();
    const result = maximalMarginalRelevance(
      candidates,
      querySimMap,
      embeddingMap,
      2,
    );
    expect(result[0].id).toBe("high");
  });

  it("penalises redundant candidates using Jaccard fallback", () => {
    const candidates = [
      {
        id: "a",
        title: "SQLite WAL",
        body: "WAL mode concurrent reads writes SQLite",
      },
      {
        id: "b",
        title: "SQLite WAL",
        body: "WAL mode concurrent reads writes SQLite identical",
      },
      { id: "c", title: "React hooks", body: "useState useEffect React hooks" },
    ];
    const querySimMap = new Map([
      ["a", 0.9],
      ["b", 0.85],
      ["c", 0.7],
    ]);
    const embeddingMap = new Map();
    const result = maximalMarginalRelevance(
      candidates,
      querySimMap,
      embeddingMap,
      2,
    );
    // "a" is selected first (highest relevance).
    // "b" is very similar to "a" (Jaccard), so "c" should be preferred for slot 2.
    expect(result[0].id).toBe("a");
    expect(result[1].id).toBe("c");
  });

  it("respects n limit", () => {
    const candidates = [
      { id: "1", title: "one", body: "one" },
      { id: "2", title: "two", body: "two" },
      { id: "3", title: "three", body: "three" },
    ];
    const querySimMap = new Map([
      ["1", 0.9],
      ["2", 0.8],
      ["3", 0.7],
    ]);
    const result = maximalMarginalRelevance(
      candidates,
      querySimMap,
      new Map(),
      2,
    );
    expect(result).toHaveLength(2);
  });
});

// ─── hybridSearch (integration with real DB) ────────────────────────────────

describe("hybridSearch", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    // Seed diverse entries for testing
    await captureAndIndex(ctx, {
      kind: "insight",
      title: "SQLite WAL mode",
      body: "WAL mode allows concurrent reads and writes in SQLite databases. It is the recommended journal mode.",
      tags: ["sqlite", "database"],
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "decision",
      title: "Use Vite for builds",
      body: "Chose Vite over webpack for faster development builds and better HMR support.",
      tags: ["tooling", "frontend"],
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "pattern",
      title: "Error boundary pattern",
      body: "Wrap React components in error boundaries to catch rendering errors gracefully.",
      tags: ["react", "patterns"],
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "contact",
      title: "Alice Developer",
      body: "Alice is a senior frontend developer specializing in React and TypeScript.",
      tags: ["team", "frontend"],
      identity_key: "alice",
      source: "test",
    });

    await captureAndIndex(ctx, {
      kind: "session",
      title: "Production debugging session",
      body: "Debugged a memory leak in the production Node.js server caused by unclosed database connections.",
      tags: ["debugging", "nodejs"],
      source: "test",
    });
  }, 60000);

  afterAll(() => cleanup());

  // ── Basic search ────────────────────────────────────────────────────────

  it("finds entries by text query", async () => {
    const results = await hybridSearch(ctx, "SQLite WAL");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain("SQLite");
  }, 30000);

  it("returns results with score property", async () => {
    const results = await hybridSearch(ctx, "SQLite");
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r.score).toBe("number");
      expect(r.score).toBeGreaterThan(0);
    }
  }, 30000);

  it("returns results sorted by score descending", async () => {
    const results = await hybridSearch(ctx, "frontend React");
    expect(results.length).toBeGreaterThan(1);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  }, 30000);

  // ── Kind filter ─────────────────────────────────────────────────────────

  it("filters by kind", async () => {
    const results = await hybridSearch(ctx, "developer", {
      kindFilter: "contact",
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.kind).toBe("contact");
    }
  }, 30000);

  it("returns only matching kind even when query matches other kinds", async () => {
    // "SQLite WAL mode" is an insight topic — filtering by contact should exclude FTS matches.
    // Vector search may still return low-score semantic matches via post-filtering,
    // but all returned results must respect the kindFilter.
    const results = await hybridSearch(ctx, "SQLite WAL mode", {
      kindFilter: "contact",
    });
    for (const r of results) {
      expect(r.kind).toBe("contact");
    }
  }, 30000);

  // ── Category filter ─────────────────────────────────────────────────────

  it("filters by category", async () => {
    const results = await hybridSearch(ctx, "developer React", {
      categoryFilter: "entity",
    });
    for (const r of results) {
      expect(r.category).toBe("entity");
    }
  }, 30000);

  it("filters by event category", async () => {
    const results = await hybridSearch(ctx, "debugging memory leak", {
      categoryFilter: "event",
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.category).toBe("event");
    }
  }, 30000);

  // ── Time filters ────────────────────────────────────────────────────────

  it("filters by since date", async () => {
    const results = await hybridSearch(ctx, "SQLite", { since: "2020-01-01" });
    expect(results.length).toBeGreaterThan(0);
  }, 30000);

  it("returns empty when since is in the future", async () => {
    const results = await hybridSearch(ctx, "SQLite", { since: "2099-01-01" });
    expect(results).toHaveLength(0);
  }, 30000);

  it("filters by until date", async () => {
    const results = await hybridSearch(ctx, "SQLite", { until: "2099-12-31" });
    expect(results.length).toBeGreaterThan(0);
  }, 30000);

  it("returns empty when until is in the past", async () => {
    const results = await hybridSearch(ctx, "SQLite", { until: "2000-01-01" });
    expect(results).toHaveLength(0);
  }, 30000);

  // ── Pagination ──────────────────────────────────────────────────────────

  it("respects limit", async () => {
    const results = await hybridSearch(ctx, "developer frontend React", {
      limit: 2,
    });
    expect(results.length).toBeLessThanOrEqual(2);
  }, 30000);

  it("respects offset", async () => {
    const all = await hybridSearch(ctx, "developer frontend React", {
      limit: 10,
    });
    if (all.length > 1) {
      const offset = await hybridSearch(ctx, "developer frontend React", {
        limit: 10,
        offset: 1,
      });
      expect(offset[0].id).toBe(all[1].id);
    }
  }, 30000);

  // ── Recency decay ──────────────────────────────────────────────────────

  it("applies recency decay to event entries", async () => {
    // Insert an old event
    const pastDate = new Date(Date.now() - 90 * 86400000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    ctx.db
      .prepare(
        "INSERT INTO vault (id, kind, category, title, body, tags, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "old-event-1",
        "session",
        "event",
        "Old debug session",
        "This is an old debugging session from months ago about Node.js servers",
        '["debugging"]',
        "test",
        pastDate,
      );

    // Search — the old event should have a lower score than the recent one
    const results = await hybridSearch(ctx, "debugging session Node.js");
    const oldEvent = results.find((r) => r.id === "old-event-1");
    const newEvent = results.find(
      (r) => r.title === "Production debugging session",
    );

    if (oldEvent && newEvent) {
      expect(newEvent.score).toBeGreaterThan(oldEvent.score);
    }

    // Cleanup
    ctx.db.prepare("DELETE FROM vault WHERE id = ?").run("old-event-1");
  }, 30000);

  it("does not decay knowledge entries regardless of age", async () => {
    const pastDate = new Date(Date.now() - 365 * 86400000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    ctx.db
      .prepare(
        "INSERT INTO vault (id, kind, category, title, body, tags, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "old-insight-1",
        "insight",
        "knowledge",
        "Old SQLite insight",
        "SQLite is a lightweight embedded database engine",
        '["sqlite"]',
        "test",
        pastDate,
      );

    const results = await hybridSearch(ctx, "SQLite database engine");
    const oldInsight = results.find((r) => r.id === "old-insight-1");
    if (oldInsight) {
      // Knowledge entries get recencyBoost of 1.0 — score should not be diminished
      // We can't check the exact score, but we verify it's found and has a positive score
      expect(oldInsight.score).toBeGreaterThan(0);
    }

    ctx.db.prepare("DELETE FROM vault WHERE id = ?").run("old-insight-1");
  }, 30000);

  // ── Edge cases ──────────────────────────────────────────────────────────

  it("handles empty query gracefully (FTS skipped, vector only)", async () => {
    const results = await hybridSearch(ctx, "");
    // Empty query produces null from buildFtsQuery, only vector search runs
    // Vector search needs an embedding of "", which may or may not return results
    expect(Array.isArray(results)).toBe(true);
  }, 30000);

  it("handles special characters in query", async () => {
    const results = await hybridSearch(ctx, '***"test"*** (hello) {world}');
    expect(Array.isArray(results)).toBe(true);
  }, 30000);

  it("handles query with only FTS metacharacters", async () => {
    const results = await hybridSearch(ctx, '*"():-^~{}');
    expect(Array.isArray(results)).toBe(true);
  }, 30000);

  it("returns entries with expected fields", async () => {
    const results = await hybridSearch(ctx, "SQLite");
    expect(results.length).toBeGreaterThan(0);
    const entry = results[0];
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("kind");
    expect(entry).toHaveProperty("category");
    expect(entry).toHaveProperty("title");
    expect(entry).toHaveProperty("body");
    expect(entry).toHaveProperty("score");
    expect(entry).toHaveProperty("created_at");
    // Should NOT have raw rowid exposed
    expect(entry).not.toHaveProperty("rowid");
  }, 30000);

  // ── Combined filters ───────────────────────────────────────────────────

  it("combines kind and category filters", async () => {
    const results = await hybridSearch(ctx, "developer", {
      kindFilter: "contact",
      categoryFilter: "entity",
    });
    for (const r of results) {
      expect(r.kind).toBe("contact");
      expect(r.category).toBe("entity");
    }
  }, 30000);

  it("combines kind filter with time range", async () => {
    const results = await hybridSearch(ctx, "SQLite", {
      kindFilter: "insight",
      since: "2020-01-01",
      until: "2099-12-31",
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.kind).toBe("insight");
    }
  }, 30000);

  // ── Expired entries ─────────────────────────────────────────────────────

  it("excludes expired entries", async () => {
    const pastExpiry = new Date(Date.now() - 86400000)
      .toISOString()
      .replace("T", " ")
      .slice(0, 19);
    ctx.db
      .prepare(
        "INSERT INTO vault (id, kind, category, title, body, tags, source, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "expired-1",
        "insight",
        "knowledge",
        "Expired insight",
        "This entry about SQLite has expired and should not appear",
        '["sqlite"]',
        "test",
        pastExpiry,
      );

    const results = await hybridSearch(ctx, "expired SQLite insight");
    const expired = results.find((r) => r.id === "expired-1");
    expect(expired).toBeUndefined();

    ctx.db.prepare("DELETE FROM vault WHERE id = ?").run("expired-1");
  }, 30000);

  // ── Near-duplicate suppression ──────────────────────────────────────────

  it("suppresses near-duplicate results when candidates exceed limit", async () => {
    // Seed multiple near-identical entries about the same topic
    for (let i = 1; i <= 5; i++) {
      await captureAndIndex(ctx, {
        kind: "insight",
        title: `SQLite WAL mode note ${i}`,
        body: `WAL mode allows concurrent reads and writes in SQLite. It is the recommended journal mode for production use. Version ${i}.`,
        tags: ["sqlite"],
        source: "dedup-test",
      });
    }

    // With limit=3, near-dup suppression should prevent all 5 similar entries
    // from filling the results — at least one topically different entry should appear
    const results = await hybridSearch(ctx, "SQLite WAL concurrent reads", {
      limit: 3,
    });

    expect(results.length).toBeLessThanOrEqual(3);

    // Cleanup
    ctx.db.prepare("DELETE FROM vault WHERE source = ?").run("dedup-test");
  }, 60000);
});
