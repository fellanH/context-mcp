/**
 * Integration tests for the sync module — buildLocalManifest, computeSyncPlan.
 *
 * Tests the sync logic with a real local DB (no network calls).
 * Network-dependent tests (fetchRemoteManifest, executeSync) are mocked.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestCtx } from "../helpers/ctx.js";
import { captureAndIndex } from "@context-vault/core/capture";
import { indexEntry } from "@context-vault/core/index";
import {
  buildLocalManifest,
  computeSyncPlan,
} from "@context-vault/core/sync";

describe("sync: buildLocalManifest", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    // Seed with several entries
    for (let i = 0; i < 5; i++) {
      await captureAndIndex(
        ctx,
        {
          kind: "insight",
          title: `Test entry ${i}`,
          body: `Body content for test entry number ${i}`,
          tags: ["test", `entry-${i}`],
          source: "sync-test",
        },
        indexEntry
      );
    }
  }, 60000);

  afterAll(() => cleanup());

  it("returns a Map with all vault entries", () => {
    const manifest = buildLocalManifest(ctx);
    expect(manifest).toBeInstanceOf(Map);
    expect(manifest.size).toBe(5);
  });

  it("manifest entries have required fields", () => {
    const manifest = buildLocalManifest(ctx);
    for (const [id, entry] of manifest) {
      expect(id).toBeTruthy();
      expect(entry.id).toBe(id);
      expect(entry.created_at).toBeTruthy();
      expect(entry.kind).toBe("insight");
    }
  });
});

describe("sync: computeSyncPlan", () => {
  it("correctly identifies entries to push (local-only)", () => {
    const local = new Map([
      ["a", { id: "a", created_at: "2026-01-01", kind: "insight" }],
      ["b", { id: "b", created_at: "2026-01-02", kind: "decision" }],
    ]);
    const remote = new Map([
      ["a", { id: "a", created_at: "2026-01-01", kind: "insight" }],
    ]);

    const plan = computeSyncPlan(local, remote);
    expect(plan.toPush).toEqual(["b"]);
    expect(plan.toPull).toEqual([]);
    expect(plan.upToDate).toEqual(["a"]);
  });

  it("correctly identifies entries to pull (remote-only)", () => {
    const local = new Map([
      ["a", { id: "a", created_at: "2026-01-01", kind: "insight" }],
    ]);
    const remote = new Map([
      ["a", { id: "a", created_at: "2026-01-01", kind: "insight" }],
      ["c", { id: "c", created_at: "2026-01-03", kind: "note" }],
    ]);

    const plan = computeSyncPlan(local, remote);
    expect(plan.toPush).toEqual([]);
    expect(plan.toPull).toEqual(["c"]);
    expect(plan.upToDate).toEqual(["a"]);
  });

  it("handles both push and pull in same plan", () => {
    const local = new Map([
      ["shared", { id: "shared", created_at: "2026-01-01", kind: "insight" }],
      ["local-only", { id: "local-only", created_at: "2026-01-02", kind: "insight" }],
    ]);
    const remote = new Map([
      ["shared", { id: "shared", created_at: "2026-01-01", kind: "insight" }],
      ["remote-only", { id: "remote-only", created_at: "2026-01-03", kind: "decision" }],
    ]);

    const plan = computeSyncPlan(local, remote);
    expect(plan.toPush).toEqual(["local-only"]);
    expect(plan.toPull).toEqual(["remote-only"]);
    expect(plan.upToDate).toEqual(["shared"]);
  });

  it("returns empty plan when fully synced", () => {
    const entries = new Map([
      ["x", { id: "x", created_at: "2026-01-01", kind: "insight" }],
      ["y", { id: "y", created_at: "2026-01-02", kind: "note" }],
    ]);

    const plan = computeSyncPlan(entries, new Map(entries));
    expect(plan.toPush).toEqual([]);
    expect(plan.toPull).toEqual([]);
    expect(plan.upToDate).toHaveLength(2);
  });

  it("handles empty local manifest", () => {
    const local = new Map();
    const remote = new Map([
      ["a", { id: "a", created_at: "2026-01-01", kind: "insight" }],
    ]);

    const plan = computeSyncPlan(local, remote);
    expect(plan.toPush).toEqual([]);
    expect(plan.toPull).toEqual(["a"]);
    expect(plan.upToDate).toEqual([]);
  });

  it("handles empty remote manifest", () => {
    const local = new Map([
      ["a", { id: "a", created_at: "2026-01-01", kind: "insight" }],
    ]);
    const remote = new Map();

    const plan = computeSyncPlan(local, remote);
    expect(plan.toPush).toEqual(["a"]);
    expect(plan.toPull).toEqual([]);
    expect(plan.upToDate).toEqual([]);
  });

  it("handles both empty", () => {
    const plan = computeSyncPlan(new Map(), new Map());
    expect(plan.toPush).toEqual([]);
    expect(plan.toPull).toEqual([]);
    expect(plan.upToDate).toEqual([]);
  });

  it("handles large manifests (500+ entries)", () => {
    const local = new Map();
    const remote = new Map();

    // 300 shared, 200 local-only, 100 remote-only
    for (let i = 0; i < 300; i++) {
      const id = `shared-${i}`;
      const entry = { id, created_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}`, kind: "insight" };
      local.set(id, entry);
      remote.set(id, entry);
    }
    for (let i = 0; i < 200; i++) {
      const id = `local-${i}`;
      local.set(id, { id, created_at: "2026-01-02", kind: "insight" });
    }
    for (let i = 0; i < 100; i++) {
      const id = `remote-${i}`;
      remote.set(id, { id, created_at: "2026-01-03", kind: "insight" });
    }

    const plan = computeSyncPlan(local, remote);
    expect(plan.toPush).toHaveLength(200);
    expect(plan.toPull).toHaveLength(100);
    expect(plan.upToDate).toHaveLength(300);
  });

  it("deduplication: entries with same ID are up-to-date (not pushed or pulled)", () => {
    const local = new Map([
      ["dup-1", { id: "dup-1", created_at: "2026-01-01T00:00:00Z", kind: "insight", title: "Local version" }],
    ]);
    const remote = new Map([
      ["dup-1", { id: "dup-1", created_at: "2026-01-01T12:00:00Z", kind: "insight", title: "Remote version" }],
    ]);

    const plan = computeSyncPlan(local, remote);
    // Additive-only: same ID = up-to-date (no conflict resolution)
    expect(plan.upToDate).toEqual(["dup-1"]);
    expect(plan.toPush).toEqual([]);
    expect(plan.toPull).toEqual([]);
  });
});
