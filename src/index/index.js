/**
 * Index Layer — Public API
 *
 * Owns the database as a derived index. Handles both bulk sync (reindex)
 * and single-entry indexing (indexEntry) for write-through capture.
 *
 * Agent Constraint: Can import ../core. Owns db.js and embed.js.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { dirToKind, walkDir, ulid } from "../core/files.js";
import { parseFrontmatter, parseEntryFromMarkdown } from "../core/frontmatter.js";
import { embedBatch } from "./embed.js";

const EXCLUDED_DIRS = new Set(["projects", "_archive"]);
const EXCLUDED_FILES = new Set(["context.md", "memory.md", "README.md"]);

const EMBED_BATCH_SIZE = 32;

/**
 * P7: Index a single entry with idempotent upsert behavior.
 * Called immediately after Capture Layer writes the file.
 *
 * @param {{ db, stmts, embed, insertVec, deleteVec }} ctx
 * @param {{ id, kind, title, body, meta, tags, source, filePath, createdAt }} entry
 */
export async function indexEntry(ctx, { id, kind, title, body, meta, tags, source, filePath, createdAt }) {
  const tagsJson = tags ? JSON.stringify(tags) : null;
  const metaJson = meta ? JSON.stringify(meta) : null;

  try {
    ctx.stmts.insertEntry.run(id, kind, title || null, body, metaJson, tagsJson, source || "claude-code", filePath, createdAt);
  } catch (e) {
    if (e.message.includes("UNIQUE constraint")) {
      ctx.stmts.updateEntry.run(title || null, body, metaJson, tagsJson, source || "claude-code", filePath);
    } else {
      throw e;
    }
  }

  const rowid = ctx.stmts.getRowid.get(id).rowid;
  const embeddingText = [title, body].filter(Boolean).join(" ");
  const embedding = await ctx.embed(embeddingText);

  // Upsert vec: delete old if exists, then insert new
  try { ctx.deleteVec(rowid); } catch { /* no-op if not found */ }
  ctx.insertVec(rowid, embedding);
}

/**
 * Bulk reindex: sync vault directory into the database.
 * P2: Wrapped in a transaction for atomicity.
 * P3: Detects title/tag/meta changes, not just body.
 * P4: Batches embedding calls for performance.
 *
 * @param {{ db, config, stmts, embed, insertVec, deleteVec }} ctx
 * @param {{ fullSync?: boolean }} opts — fullSync=true adds/updates/deletes; false=add-only
 * @returns {Promise<{added: number, updated: number, removed: number, unchanged: number}>}
 */
export async function reindex(ctx, opts = {}) {
  const { fullSync = true } = opts;
  const stats = { added: 0, updated: 0, removed: 0, unchanged: 0 };

  if (!existsSync(ctx.config.vaultDir)) return stats;

  // Use INSERT OR IGNORE for reindex — handles files with duplicate frontmatter IDs
  const upsertEntry = ctx.db.prepare(
    `INSERT OR IGNORE INTO vault (id, kind, title, body, meta, tags, source, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  // Auto-discover subdirs (skip excluded directories)
  const subdirs = readdirSync(ctx.config.vaultDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !EXCLUDED_DIRS.has(d.name) && !d.name.startsWith("_"))
    .map((d) => d.name);

  // P2: Wrap entire reindex in a transaction
  ctx.db.exec("BEGIN");
  try {
    // P4: Collect entries needing embedding, then batch-embed
    const pendingEmbeds = []; // { rowid, text }

    for (const dirName of subdirs) {
      const kind = dirToKind(dirName);
      const dir = join(ctx.config.vaultDir, dirName);
      const mdFiles = walkDir(dir).filter((f) => !EXCLUDED_FILES.has(basename(f.filePath)));

      // P3: Fetch all mutable fields for change detection
      const dbRows = ctx.db.prepare("SELECT id, file_path, body, title, tags, meta FROM vault WHERE kind = ?").all(kind);
      const dbByPath = new Map(dbRows.map((r) => [r.file_path, r]));
      const diskPaths = new Set(mdFiles.map((e) => e.filePath));

      for (const { filePath, relDir } of mdFiles) {
        const existing = dbByPath.get(filePath);

        // In add-only mode, skip files already in DB
        if (!fullSync && existing) {
          stats.unchanged++;
          continue;
        }

        const raw = readFileSync(filePath, "utf-8");
        if (!raw.startsWith("---\n")) {
          console.error(`[reindex] skipping (no frontmatter): ${filePath}`);
          continue;
        }
        const { meta: fmMeta, body: rawBody } = parseFrontmatter(raw);
        const parsed = parseEntryFromMarkdown(kind, rawBody, fmMeta);

        // Derive folder from disk location (source of truth)
        const meta = { ...(parsed.meta || {}) };
        if (relDir) meta.folder = relDir;
        else delete meta.folder;
        const metaJson = Object.keys(meta).length ? JSON.stringify(meta) : null;

        if (!existing) {
          // New file — add to DB (OR IGNORE if ID already exists at another path)
          const id = fmMeta.id || ulid();
          const tagsJson = fmMeta.tags ? JSON.stringify(fmMeta.tags) : null;
          const created = fmMeta.created || new Date().toISOString();

          const result = upsertEntry.run(id, kind, parsed.title || null, parsed.body, metaJson, tagsJson, fmMeta.source || "file", filePath, created);
          if (result.changes > 0) {
            const rowid = ctx.stmts.getRowid.get(id).rowid;
            const embeddingText = [parsed.title, parsed.body].filter(Boolean).join(" ");
            pendingEmbeds.push({ rowid, text: embeddingText });
            stats.added++;
          } else {
            stats.unchanged++;
          }
        } else if (fullSync) {
          // P3: Compare all mutable fields, not just body
          const tagsJson = fmMeta.tags ? JSON.stringify(fmMeta.tags) : null;
          const titleChanged = (parsed.title || null) !== (existing.title || null);
          const bodyChanged = existing.body !== parsed.body;
          const tagsChanged = tagsJson !== (existing.tags || null);
          const metaChanged = metaJson !== (existing.meta || null);

          if (bodyChanged || titleChanged || tagsChanged || metaChanged) {
            ctx.stmts.updateEntry.run(parsed.title || null, parsed.body, metaJson, tagsJson, fmMeta.source || "file", filePath);

            // P0: Re-embed if title or body changed
            if (bodyChanged || titleChanged) {
              const rowid = ctx.stmts.getRowid.get(existing.id)?.rowid;
              if (rowid) {
                ctx.deleteVec(rowid);
                const embeddingText = [parsed.title, parsed.body].filter(Boolean).join(" ");
                pendingEmbeds.push({ rowid, text: embeddingText });
              }
            }
            stats.updated++;
          } else {
            stats.unchanged++;
          }
        } else {
          stats.unchanged++;
        }
      }

      // Find deleted files (in DB but not on disk) — only in fullSync mode
      if (fullSync) {
        for (const [dbPath, row] of dbByPath) {
          if (!diskPaths.has(dbPath)) {
            const vRowid = ctx.stmts.getRowid.get(row.id)?.rowid;
            if (vRowid) ctx.deleteVec(vRowid);
            ctx.stmts.deleteEntry.run(row.id);
            stats.removed++;
          }
        }
      }
    }

    // P4: Batch embed all pending texts
    for (let i = 0; i < pendingEmbeds.length; i += EMBED_BATCH_SIZE) {
      const batch = pendingEmbeds.slice(i, i + EMBED_BATCH_SIZE);
      const embeddings = await embedBatch(batch.map((e) => e.text));
      for (let j = 0; j < batch.length; j++) {
        ctx.insertVec(batch[j].rowid, embeddings[j]);
      }
    }

    ctx.db.exec("COMMIT");
  } catch (e) {
    ctx.db.exec("ROLLBACK");
    throw e;
  }

  return stats;
}
