import { gzipSync, gunzipSync } from 'node:zlib';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { VaultConfig, PreparedStatements, VaultEntry } from './types.js';
import { computeHeatForEntry } from './search.js';

export interface CompactCtx {
  db: DatabaseSync;
  config: VaultConfig;
  stmts: PreparedStatements;
  deleteVec: (rowid: number) => void;
  deleteCtxVec: (rowid: number) => void;
}

export interface CompactOptions {
  dryRun?: boolean;
  tier?: 'cold';
}

export interface CompactResult {
  candidates: number;
  compacted: number;
  bytesReclaimed: number;
  entries: Array<{
    id: string;
    kind: string;
    title: string | null;
    bodySize: number;
    heat: number;
    tier: string | null;
    ageDays: number;
  }>;
}

function archiveGzPath(vaultDir: string, id: string): string {
  return join(vaultDir, '_archive', `${id}.md.gz`);
}

function ensureArchiveDir(vaultDir: string): void {
  const dir = join(vaultDir, '_archive');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function summarizeBody(body: string): string {
  if (body.length <= 500) return body;
  return body.slice(0, 500) + '\n\n[compacted: full body archived]';
}

/**
 * Find entries eligible for compaction.
 *
 * Default: heat_tier IS NULL or 'cold', age > 90 days, recall_count = 0
 * With tier='cold': also compact cold entries > 30 days
 */
function findCompactCandidates(
  db: DatabaseSync,
  options: CompactOptions
): Array<VaultEntry & { ageDays: number; heat: number; computedTier: string | null }> {
  const now = Date.now();

  // Query entries that might be eligible: no recalls, old enough
  const minAgeDays = options.tier === 'cold' ? 30 : 90;
  const cutoff = new Date(now - minAgeDays * 86400000).toISOString();

  const rows = db
    .prepare(
      `SELECT * FROM vault
       WHERE recall_count = 0
         AND created_at <= ?
         AND indexed != 0
       ORDER BY created_at ASC`
    )
    .all(cutoff) as unknown as VaultEntry[];

  const candidates: Array<VaultEntry & { ageDays: number; heat: number; computedTier: string | null }> = [];

  for (const row of rows) {
    const { heat, tier: computedTier } = computeHeatForEntry(row);

    // Default mode: only null or cold heat_tier
    // With --tier cold: also include cold entries specifically
    const eligible =
      options.tier === 'cold'
        ? computedTier === 'cold' || computedTier === null
        : computedTier === null || computedTier === 'cold';

    if (!eligible) continue;

    const ageDays = Math.floor((now - new Date(row.created_at).getTime()) / 86400000);
    candidates.push({ ...row, ageDays, heat, computedTier });
  }

  return candidates;
}

/**
 * Compact frozen vault entries: gzip full body to _archive, replace with summary,
 * drop embeddings and mark as unindexed.
 */
export async function compact(
  ctx: CompactCtx,
  options: CompactOptions = {}
): Promise<CompactResult> {
  const candidates = findCompactCandidates(ctx.db, options);

  const result: CompactResult = {
    candidates: candidates.length,
    compacted: 0,
    bytesReclaimed: 0,
    entries: [],
  };

  if (candidates.length === 0 || options.dryRun) {
    result.entries = candidates.map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      bodySize: Buffer.byteLength(c.body, 'utf-8'),
      heat: c.heat,
      tier: c.computedTier,
      ageDays: c.ageDays,
    }));
    return result;
  }

  ensureArchiveDir(ctx.config.vaultDir);

  for (const entry of candidates) {
    const bodyBytes = Buffer.byteLength(entry.body, 'utf-8');
    const gzPath = archiveGzPath(ctx.config.vaultDir, entry.id);

    // Gzip and write the full body
    const compressed = gzipSync(Buffer.from(entry.body, 'utf-8'));
    writeFileSync(gzPath, compressed);

    // Replace body with summary
    const summary = summarizeBody(entry.body);

    // Drop embeddings
    const rowidRow = ctx.stmts.getRowid.get(entry.id) as { rowid?: number } | undefined;
    if (rowidRow?.rowid) {
      try { ctx.deleteVec(Number(rowidRow.rowid)); } catch {}
      try { ctx.deleteCtxVec(Number(rowidRow.rowid)); } catch {}
    }

    // Update the DB entry: set indexed=0, update body
    ctx.db
      .prepare(
        `UPDATE vault SET body = ?, indexed = 0, updated_at = ? WHERE id = ?`
      )
      .run(summary, new Date().toISOString(), entry.id);

    const summaryBytes = Buffer.byteLength(summary, 'utf-8');
    result.bytesReclaimed += bodyBytes - summaryBytes;
    result.compacted++;
    result.entries.push({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      bodySize: bodyBytes,
      heat: entry.heat,
      tier: entry.computedTier,
      ageDays: entry.ageDays,
    });
  }

  return result;
}

/**
 * Restore a compacted entry's full body from the gzipped archive.
 * Returns the decompressed body or null if no archive exists.
 */
export function restoreCompactedBody(vaultDir: string, id: string): string | null {
  const gzPath = archiveGzPath(vaultDir, id);
  if (!existsSync(gzPath)) return null;

  const compressed = readFileSync(gzPath);
  return gunzipSync(compressed).toString('utf-8');
}
