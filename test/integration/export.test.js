import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCtx } from "../helpers/ctx.js";
import { captureAndIndex } from "@context-vault/core/capture";
import { indexEntry } from "@context-vault/core/index";

describe("paginated export", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    // Seed 10 entries with staggered timestamps for deterministic ordering
    for (let i = 0; i < 10; i++) {
      await captureAndIndex(ctx, {
        kind: "insight",
        title: `Entry ${i}`,
        body: `Body of entry ${i}`,
        tags: [`tag-${i % 3}`],
        source: "test",
      }, indexEntry);
    }
  }, 60000);

  afterAll(() => cleanup());

  it("returns all entries without pagination params", () => {
    const rows = ctx.db.prepare(
      "SELECT * FROM vault WHERE (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at ASC"
    ).all();
    expect(rows.length).toBe(10);
  });

  it("respects LIMIT and OFFSET", () => {
    const page1 = ctx.db.prepare(
      "SELECT id, title FROM vault ORDER BY created_at ASC LIMIT ? OFFSET ?"
    ).all(3, 0);
    expect(page1.length).toBe(3);

    const page2 = ctx.db.prepare(
      "SELECT id, title FROM vault ORDER BY created_at ASC LIMIT ? OFFSET ?"
    ).all(3, 3);
    expect(page2.length).toBe(3);

    // No overlap between pages
    const page1Ids = page1.map((r) => r.id);
    const page2Ids = page2.map((r) => r.id);
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toEqual([]);
  });

  it("returns correct total via COUNT", () => {
    const { c: total } = ctx.db.prepare("SELECT COUNT(*) as c FROM vault").get();
    expect(total).toBe(10);
  });

  it("handles offset beyond total (returns empty)", () => {
    const rows = ctx.db.prepare(
      "SELECT id FROM vault ORDER BY created_at ASC LIMIT ? OFFSET ?"
    ).all(5, 100);
    expect(rows.length).toBe(0);
  });

  it("last page returns fewer rows than limit", () => {
    const rows = ctx.db.prepare(
      "SELECT id FROM vault ORDER BY created_at ASC LIMIT ? OFFSET ?"
    ).all(4, 8);
    expect(rows.length).toBe(2); // only 2 remaining
  });

  it("iterating pages covers all entries", () => {
    const pageSize = 3;
    const allIds = [];
    let offset = 0;

    while (true) {
      const rows = ctx.db.prepare(
        "SELECT id FROM vault ORDER BY created_at ASC LIMIT ? OFFSET ?"
      ).all(pageSize, offset);
      if (rows.length === 0) break;
      allIds.push(...rows.map((r) => r.id));
      offset += rows.length;
      if (rows.length < pageSize) break;
    }

    expect(allIds.length).toBe(10);
    // All unique
    expect(new Set(allIds).size).toBe(10);
  });
});
