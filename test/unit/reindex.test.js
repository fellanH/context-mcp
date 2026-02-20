import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { createTestCtx } from "../helpers/ctx.js";
import { reindex } from "@context-vault/core/index";
import { formatFrontmatter } from "@context-vault/core/core/frontmatter";
import { formatBody } from "@context-vault/core/capture/formatters";

/**
 * Write a .md entry file to the vault directory with proper frontmatter.
 * Mirrors the format produced by writeEntryFile in capture/file-ops.js.
 */
function writeMdFile(
  vaultDir,
  categoryDir,
  kindDir,
  filename,
  {
    id,
    kind,
    title,
    body,
    tags,
    source,
    created,
    identity_key,
    expires_at,
    meta,
  },
) {
  const dir = join(vaultDir, categoryDir, kindDir);
  mkdirSync(dir, { recursive: true });

  const fmFields = { id };
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (k === "folder") continue;
      if (v !== null && v !== undefined) fmFields[k] = v;
    }
  }
  if (identity_key) fmFields.identity_key = identity_key;
  if (expires_at) fmFields.expires_at = expires_at;
  fmFields.tags = tags || [];
  fmFields.source = source || "file";
  fmFields.created = created || new Date().toISOString();

  const mdBody = formatBody(kind, { title, body, meta });
  const filePath = join(dir, filename);
  writeFileSync(filePath, formatFrontmatter(fmFields) + mdBody);
  return filePath;
}

// ─── reindex ────────────────────────────────────────────────────────────────

describe("reindex", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it("indexes new .md files from vault directory", async () => {
    writeMdFile(
      ctx.config.vaultDir,
      "knowledge",
      "insights",
      "test-basic-01234567.md",
      {
        id: "REINDEX_BASIC_01",
        kind: "insight",
        title: null,
        body: "Reindex basic test insight body",
        tags: ["test"],
        source: "file",
      },
    );

    const stats = await reindex(ctx);

    expect(stats.added).toBeGreaterThanOrEqual(1);

    const row = ctx.stmts.getEntryById.get("REINDEX_BASIC_01");
    expect(row).toBeTruthy();
    expect(row.kind).toBe("insight");
    expect(row.body).toContain("Reindex basic test insight body");
    expect(row.category).toBe("knowledge");
  }, 60000);

  it("detects body changes when fullSync is true", async () => {
    let row = ctx.stmts.getEntryById.get("REINDEX_BASIC_01");
    expect(row).toBeTruthy();

    const filePath = row.file_path;
    const raw = readFileSync(filePath, "utf-8");
    const updated = raw.replace(
      "Reindex basic test insight body",
      "Updated body for change detection test",
    );
    writeFileSync(filePath, updated);

    const stats = await reindex(ctx, { fullSync: true });

    expect(stats.updated).toBeGreaterThanOrEqual(1);

    row = ctx.stmts.getEntryById.get("REINDEX_BASIC_01");
    expect(row.body).toContain("Updated body for change detection test");
  }, 60000);

  it("reports unchanged count for files that have not changed", async () => {
    const stats = await reindex(ctx, { fullSync: true });

    expect(stats.unchanged).toBeGreaterThanOrEqual(1);
  }, 60000);

  it("returns correct stats object shape", async () => {
    writeMdFile(
      ctx.config.vaultDir,
      "knowledge",
      "decisions",
      "stats-test-01234567.md",
      {
        id: "REINDEX_STATS_01",
        kind: "decision",
        title: "Stats test decision",
        body: "Testing that stats object has correct fields",
        tags: ["test"],
      },
    );

    const stats = await reindex(ctx, { fullSync: true });

    expect(stats).toHaveProperty("added");
    expect(stats).toHaveProperty("updated");
    expect(stats).toHaveProperty("removed");
    expect(stats).toHaveProperty("unchanged");

    expect(typeof stats.added).toBe("number");
    expect(typeof stats.updated).toBe("number");
    expect(typeof stats.removed).toBe("number");
    expect(typeof stats.unchanged).toBe("number");

    const total = stats.added + stats.updated + stats.removed + stats.unchanged;
    expect(total).toBeGreaterThan(0);
  }, 60000);

  it("discovers nested kind directories (category/kind)", async () => {
    writeMdFile(
      ctx.config.vaultDir,
      "events",
      "sessions",
      "nested-test-01234567.md",
      {
        id: "REINDEX_NESTED_01",
        kind: "session",
        title: "Nested dir session",
        body: "Entry in nested category/kind directory structure",
        tags: ["test"],
      },
    );

    const stats = await reindex(ctx, { fullSync: true });

    const row = ctx.stmts.getEntryById.get("REINDEX_NESTED_01");
    expect(row).toBeTruthy();
    expect(row.kind).toBe("session");
    expect(row.category).toBe("event");
  }, 60000);

  it("discovers flat kind directories (legacy structure)", async () => {
    writeMdFile(ctx.config.vaultDir, "", "patterns", "flat-test-01234567.md", {
      id: "REINDEX_FLAT_01",
      kind: "pattern",
      title: "Flat dir pattern",
      body: "Entry in flat (legacy) directory structure",
      tags: ["test"],
    });

    const stats = await reindex(ctx, { fullSync: true });

    const row = ctx.stmts.getEntryById.get("REINDEX_FLAT_01");
    expect(row).toBeTruthy();
    expect(row.kind).toBe("pattern");
    expect(row.category).toBe("knowledge");
  }, 60000);

  it("skips files without frontmatter", async () => {
    const dir = join(ctx.config.vaultDir, "knowledge", "insights");
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, "no-frontmatter.md");
    writeFileSync(filePath, "# Just a heading\n\nNo frontmatter here.\n");

    await reindex(ctx, { fullSync: true });

    const rows = ctx.db
      .prepare("SELECT id FROM vault WHERE file_path = ?")
      .all(filePath);
    expect(rows).toHaveLength(0);
  }, 60000);

  it("add-only mode skips existing files", async () => {
    const existing = ctx.stmts.getEntryById.get("REINDEX_BASIC_01");
    expect(existing).toBeTruthy();

    const raw = readFileSync(existing.file_path, "utf-8");
    const modified = raw.replace(
      "Updated body for change detection test",
      "This change should be ignored in add-only mode",
    );
    writeFileSync(existing.file_path, modified);

    const stats = await reindex(ctx, { fullSync: false });

    expect(stats.updated).toBe(0);
    expect(stats.unchanged).toBeGreaterThanOrEqual(1);

    const row = ctx.stmts.getEntryById.get("REINDEX_BASIC_01");
    expect(row.body).toContain("Updated body for change detection test");

    // Restore file so future tests aren't affected
    writeFileSync(existing.file_path, raw);
  }, 60000);

  it("removes orphaned DB entries when file is deleted from disk", async () => {
    const filePath = writeMdFile(
      ctx.config.vaultDir,
      "knowledge",
      "insights",
      "orphan-test-01234567.md",
      {
        id: "REINDEX_ORPHAN_01",
        kind: "insight",
        title: null,
        body: "This entry will become orphaned",
        tags: ["test"],
      },
    );

    await reindex(ctx, { fullSync: true });
    expect(ctx.stmts.getEntryById.get("REINDEX_ORPHAN_01")).toBeTruthy();

    unlinkSync(filePath);

    const stats = await reindex(ctx, { fullSync: true });

    expect(stats.removed).toBeGreaterThanOrEqual(1);
    expect(ctx.stmts.getEntryById.get("REINDEX_ORPHAN_01")).toBeUndefined();
  }, 60000);

  it("removes entries for kinds whose directories no longer exist on disk", async () => {
    ctx.db
      .prepare(
        "INSERT INTO vault (id, user_id, kind, category, title, body, tags, source, file_path, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "REINDEX_GHOST_KIND_01",
        "ghost",
        "knowledge",
        "Ghost entry",
        "Entry for a kind directory that does not exist",
        '["test"]',
        "file",
        join(ctx.config.vaultDir, "knowledge", "ghosts", "ghost.md"),
        new Date().toISOString(),
      );

    expect(ctx.stmts.getEntryById.get("REINDEX_GHOST_KIND_01")).toBeTruthy();

    const stats = await reindex(ctx, { fullSync: true });

    expect(stats.removed).toBeGreaterThanOrEqual(1);
    expect(ctx.stmts.getEntryById.get("REINDEX_GHOST_KIND_01")).toBeUndefined();
  }, 60000);

  it("returns zeroed stats when vault directory does not exist", async () => {
    const { ctx: emptyCtx, cleanup: emptyCleanup } = await createTestCtx();

    const { rmSync } = await import("node:fs");
    rmSync(emptyCtx.config.vaultDir, { recursive: true, force: true });

    const stats = await reindex(emptyCtx);
    expect(stats).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 0 });

    emptyCleanup();
  }, 30000);
});

// ─── Expired entry pruning (isolated context) ──────────────────────────────
// Uses a separate context to avoid rowid reuse causing vec table conflicts,
// since reindex adds entries to pendingEmbeds before pruning removes them.

describe("reindex — expired entry pruning", () => {
  let ctx, cleanup;

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());
  }, 30000);

  afterAll(() => cleanup());

  it("prunes entries with past expires_at", async () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();

    writeMdFile(
      ctx.config.vaultDir,
      "knowledge",
      "insights",
      "expired-test-01234567.md",
      {
        id: "REINDEX_EXPIRED_01",
        kind: "insight",
        title: null,
        body: "This entry has expired and should be pruned",
        tags: ["test"],
        expires_at: pastDate,
      },
    );

    await reindex(ctx, { fullSync: true });

    const row = ctx.stmts.getEntryById.get("REINDEX_EXPIRED_01");
    expect(row).toBeUndefined();
  }, 60000);
});
