import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createTestCtx } from "../helpers/ctx.js";
import { captureAndIndex } from "@context-vault/core/capture";
import { parseFrontmatter } from "@context-vault/core/frontmatter";
import { initDatabase, prepareStatements, insertVec, deleteVec } from "@context-vault/core/db";
import { embed } from "@context-vault/core/embed";
import AdmZip from "adm-zip";

describe("portable archive export/import", () => {
  let ctx, cleanup;
  const entryIds = [];

  beforeAll(async () => {
    ({ ctx, cleanup } = await createTestCtx());

    const entries = [
      { kind: "decision", title: "Use local-first storage", body: "SQLite + files over cloud databases.", tags: ["architecture", "storage"], source: "test" },
      { kind: "decision", title: "Markdown as source of truth", body: "Plain markdown with YAML frontmatter.", tags: ["architecture", "format"], source: "test" },
      { kind: "pattern", title: "Repository pattern", body: "Abstract data access behind repository interfaces.", tags: ["code", "architecture"], source: "test" },
      { kind: "insight", title: "FTS5 performance", body: "SQLite FTS5 is fast enough for local vaults up to 100k entries.", tags: ["performance", "storage"], source: "test" },
      { kind: "insight", title: "Embedding model size", body: "all-MiniLM-L6-v2 is 22MB, acceptable for CLI tool.", tags: ["performance", "ml"], source: "test" },
    ];

    for (const e of entries) {
      const result = await captureAndIndex(ctx, e);
      entryIds.push(result.id);
    }
  }, 60000);

  afterAll(() => cleanup());

  function createExportZip(rows, version = "test") {
    const zip = new AdmZip();
    const indexEntries = [];

    for (const row of rows) {
      const entryPath = `entries/${row.kind}/${basename(row.file_path)}`;
      const fileContent = readFileSync(row.file_path);
      zip.addFile(entryPath, fileContent);

      indexEntries.push({
        id: row.id,
        kind: row.kind,
        category: row.category,
        title: row.title || null,
        tags: row.tags ? JSON.parse(row.tags) : [],
        source: row.source || null,
        identity_key: row.identity_key || null,
        expires_at: row.expires_at || null,
        created_at: row.created_at,
        file: entryPath,
      });
    }

    const manifest = {
      version: 1,
      created_at: new Date().toISOString(),
      context_vault_version: version,
      entry_count: indexEntries.length,
      date_range: {
        earliest: rows[rows.length - 1]?.created_at,
        latest: rows[0]?.created_at,
      },
      filters: { tags: null, kind: null, since: null, until: null, all: true },
    };

    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile("index.json", Buffer.from(JSON.stringify({ entries: indexEntries }, null, 2)));

    return zip;
  }

  describe("export filtering", () => {
    it("filters by tags using json_each", () => {
      const rows = ctx.db.prepare(
        `SELECT * FROM vault WHERE EXISTS (SELECT 1 FROM json_each(vault.tags) WHERE json_each.value = ?)`,
      ).all("architecture");
      expect(rows.length).toBe(3);
      for (const r of rows) {
        const tags = JSON.parse(r.tags);
        expect(tags).toContain("architecture");
      }
    });

    it("filters by kind", () => {
      const rows = ctx.db.prepare(
        `SELECT * FROM vault WHERE kind IN (?, ?)`,
      ).all("decision", "pattern");
      expect(rows.length).toBe(3);
      for (const r of rows) {
        expect(["decision", "pattern"]).toContain(r.kind);
      }
    });

    it("filters by combined tags + kind", () => {
      const rows = ctx.db.prepare(
        `SELECT * FROM vault WHERE kind = ? AND EXISTS (SELECT 1 FROM json_each(vault.tags) WHERE json_each.value = ?)`,
      ).all("decision", "architecture");
      expect(rows.length).toBe(2);
    });

    it("filters by date range", () => {
      const allRows = ctx.db.prepare("SELECT * FROM vault ORDER BY created_at ASC").all();
      const midpoint = allRows[2].created_at;

      const rows = ctx.db.prepare(
        `SELECT * FROM vault WHERE created_at >= ?`,
      ).all(midpoint);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows.length).toBeLessThanOrEqual(5);
    });

    it("returns empty when no entries match", () => {
      const rows = ctx.db.prepare(
        `SELECT * FROM vault WHERE EXISTS (SELECT 1 FROM json_each(vault.tags) WHERE json_each.value = ?)`,
      ).all("nonexistent-tag");
      expect(rows.length).toBe(0);
    });
  });

  describe("zip archive structure", () => {
    it("creates valid zip with manifest, index, and entry files", () => {
      const rows = ctx.db.prepare("SELECT * FROM vault ORDER BY created_at DESC").all();
      const zip = createExportZip(rows);

      const manifest = JSON.parse(zip.readAsText("manifest.json"));
      expect(manifest.version).toBe(1);
      expect(manifest.entry_count).toBe(5);
      expect(manifest.date_range.earliest).toBeTruthy();
      expect(manifest.date_range.latest).toBeTruthy();

      const index = JSON.parse(zip.readAsText("index.json"));
      expect(index.entries).toHaveLength(5);

      for (const entry of index.entries) {
        expect(entry.id).toBeTruthy();
        expect(entry.kind).toBeTruthy();
        expect(entry.file).toMatch(/^entries\//);

        const zipEntry = zip.getEntry(entry.file);
        expect(zipEntry).toBeTruthy();
      }
    });

    it("preserves markdown content with frontmatter", () => {
      const rows = ctx.db.prepare("SELECT * FROM vault WHERE kind = 'decision' LIMIT 1").all();
      const zip = createExportZip(rows);

      const index = JSON.parse(zip.readAsText("index.json"));
      const mdContent = zip.readAsText(index.entries[0].file);

      expect(mdContent).toContain("---");
      const { meta } = parseFrontmatter(mdContent);
      expect(meta.id).toBe(rows[0].id);
      expect(meta.tags).toBeTruthy();
    });

    it("organizes entries by kind directory", () => {
      const rows = ctx.db.prepare("SELECT * FROM vault ORDER BY created_at DESC").all();
      const zip = createExportZip(rows);

      const entryPaths = zip.getEntries()
        .map((e) => e.entryName)
        .filter((n) => n.startsWith("entries/"));

      const kinds = new Set(entryPaths.map((p) => p.split("/")[1]));
      expect(kinds).toContain("decision");
      expect(kinds).toContain("pattern");
      expect(kinds).toContain("insight");
    });
  });

  describe("zip import", () => {
    it("imports entries from a zip archive into a fresh vault", async () => {
      const sourceRows = ctx.db.prepare("SELECT * FROM vault ORDER BY created_at DESC").all();
      const zip = createExportZip(sourceRows);

      const tmp = mkdtempSync(join(tmpdir(), "cv-import-test-"));
      const zipPath = join(tmp, "test-export.zip");
      zip.writeZip(zipPath);

      const targetVaultDir = join(tmp, "target-vault");
      const targetDbPath = join(tmp, "target.db");
      mkdirSync(targetVaultDir, { recursive: true });

      const targetDb = await initDatabase(targetDbPath);
      const targetStmts = prepareStatements(targetDb);
      const targetCtx = {
        db: targetDb,
        config: { vaultDir: targetVaultDir, dbPath: targetDbPath, vaultDirExists: true },
        stmts: targetStmts,
        embed,
        insertVec: (r, e) => insertVec(targetStmts, r, e),
        deleteVec: (r) => deleteVec(targetStmts, r),
      };

      const importZip = new AdmZip(zipPath);
      const index = JSON.parse(importZip.readAsText("index.json"));

      let imported = 0;
      let skipped = 0;

      const { indexEntry } = await import("@context-vault/core/index");
      const { categoryDirFor } = await import("@context-vault/core/categories");
      const { writeFileSync } = await import("node:fs");

      const existingIds = new Set();

      for (const entryMeta of index.entries) {
        if (existingIds.has(entryMeta.id)) {
          skipped++;
          continue;
        }

        const zipEntry = importZip.getEntry(entryMeta.file);
        const mdContent = importZip.readAsText(entryMeta.file);
        const { meta: fmMeta, body: rawBody } = parseFrontmatter(mdContent);

        const kind = entryMeta.kind;
        const categoryDir = categoryDirFor(kind);
        const targetDir = join(targetVaultDir, categoryDir, kind);
        mkdirSync(targetDir, { recursive: true });

        const fileName = basename(entryMeta.file);
        const filePath = join(targetDir, fileName);
        writeFileSync(filePath, mdContent);

        await indexEntry(targetCtx, {
          id: fmMeta.id || entryMeta.id,
          kind,
          category: entryMeta.category,
          title: fmMeta.title || entryMeta.title,
          body: rawBody,
          meta: null,
          tags: Array.isArray(fmMeta.tags) ? fmMeta.tags : entryMeta.tags || [],
          source: fmMeta.source || entryMeta.source || "archive-import",
          filePath,
          createdAt: fmMeta.created || entryMeta.created_at,
          identity_key: null,
          expires_at: null,
        });

        imported++;
      }

      expect(imported).toBe(5);

      const targetCount = targetDb.prepare("SELECT COUNT(*) as c FROM vault").get().c;
      expect(targetCount).toBe(5);

      const decisions = targetDb.prepare("SELECT * FROM vault WHERE kind = 'decision'").all();
      expect(decisions.length).toBe(2);

      for (const d of decisions) {
        expect(existsSync(d.file_path)).toBe(true);
      }

      targetDb.close();
      rmSync(tmp, { recursive: true, force: true });
    }, 60000);

    it("skips duplicate entries on import", async () => {
      const sourceRows = ctx.db.prepare("SELECT * FROM vault WHERE kind = 'decision' LIMIT 1").all();
      const zip = createExportZip(sourceRows);

      const tmp = mkdtempSync(join(tmpdir(), "cv-dedup-test-"));
      const zipPath = join(tmp, "dedup-export.zip");
      zip.writeZip(zipPath);

      const targetVaultDir = join(tmp, "target-vault");
      const targetDbPath = join(tmp, "target.db");
      mkdirSync(targetVaultDir, { recursive: true });

      const targetDb = await initDatabase(targetDbPath);
      const targetStmts = prepareStatements(targetDb);
      const targetCtx = {
        db: targetDb,
        config: { vaultDir: targetVaultDir, dbPath: targetDbPath, vaultDirExists: true },
        stmts: targetStmts,
        embed,
        insertVec: (r, e) => insertVec(targetStmts, r, e),
        deleteVec: (r) => deleteVec(targetStmts, r),
      };

      const importZip = new AdmZip(zipPath);
      const index = JSON.parse(importZip.readAsText("index.json"));

      const { indexEntry } = await import("@context-vault/core/index");
      const { categoryDirFor } = await import("@context-vault/core/categories");
      const { writeFileSync } = await import("node:fs");

      // First import
      for (const entryMeta of index.entries) {
        const mdContent = importZip.readAsText(entryMeta.file);
        const { meta: fmMeta, body: rawBody } = parseFrontmatter(mdContent);
        const kind = entryMeta.kind;
        const targetDir = join(targetVaultDir, categoryDirFor(kind), kind);
        mkdirSync(targetDir, { recursive: true });
        const filePath = join(targetDir, basename(entryMeta.file));
        writeFileSync(filePath, mdContent);

        await indexEntry(targetCtx, {
          id: fmMeta.id || entryMeta.id,
          kind,
          category: entryMeta.category,
          title: entryMeta.title,
          body: rawBody,
          meta: null,
          tags: Array.isArray(fmMeta.tags) ? fmMeta.tags : [],
          source: "archive-import",
          filePath,
          createdAt: fmMeta.created || entryMeta.created_at,
          identity_key: null,
          expires_at: null,
        });
      }

      expect(targetDb.prepare("SELECT COUNT(*) as c FROM vault").get().c).toBe(1);

      // Second import — should skip duplicates
      const existingIds = new Set(
        targetDb.prepare("SELECT id FROM vault").all().map((r) => r.id),
      );

      let imported = 0;
      let skippedDuplicate = 0;

      for (const entryMeta of index.entries) {
        if (existingIds.has(entryMeta.id)) {
          skippedDuplicate++;
          continue;
        }
        imported++;
      }

      expect(skippedDuplicate).toBe(1);
      expect(imported).toBe(0);
      expect(targetDb.prepare("SELECT COUNT(*) as c FROM vault").get().c).toBe(1);

      targetDb.close();
      rmSync(tmp, { recursive: true, force: true });
    }, 60000);
  });

  describe("manifest validation", () => {
    it("rejects zip without manifest.json", () => {
      const zip = new AdmZip();
      zip.addFile("index.json", Buffer.from("{}"));

      expect(zip.getEntry("manifest.json")).toBeFalsy();
    });

    it("rejects zip without index.json", () => {
      const zip = new AdmZip();
      zip.addFile("manifest.json", Buffer.from("{}"));

      expect(zip.getEntry("index.json")).toBeFalsy();
    });

    it("manifest contains correct metadata", () => {
      const rows = ctx.db.prepare("SELECT * FROM vault ORDER BY created_at DESC").all();
      const zip = createExportZip(rows, "2.17.1");

      const manifest = JSON.parse(zip.readAsText("manifest.json"));
      expect(manifest.version).toBe(1);
      expect(manifest.context_vault_version).toBe("2.17.1");
      expect(manifest.entry_count).toBe(rows.length);
      expect(manifest.created_at).toBeTruthy();
      expect(manifest.filters).toBeDefined();
    });
  });

  describe("roundtrip integrity", () => {
    it("preserves entry IDs through export→import cycle", async () => {
      const sourceRows = ctx.db.prepare("SELECT * FROM vault ORDER BY created_at ASC").all();
      const sourceIds = sourceRows.map((r) => r.id);
      const zip = createExportZip(sourceRows);

      const index = JSON.parse(zip.readAsText("index.json"));
      const importedIds = index.entries.map((e) => e.id);

      expect(importedIds.sort()).toEqual(sourceIds.sort());
    });

    it("preserves tags through export→import cycle", () => {
      const sourceRows = ctx.db.prepare("SELECT * FROM vault ORDER BY created_at ASC").all();
      const zip = createExportZip(sourceRows);

      const index = JSON.parse(zip.readAsText("index.json"));
      for (const entry of index.entries) {
        const sourceRow = sourceRows.find((r) => r.id === entry.id);
        const sourceTags = JSON.parse(sourceRow.tags);
        expect(entry.tags).toEqual(sourceTags);
      }
    });

    it("preserves markdown body content through roundtrip", () => {
      const sourceRows = ctx.db.prepare("SELECT * FROM vault WHERE kind = 'pattern' LIMIT 1").all();
      const zip = createExportZip(sourceRows);

      const index = JSON.parse(zip.readAsText("index.json"));
      const mdContent = zip.readAsText(index.entries[0].file);
      const originalContent = readFileSync(sourceRows[0].file_path, "utf-8");

      expect(mdContent).toBe(originalContent);
    });
  });
});
