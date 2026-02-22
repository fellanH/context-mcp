/**
 * Index Layer — Public API
 *
 * Owns the database as a derived index. Handles both bulk sync (reindex)
 * and single-entry indexing (indexEntry) for write-through capture.
 *
 * Agent Constraint: Can import ../core. Owns db.js and embed.js.
 */

import { readFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { join, basename } from "node:path";
import { dirToKind, walkDir, ulid } from "../core/files.js";
import { categoryFor, CATEGORY_DIRS } from "../core/categories.js";
import {
  parseFrontmatter,
  parseEntryFromMarkdown,
} from "../core/frontmatter.js";
import { embedBatch } from "./embed.js";

const EXCLUDED_DIRS = new Set(["projects", "_archive"]);
const EXCLUDED_FILES = new Set(["context.md", "memory.md", "README.md"]);

const EMBED_BATCH_SIZE = 32;

/**
 * Index a single entry with idempotent upsert behavior.
 * Called immediately after Capture Layer writes the file.
 *
 * For entities with identity_key: uses upsertByIdentityKey if existing row found.
 *
 * @param {import('../server/types.js').BaseCtx & Partial<import('../server/types.js').HostedCtxExtensions>} ctx
 * @param {{ id, kind, category, title, body, meta, tags, source, filePath, createdAt, identity_key, expires_at, userId }} entry
 */
export async function indexEntry(
  ctx,
  {
    id,
    kind,
    category,
    title,
    body,
    meta,
    tags,
    source,
    filePath,
    createdAt,
    identity_key,
    expires_at,
    userId,
  },
) {
  // Don't index entries that have already expired
  if (expires_at && new Date(expires_at) <= new Date()) {
    return;
  }

  const tagsJson = tags ? JSON.stringify(tags) : null;
  const metaJson = meta ? JSON.stringify(meta) : null;
  const cat = category || categoryFor(kind);
  const userIdVal = userId || null;

  let wasUpdate = false;

  // Entity upsert: check by (kind, identity_key, user_id) first
  if (cat === "entity" && identity_key) {
    const existing = ctx.stmts.getByIdentityKey.get(
      kind,
      identity_key,
      userIdVal,
    );
    if (existing) {
      ctx.stmts.upsertByIdentityKey.run(
        title || null,
        body,
        metaJson,
        tagsJson,
        source || "claude-code",
        cat,
        filePath,
        expires_at || null,
        kind,
        identity_key,
        userIdVal,
      );
      wasUpdate = true;
    }
  }

  if (!wasUpdate) {
    // Prepare encryption if ctx.encrypt is available
    let encrypted = null;
    if (ctx.encrypt) {
      encrypted = await ctx.encrypt({ title, body, meta });
    }

    try {
      if (encrypted) {
        // Encrypted insert: store preview in body column for FTS, full content in encrypted columns
        const bodyPreview = body.slice(0, 200);
        ctx.stmts.insertEntryEncrypted.run(
          id,
          userIdVal,
          kind,
          cat,
          title || null,
          bodyPreview,
          metaJson,
          tagsJson,
          source || "claude-code",
          filePath,
          identity_key || null,
          expires_at || null,
          createdAt,
          createdAt,
          encrypted.body_encrypted,
          encrypted.title_encrypted,
          encrypted.meta_encrypted,
          encrypted.iv,
        );
      } else {
        ctx.stmts.insertEntry.run(
          id,
          userIdVal,
          kind,
          cat,
          title || null,
          body,
          metaJson,
          tagsJson,
          source || "claude-code",
          filePath,
          identity_key || null,
          expires_at || null,
          createdAt,
          createdAt,
        );
      }
    } catch (e) {
      if (e.message.includes("UNIQUE constraint")) {
        ctx.stmts.updateEntry.run(
          title || null,
          body,
          metaJson,
          tagsJson,
          source || "claude-code",
          cat,
          identity_key || null,
          expires_at || null,
          filePath,
        );
        wasUpdate = true;
      } else {
        throw e;
      }
    }
  }

  // After update, get rowid by file_path (since id might differ); otherwise by id
  const rowidResult = wasUpdate
    ? ctx.stmts.getRowidByPath.get(filePath)
    : ctx.stmts.getRowid.get(id);

  if (!rowidResult || rowidResult.rowid == null) {
    throw new Error(
      `Could not find rowid for entry: ${wasUpdate ? `file_path=${filePath}` : `id=${id}`}`,
    );
  }

  const rowid = Number(rowidResult.rowid);
  if (!Number.isFinite(rowid) || rowid < 1) {
    throw new Error(
      `Invalid rowid retrieved: ${rowidResult.rowid} (type: ${typeof rowidResult.rowid})`,
    );
  }

  // Embeddings are always generated from plaintext (before encryption)
  const embeddingText = [title, body].filter(Boolean).join(" ");
  const embedding = await ctx.embed(embeddingText);

  // Upsert vec: delete old if exists, then insert new (skip if embedding unavailable)
  if (embedding) {
    try {
      ctx.deleteVec(rowid);
    } catch {
      /* no-op if not found */
    }
    ctx.insertVec(rowid, embedding);
  }
}

/**
 * Prune expired entries: delete files, vec rows, and DB rows for all entries
 * where expires_at <= now(). Safe to call on startup or CLI — non-destructive
 * to active data.
 *
 * @param {import('../server/types.js').BaseCtx} ctx
 * @returns {Promise<number>} count of pruned entries
 */
export async function pruneExpired(ctx) {
  const expired = ctx.db
    .prepare(
      "SELECT id, file_path FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
    )
    .all();

  for (const row of expired) {
    if (row.file_path) {
      try {
        unlinkSync(row.file_path);
      } catch {}
    }
    const vRowid = ctx.stmts.getRowid.get(row.id)?.rowid;
    if (vRowid) {
      try {
        ctx.deleteVec(Number(vRowid));
      } catch {}
    }
    ctx.stmts.deleteEntry.run(row.id);
  }

  return expired.length;
}

/**
 * Bulk reindex: sync vault directory into the database.
 * P2: Wrapped in a transaction for atomicity.
 * P3: Detects title/tag/meta changes, not just body.
 * P4: Batches embedding calls for performance.
 *
 * @param {import('../server/types.js').BaseCtx} ctx
 * @param {{ fullSync?: boolean }} opts — fullSync=true adds/updates/deletes; false=add-only
 * @returns {Promise<{added: number, updated: number, removed: number, unchanged: number}>}
 */
export async function reindex(ctx, opts = {}) {
  const { fullSync = true } = opts;
  const stats = { added: 0, updated: 0, removed: 0, unchanged: 0 };

  if (!existsSync(ctx.config.vaultDir)) return stats;

  // Use INSERT OR IGNORE for reindex — handles files with duplicate frontmatter IDs
  // user_id is NULL for reindex (always local mode)
  const upsertEntry = ctx.db.prepare(
    `INSERT OR IGNORE INTO vault (id, user_id, kind, category, title, body, meta, tags, source, file_path, identity_key, expires_at, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Auto-discover kind directories, supporting both:
  //   - Nested: knowledge/insights/, events/sessions/ (category dirs at top level)
  //   - Flat:   insights/, decisions/ (legacy — kind dirs at top level)
  const kindEntries = []; // { kind, dir }
  const topDirs = readdirSync(ctx.config.vaultDir, {
    withFileTypes: true,
  }).filter(
    (d) =>
      d.isDirectory() && !EXCLUDED_DIRS.has(d.name) && !d.name.startsWith("_"),
  );

  for (const d of topDirs) {
    if (CATEGORY_DIRS.has(d.name)) {
      // Category directory — look one level deeper for kind directories
      const catDir = join(ctx.config.vaultDir, d.name);
      const subDirs = readdirSync(catDir, { withFileTypes: true }).filter(
        (sd) => sd.isDirectory() && !sd.name.startsWith("_"),
      );
      for (const sd of subDirs) {
        kindEntries.push({
          kind: dirToKind(sd.name),
          dir: join(catDir, sd.name),
        });
      }
    } else {
      // Legacy flat structure — top-level dir is a kind dir
      kindEntries.push({
        kind: dirToKind(d.name),
        dir: join(ctx.config.vaultDir, d.name),
      });
    }
  }

  // Phase 1: Sync DB ops in a transaction — FTS is searchable immediately after COMMIT.
  // Phase 2: Async embedding runs post-transaction so it can't hold the write lock
  //          or roll back DB state on failure.
  const pendingEmbeds = []; // { rowid, text, isUpdate }

  ctx.db.exec("BEGIN");
  try {
    for (const { kind, dir } of kindEntries) {
      const category = categoryFor(kind);
      const mdFiles = walkDir(dir).filter(
        (f) => !EXCLUDED_FILES.has(basename(f.filePath)),
      );

      // P3: Fetch all mutable fields for change detection
      const dbRows = ctx.db
        .prepare(
          "SELECT id, file_path, body, title, tags, meta FROM vault WHERE kind = ?",
        )
        .all(kind);
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

        // Extract identity_key and expires_at from frontmatter
        const identity_key = fmMeta.identity_key || null;
        const expires_at = fmMeta.expires_at || null;

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

          const result = upsertEntry.run(
            id,
            kind,
            category,
            parsed.title || null,
            parsed.body,
            metaJson,
            tagsJson,
            fmMeta.source || "file",
            filePath,
            identity_key,
            expires_at,
            created,
            fmMeta.updated || created,
          );
          if (result.changes > 0) {
            const rowidResult = ctx.stmts.getRowid.get(id);
            if (rowidResult?.rowid) {
              const embeddingText = [parsed.title, parsed.body]
                .filter(Boolean)
                .join(" ");
              pendingEmbeds.push({
                rowid: rowidResult.rowid,
                text: embeddingText,
              });
            }
            stats.added++;
          } else {
            stats.unchanged++;
          }
        } else if (fullSync) {
          // P3: Compare all mutable fields, not just body
          const tagsJson = fmMeta.tags ? JSON.stringify(fmMeta.tags) : null;
          const titleChanged =
            (parsed.title || null) !== (existing.title || null);
          const bodyChanged = existing.body !== parsed.body;
          const tagsChanged = tagsJson !== (existing.tags || null);
          const metaChanged = metaJson !== (existing.meta || null);

          if (bodyChanged || titleChanged || tagsChanged || metaChanged) {
            ctx.stmts.updateEntry.run(
              parsed.title || null,
              parsed.body,
              metaJson,
              tagsJson,
              fmMeta.source || "file",
              category,
              identity_key,
              expires_at,
              filePath,
            );

            // Queue re-embed if title or body changed (vector ops deferred to Phase 2)
            if (bodyChanged || titleChanged) {
              const rowid = ctx.stmts.getRowid.get(existing.id)?.rowid;
              if (rowid) {
                const embeddingText = [parsed.title, parsed.body]
                  .filter(Boolean)
                  .join(" ");
                pendingEmbeds.push({
                  rowid,
                  text: embeddingText,
                  isUpdate: true,
                });
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
            if (vRowid) {
              try {
                ctx.deleteVec(vRowid);
              } catch {}
            }
            ctx.stmts.deleteEntry.run(row.id);
            stats.removed++;
          }
        }
      }
    }

    // Clean up entries for kinds whose directories no longer exist on disk
    if (fullSync) {
      const indexedKinds = new Set(kindEntries.map((ke) => ke.kind));
      const allDbKinds = ctx.db
        .prepare("SELECT DISTINCT kind FROM vault")
        .all();
      for (const { kind } of allDbKinds) {
        if (!indexedKinds.has(kind)) {
          const orphaned = ctx.db
            .prepare("SELECT id, rowid FROM vault WHERE kind = ?")
            .all(kind);
          for (const row of orphaned) {
            try {
              ctx.deleteVec(row.rowid);
            } catch {}
            ctx.stmts.deleteEntry.run(row.id);
            stats.removed++;
          }
        }
      }
    }

    // Prune expired entries
    const expired = ctx.db
      .prepare(
        "SELECT id, file_path FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')",
      )
      .all();

    for (const row of expired) {
      if (row.file_path) {
        try {
          unlinkSync(row.file_path);
        } catch {}
      }
      const vRowid = ctx.stmts.getRowid.get(row.id)?.rowid;
      if (vRowid) {
        try {
          ctx.deleteVec(vRowid);
        } catch {}
      }
      ctx.stmts.deleteEntry.run(row.id);
      stats.removed++;
    }

    ctx.db.exec("COMMIT");
  } catch (e) {
    ctx.db.exec("ROLLBACK");
    throw e;
  }

  // Phase 2: Async embedding — runs after COMMIT so FTS is already searchable.
  // Failures here are non-fatal; semantic search catches up on next reindex.
  // Vec delete happens atomically with insert (only on success) to avoid
  // leaving entries permanently without vectors if embedBatch() fails mid-batch.
  for (let i = 0; i < pendingEmbeds.length; i += EMBED_BATCH_SIZE) {
    const batch = pendingEmbeds.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((e) => e.text));
    for (let j = 0; j < batch.length; j++) {
      if (embeddings[j]) {
        try {
          ctx.deleteVec(batch[j].rowid);
        } catch {}
        ctx.insertVec(batch[j].rowid, embeddings[j]);
      }
    }
  }

  return stats;
}
