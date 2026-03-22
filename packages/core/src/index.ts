import { readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { dirToKind, walkDir, ulid } from './files.js';
import { categoryFor, defaultTierFor, CATEGORY_DIRS } from './categories.js';
import { parseFrontmatter, parseEntryFromMarkdown } from './frontmatter.js';
import { embedBatch } from './embed.js';
import type { BaseCtx, IndexEntryInput, IndexingConfig, ReindexStats } from './types.js';
import { shouldIndex } from './indexing.js';
import { DEFAULT_INDEXING } from './constants.js';

const EXCLUDED_DIRS = new Set(['projects', '_archive']);
const EXCLUDED_FILES = new Set(['context.md', 'memory.md', 'README.md']);
const EMBED_BATCH_SIZE = 32;

export async function indexEntry(
  ctx: BaseCtx,
  entry: IndexEntryInput & {
    supersedes?: string[] | null;
    related_to?: string[] | null;
  },
  precomputedEmbedding?: Float32Array | null
): Promise<void> {
  const {
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
    source_files,
    tier,
    indexed = true,
  } = entry;

  if (expires_at && new Date(expires_at) <= new Date()) return;

  const tagsJson = tags ? JSON.stringify(tags) : null;
  const metaJson = meta ? JSON.stringify(meta) : null;
  const sourceFilesJson = source_files ? JSON.stringify(source_files) : null;
  const cat = category || categoryFor(kind);
  const effectiveTier = tier || defaultTierFor(kind);

  let wasUpdate = false;

  if (cat === 'entity' && identity_key) {
    const existing = ctx.stmts.getByIdentityKey.get(kind, identity_key) as
      | Record<string, unknown>
      | undefined;
    if (existing) {
      ctx.stmts.upsertByIdentityKey.run(
        title || null,
        body,
        metaJson,
        tagsJson,
        source || 'claude-code',
        cat,
        filePath,
        expires_at || null,
        sourceFilesJson,
        kind,
        identity_key
      );
      wasUpdate = true;
    }
  }

  if (!wasUpdate) {
    try {
      ctx.stmts.insertEntry.run(
        id,
        kind,
        cat,
        title || null,
        body,
        metaJson,
        tagsJson,
        source || 'claude-code',
        filePath,
        identity_key || null,
        expires_at || null,
        createdAt,
        createdAt,
        sourceFilesJson,
        effectiveTier,
        indexed ? 1 : 0
      );
    } catch (e) {
      if ((e as Error).message.includes('UNIQUE constraint')) {
        ctx.stmts.updateEntry.run(
          title || null,
          body,
          metaJson,
          tagsJson,
          source || 'claude-code',
          cat,
          identity_key || null,
          expires_at || null,
          filePath
        );
        if (sourceFilesJson !== null && ctx.stmts.updateSourceFiles) {
          const entryRow = ctx.stmts.getRowidByPath.get(filePath) as { rowid: number } | undefined;
          if (entryRow) {
            const idRow = ctx.db
              .prepare('SELECT id FROM vault WHERE file_path = ?')
              .get(filePath) as { id: string } | undefined;
            if (idRow) ctx.stmts.updateSourceFiles.run(sourceFilesJson, idRow.id);
          }
        }
        wasUpdate = true;
      } else {
        throw e;
      }
    }
  }

  const rowidResult = wasUpdate
    ? (ctx.stmts.getRowidByPath.get(filePath) as { rowid: number } | undefined)
    : (ctx.stmts.getRowid.get(id) as { rowid: number } | undefined);

  if (!rowidResult || rowidResult.rowid == null) {
    throw new Error(
      `Could not find rowid for entry: ${wasUpdate ? `file_path=${filePath}` : `id=${id}`}`
    );
  }

  const rowid = Number(rowidResult.rowid);
  if (!Number.isFinite(rowid) || rowid < 1) {
    throw new Error(
      `Invalid rowid retrieved: ${rowidResult.rowid} (type: ${typeof rowidResult.rowid})`
    );
  }

  if (indexed && cat !== 'event') {
    let embedding: Float32Array | null = null;
    if (precomputedEmbedding !== undefined) {
      embedding = precomputedEmbedding;
    } else {
      try {
        embedding = await ctx.embed([title, body].filter(Boolean).join(' '));
      } catch (embedErr) {
        console.warn(
          `[context-vault] embed() failed for entry ${id} — skipping vec insert: ${(embedErr as Error).message}`
        );
      }
    }

    if (embedding) {
      try {
        ctx.deleteVec(rowid);
      } catch {
        /* no-op */
      }
      ctx.insertVec(rowid, embedding);
    }
  }
}

export async function pruneExpired(ctx: BaseCtx): Promise<number> {
  const expired = ctx.db
    .prepare(
      "SELECT id, file_path FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')"
    )
    .all() as { id: string; file_path: string | null }[];

  for (const row of expired) {
    if (row.file_path) {
      try {
        unlinkSync(row.file_path);
      } catch {}
    }
    const vRowid = (ctx.stmts.getRowid.get(row.id) as { rowid: number } | undefined)?.rowid;
    if (vRowid) {
      try {
        ctx.deleteVec(Number(vRowid));
      } catch {}
    }
    ctx.stmts.deleteEntry.run(row.id);
  }

  return expired.length;
}

export async function reindex(
  ctx: BaseCtx,
  opts: { fullSync?: boolean; indexingConfig?: IndexingConfig; dryRun?: boolean; kindFilter?: string } = {}
): Promise<ReindexStats> {
  const { fullSync = true, indexingConfig, dryRun = false, kindFilter: reindexKindFilter } = opts;
  const ixConfig = indexingConfig ?? (ctx.config as any)?.indexing ?? DEFAULT_INDEXING;
  const stats: ReindexStats = {
    added: 0,
    updated: 0,
    removed: 0,
    unchanged: 0,
    skippedIndexing: 0,
    embeddingsCleared: 0,
  };

  if (!existsSync(ctx.config.vaultDir)) return stats;

  const upsertEntry = ctx.db.prepare(
    `INSERT OR IGNORE INTO vault (id, kind, category, title, body, meta, tags, source, file_path, identity_key, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const kindEntries: { kind: string; dir: string }[] = [];
  const topDirs = readdirSync(ctx.config.vaultDir, {
    withFileTypes: true,
  }).filter((d) => d.isDirectory() && !EXCLUDED_DIRS.has(d.name) && !d.name.startsWith('_'));

  for (const d of topDirs) {
    if (CATEGORY_DIRS.has(d.name)) {
      const catDir = join(ctx.config.vaultDir, d.name);
      const subDirs = readdirSync(catDir, { withFileTypes: true }).filter(
        (sd) => sd.isDirectory() && !sd.name.startsWith('_')
      );
      for (const sd of subDirs) {
        kindEntries.push({
          kind: dirToKind(sd.name),
          dir: join(catDir, sd.name),
        });
      }
    } else {
      kindEntries.push({
        kind: dirToKind(d.name),
        dir: join(ctx.config.vaultDir, d.name),
      });
    }
  }

  const filteredKindEntries = reindexKindFilter
    ? kindEntries.filter((ke) => ke.kind === reindexKindFilter)
    : kindEntries;

  const pendingEmbeds: { rowid: number; text: string }[] = [];

  if (dryRun) {
    for (const { kind, dir } of filteredKindEntries) {
      const category = categoryFor(kind);
      const mdFiles = walkDir(dir).filter((f) => !EXCLUDED_FILES.has(basename(f.filePath)));
      for (const { filePath } of mdFiles) {
        const raw = readFileSync(filePath, 'utf-8');
        if (!raw.startsWith('---\n')) continue;
        const { meta: fmMeta, body: rawBody } = parseFrontmatter(raw);
        const parsed = parseEntryFromMarkdown(kind, rawBody, fmMeta);
        const entryIndexed = shouldIndex(
          { kind, category, bodyLength: parsed.body.length },
          ixConfig
        );
        if (entryIndexed) {
          stats.added++;
        } else {
          stats.skippedIndexing!++;
        }
      }
    }
    return stats;
  }

  ctx.db.exec('BEGIN');
  try {
    for (const { kind, dir } of filteredKindEntries) {
      const category = categoryFor(kind);
      const mdFiles = walkDir(dir).filter((f) => !EXCLUDED_FILES.has(basename(f.filePath)));

      const dbRows = ctx.db
        .prepare(
          'SELECT id, file_path, body, title, tags, meta, related_to, indexed FROM vault WHERE kind = ?'
        )
        .all(kind) as Record<string, unknown>[];
      const dbByPath = new Map(dbRows.map((r) => [r.file_path as string, r]));
      const diskPaths = new Set(mdFiles.map((e) => e.filePath));

      for (const { filePath, relDir } of mdFiles) {
        const existing = dbByPath.get(filePath);

        if (!fullSync && existing) {
          stats.unchanged++;
          continue;
        }

        const raw = readFileSync(filePath, 'utf-8');
        if (!raw.startsWith('---\n')) {
          console.error(`[reindex] skipping (no frontmatter): ${filePath}`);
          continue;
        }
        const { meta: fmMeta, body: rawBody } = parseFrontmatter(raw);
        const parsed = parseEntryFromMarkdown(kind, rawBody, fmMeta);

        const identity_key = (fmMeta.identity_key as string) || null;
        const expires_at = (fmMeta.expires_at as string) || null;
        const related_to = Array.isArray(fmMeta.related_to)
          ? (fmMeta.related_to as string[])
          : null;
        const relatedToJson = related_to?.length ? JSON.stringify(related_to) : null;

        const meta: Record<string, unknown> = { ...(parsed.meta || {}) };
        if (relDir) meta.folder = relDir;
        else delete meta.folder;
        const metaJson = Object.keys(meta).length ? JSON.stringify(meta) : null;

        const entryIndexed = shouldIndex(
          { kind, category, bodyLength: parsed.body.length },
          ixConfig
        );

        if (!existing) {
          const id = (fmMeta.id as string) || ulid();
          const tagsJson = fmMeta.tags ? JSON.stringify(fmMeta.tags) : null;
          const created = (fmMeta.created as string) || new Date().toISOString();

          const result = upsertEntry.run(
            id,
            kind,
            category,
            parsed.title || null,
            parsed.body,
            metaJson,
            tagsJson,
            (fmMeta.source as string) || 'file',
            filePath,
            identity_key,
            expires_at,
            created,
            (fmMeta.updated as string) || created
          );
          if ((result as { changes: number }).changes > 0) {
            ctx.db.prepare('UPDATE vault SET indexed = ? WHERE id = ?').run(entryIndexed ? 1 : 0, id);
            if (relatedToJson && ctx.stmts.updateRelatedTo) {
              ctx.stmts.updateRelatedTo.run(relatedToJson, id);
            }
            if (entryIndexed && category !== 'event') {
              const rowidResult = ctx.stmts.getRowid.get(id) as { rowid: number } | undefined;
              if (rowidResult?.rowid) {
                const embeddingText = [parsed.title, parsed.body].filter(Boolean).join(' ');
                pendingEmbeds.push({
                  rowid: rowidResult.rowid,
                  text: embeddingText,
                });
              }
            }
            if (!entryIndexed) stats.skippedIndexing!++;
            stats.added++;
          } else {
            stats.unchanged++;
          }
        } else if (fullSync) {
          const tagsJson = fmMeta.tags ? JSON.stringify(fmMeta.tags) : null;
          const titleChanged = (parsed.title || null) !== ((existing.title as string) || null);
          const bodyChanged = (existing.body as string) !== parsed.body;
          const tagsChanged = tagsJson !== ((existing.tags as string) || null);
          const metaChanged = metaJson !== ((existing.meta as string) || null);
          const relatedToChanged = relatedToJson !== ((existing.related_to as string) || null);

          const existingIndexed = (existing as any).indexed;
          const indexedChanged = (entryIndexed ? 1 : 0) !== (existingIndexed ?? 1);

          if (bodyChanged || titleChanged || tagsChanged || metaChanged || relatedToChanged || indexedChanged) {
            ctx.stmts.updateEntry.run(
              parsed.title || null,
              parsed.body,
              metaJson,
              tagsJson,
              (fmMeta.source as string) || 'file',
              category,
              identity_key,
              expires_at,
              filePath
            );
            ctx.db.prepare('UPDATE vault SET indexed = ? WHERE file_path = ?').run(entryIndexed ? 1 : 0, filePath);
            if (relatedToJson && ctx.stmts.updateRelatedTo) {
              ctx.stmts.updateRelatedTo.run(relatedToJson, existing.id as string);
            }

            if (!entryIndexed) {
              const rowid = (
                ctx.stmts.getRowid.get(existing.id as string) as { rowid: number } | undefined
              )?.rowid;
              if (rowid) {
                try { ctx.deleteVec(rowid); stats.embeddingsCleared!++; } catch {}
              }
              stats.skippedIndexing!++;
            } else if ((bodyChanged || titleChanged) && category !== 'event') {
              const rowid = (
                ctx.stmts.getRowid.get(existing.id as string) as { rowid: number } | undefined
              )?.rowid;
              if (rowid) {
                const embeddingText = [parsed.title, parsed.body].filter(Boolean).join(' ');
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

      if (fullSync) {
        for (const [dbPath, row] of dbByPath) {
          if (!diskPaths.has(dbPath)) {
            const vRowid = (
              ctx.stmts.getRowid.get(row.id as string) as { rowid: number } | undefined
            )?.rowid;
            if (vRowid) {
              try {
                ctx.deleteVec(vRowid);
              } catch {}
            }
            ctx.stmts.deleteEntry.run(row.id as string);
            stats.removed++;
          }
        }
      }
    }

    if (fullSync) {
      const indexedKinds = new Set(kindEntries.map((ke) => ke.kind));
      const allDbKinds = ctx.db.prepare('SELECT DISTINCT kind FROM vault').all() as {
        kind: string;
      }[];
      for (const { kind } of allDbKinds) {
        if (!indexedKinds.has(kind)) {
          const orphaned = ctx.db
            .prepare('SELECT id, rowid FROM vault WHERE kind = ?')
            .all(kind) as { id: string; rowid: number }[];
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

    const expired = ctx.db
      .prepare(
        "SELECT id, file_path FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')"
      )
      .all() as { id: string; file_path: string | null }[];

    for (const row of expired) {
      if (row.file_path) {
        try {
          unlinkSync(row.file_path);
        } catch {}
      }
      const vRowid = (ctx.stmts.getRowid.get(row.id) as { rowid: number } | undefined)?.rowid;
      if (vRowid) {
        try {
          ctx.deleteVec(Number(vRowid));
        } catch {}
      }
      ctx.stmts.deleteEntry.run(row.id);
      stats.removed++;
    }

    ctx.db.exec('COMMIT');
  } catch (e) {
    ctx.db.exec('ROLLBACK');
    throw e;
  }

  for (let i = 0; i < pendingEmbeds.length; i += EMBED_BATCH_SIZE) {
    const batch = pendingEmbeds.slice(i, i + EMBED_BATCH_SIZE);
    const embeddings = await embedBatch(batch.map((e) => e.text));
    for (let j = 0; j < batch.length; j++) {
      if (embeddings[j]) {
        try {
          ctx.deleteVec(batch[j].rowid);
        } catch {}
        ctx.insertVec(batch[j].rowid, embeddings[j]!);
      }
    }
  }

  // Detect entries with missing embeddings and regenerate them
  if (fullSync) {
    const missingVec = ctx.db
      .prepare(
        `SELECT v.rowid, v.title, v.body FROM vault v
         WHERE v.category != 'event'
           AND v.indexed = 1
           AND v.rowid NOT IN (SELECT rowid FROM vault_vec)`
      )
      .all() as { rowid: number; title: string | null; body: string }[];

    if (missingVec.length > 0) {
      const missingEmbeds = missingVec.map((r) => ({
        rowid: r.rowid,
        text: [r.title, r.body].filter(Boolean).join(' '),
      }));

      for (let i = 0; i < missingEmbeds.length; i += EMBED_BATCH_SIZE) {
        const batch = missingEmbeds.slice(i, i + EMBED_BATCH_SIZE);
        const embeddings = await embedBatch(batch.map((e) => e.text));
        for (let j = 0; j < batch.length; j++) {
          if (embeddings[j]) {
            ctx.insertVec(batch[j].rowid, embeddings[j]!);
          }
        }
      }

      console.error(`[context-vault] Regenerated ${missingVec.length} missing embeddings`);
    }
  }

  return stats;
}
