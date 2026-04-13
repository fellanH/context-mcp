import type { BaseCtx } from './types.js';
import { dotProduct } from './search.js';

export interface DuplicateGroup {
  canonical_id: string;
  duplicate_ids: string[];
  similarity: number;
  importance_signal: number;
  canonical_title: string;
  sample_titles: string[];
}

export interface MergeResult {
  canonical_id: string;
  merged_count: number;
  new_recall_count: number;
  removed_ids: string[];
}

export interface DecayScore {
  id: string;
  title: string;
  kind: string;
  score: number;
  days_since_recall: number;
  recall_count: number;
  recommendation: 'keep' | 'compact' | 'archive';
}

interface VaultRow {
  id: string;
  title: string | null;
  kind: string;
  recall_count: number;
  recall_sessions: number;
  last_recalled_at: string | null;
  updated_at: string | null;
  created_at: string;
  rowid: number;
}

interface VecRow {
  rowid: number;
  embedding: Buffer;
}

const KIND_WEIGHTS: Record<string, number> = {
  insight: 10,
  decision: 8,
  pattern: 7,
  reference: 5,
  event: 2,
};

export async function findDuplicates(
  ctx: BaseCtx,
  opts?: {
    threshold?: number;
    limit?: number;
    kind?: string;
    dryRun?: boolean;
  }
): Promise<DuplicateGroup[]> {
  const threshold = opts?.threshold ?? 0.85;
  const limit = opts?.limit ?? 50;
  const kind = opts?.kind ?? null;

  const whereParts = [
    'indexed = 1',
    'superseded_by IS NULL',
    "(expires_at IS NULL OR expires_at > datetime('now'))",
  ];
  const params: (string | number)[] = [];
  if (kind) {
    whereParts.push('kind = ?');
    params.push(kind);
  }

  const entries = ctx.db
    .prepare(
      `SELECT rowid, id, title, kind, recall_count, recall_sessions, last_recalled_at, updated_at, created_at
       FROM vault WHERE ${whereParts.join(' AND ')} ORDER BY recall_count DESC`
    )
    .all(...params) as unknown as VaultRow[];

  if (entries.length === 0) return [];

  const entryMap = new Map<string, VaultRow>();
  const rowidToId = new Map<number, string>();
  for (const e of entries) {
    entryMap.set(e.id, e);
    rowidToId.set(e.rowid, e.id);
  }

  // Load embeddings for all eligible entries via vault_vec KNN
  const embeddingMap = new Map<string, Float32Array>();
  const rowids = entries.map((e) => e.rowid);
  if (rowids.length > 0) {
    const batchSize = 500;
    for (let i = 0; i < rowids.length; i += batchSize) {
      const batch = rowids.slice(i, i + batchSize);
      const placeholders = batch.map(() => '?').join(',');
      const vecRows = ctx.db
        .prepare(`SELECT rowid, embedding FROM vault_vec WHERE rowid IN (${placeholders})`)
        .all(...batch) as unknown as VecRow[];
      for (const row of vecRows) {
        const id = rowidToId.get(Number(row.rowid));
        if (id && row.embedding) {
          embeddingMap.set(
            id,
            new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
          );
        }
      }
    }
  }

  if (embeddingMap.size === 0) return [];

  // Find duplicate groups using pairwise similarity
  const merged = new Set<string>();
  const groups: DuplicateGroup[] = [];

  // For each entry with an embedding, use KNN to find neighbors
  const entriesWithVec = entries.filter((e) => embeddingMap.has(e.id));

  for (const entry of entriesWithVec) {
    if (merged.has(entry.id)) continue;

    const entryVec = embeddingMap.get(entry.id)!;
    const neighbors: Array<{ id: string; sim: number }> = [];

    // Compare against all other entries with embeddings
    for (const other of entriesWithVec) {
      if (other.id === entry.id || merged.has(other.id)) continue;
      const otherVec = embeddingMap.get(other.id);
      if (!otherVec) continue;
      const sim = dotProduct(entryVec, otherVec);
      if (sim >= threshold) {
        neighbors.push({ id: other.id, sim });
      }
    }

    if (neighbors.length === 0) continue;

    // Build the group: canonical is the one with highest recall_count
    const allIds = [entry.id, ...neighbors.map((n) => n.id)];
    let canonicalId = entry.id;
    let maxRecall = entry.recall_count;
    for (const nId of neighbors.map((n) => n.id)) {
      const nEntry = entryMap.get(nId);
      if (nEntry && nEntry.recall_count > maxRecall) {
        maxRecall = nEntry.recall_count;
        canonicalId = nId;
      }
    }

    const duplicateIds = allIds.filter((id) => id !== canonicalId);
    const avgSim =
      neighbors.reduce((sum, n) => sum + n.sim, 0) / neighbors.length;

    const canonical = entryMap.get(canonicalId)!;
    const sampleTitles = duplicateIds
      .map((id) => entryMap.get(id)?.title)
      .filter((t): t is string => t != null)
      .slice(0, 5);

    groups.push({
      canonical_id: canonicalId,
      duplicate_ids: duplicateIds,
      similarity: Math.round(avgSim * 1000) / 1000,
      importance_signal: allIds.length,
      canonical_title: canonical.title ?? '(untitled)',
      sample_titles: sampleTitles,
    });

    for (const id of allIds) merged.add(id);

    if (groups.length >= limit) break;
  }

  // Sort by importance (more duplicates = more important)
  groups.sort((a, b) => b.importance_signal - a.importance_signal);

  return groups.slice(0, limit);
}

export function mergeEntries(
  ctx: BaseCtx,
  opts: {
    canonical_id: string;
    duplicate_ids: string[];
    dryRun?: boolean;
  }
): MergeResult {
  const dryRun = opts.dryRun ?? true;
  const { canonical_id, duplicate_ids } = opts;

  if (duplicate_ids.length === 0) {
    const canonical = ctx.db
      .prepare('SELECT recall_count FROM vault WHERE id = ?')
      .get(canonical_id) as { recall_count: number } | undefined;
    return {
      canonical_id,
      merged_count: 0,
      new_recall_count: canonical?.recall_count ?? 0,
      removed_ids: [],
    };
  }

  // Gather recall stats from all entries
  const allIds = [canonical_id, ...duplicate_ids];
  const placeholders = allIds.map(() => '?').join(',');
  const rows = ctx.db
    .prepare(
      `SELECT id, recall_count, recall_sessions FROM vault WHERE id IN (${placeholders})`
    )
    .all(...allIds) as unknown as Array<{
    id: string;
    recall_count: number;
    recall_sessions: number;
  }>;

  let totalRecallCount = 0;
  let totalRecallSessions = 0;
  for (const row of rows) {
    totalRecallCount += row.recall_count ?? 0;
    totalRecallSessions += row.recall_sessions ?? 0;
  }

  if (dryRun) {
    return {
      canonical_id,
      merged_count: duplicate_ids.length,
      new_recall_count: totalRecallCount,
      removed_ids: duplicate_ids,
    };
  }

  const now = new Date().toISOString();
  const dateStr = now.slice(0, 10);

  // Update canonical: sum recall counts, append consolidation note
  ctx.db
    .prepare(
      `UPDATE vault SET
        recall_count = ?,
        recall_sessions = ?,
        updated_at = ?,
        body = body || ?
      WHERE id = ?`
    )
    .run(
      totalRecallCount,
      totalRecallSessions,
      now,
      `\n\n[Consolidated from ${duplicate_ids.length + 1} entries on ${dateStr}]`,
      canonical_id
    );

  // Mark duplicates as superseded
  for (const dupId of duplicate_ids) {
    ctx.db
      .prepare('UPDATE vault SET superseded_by = ?, updated_at = ? WHERE id = ?')
      .run(canonical_id, now, dupId);
  }

  return {
    canonical_id,
    merged_count: duplicate_ids.length,
    new_recall_count: totalRecallCount,
    removed_ids: duplicate_ids,
  };
}

export function computeDecayScores(
  ctx: BaseCtx,
  opts?: {
    limit?: number;
    minAgeDays?: number;
  }
): DecayScore[] {
  const limit = opts?.limit ?? 100;
  const minAgeDays = opts?.minAgeDays ?? 0;

  const now = Date.now();
  const cutoffDate = minAgeDays > 0
    ? new Date(now - minAgeDays * 86400000).toISOString()
    : null;

  const whereParts = [
    'indexed = 1',
    'superseded_by IS NULL',
    "(expires_at IS NULL OR expires_at > datetime('now'))",
  ];
  const params: string[] = [];
  if (cutoffDate) {
    whereParts.push('created_at <= ?');
    params.push(cutoffDate);
  }

  const rows = ctx.db
    .prepare(
      `SELECT id, title, kind, recall_count, last_recalled_at, updated_at, created_at
       FROM vault WHERE ${whereParts.join(' AND ')}
       ORDER BY updated_at ASC`
    )
    .all(...params) as unknown as Array<{
    id: string;
    title: string | null;
    kind: string;
    recall_count: number;
    last_recalled_at: string | null;
    updated_at: string | null;
    created_at: string;
  }>;

  const scores: DecayScore[] = [];

  for (const row of rows) {
    const lastActivity = row.last_recalled_at ?? row.updated_at ?? row.created_at;
    const daysSinceRecall = (now - new Date(lastActivity).getTime()) / 86400000;

    const baseValue = KIND_WEIGHTS[row.kind] ?? 5;
    const timeDecay = Math.exp(-0.02 * daysSinceRecall);
    const recallBoost = 1 + Math.log((row.recall_count ?? 0) + 1);

    const rawScore = baseValue * timeDecay * recallBoost;
    // Normalize to 0-100 scale (max possible: ~10 * 1.0 * ~5 = 50 for heavily recalled insight)
    const score = Math.max(0, Math.min(100, Math.round(rawScore * 10)));

    let recommendation: 'keep' | 'compact' | 'archive';
    if (score >= 30) {
      recommendation = 'keep';
    } else if (score >= 10) {
      recommendation = 'compact';
    } else {
      recommendation = 'archive';
    }

    scores.push({
      id: row.id,
      title: row.title ?? '(untitled)',
      kind: row.kind,
      score,
      days_since_recall: Math.round(daysSinceRecall),
      recall_count: row.recall_count ?? 0,
      recommendation,
    });
  }

  // Sort by score ascending (most decayed first)
  scores.sort((a, b) => a.score - b.score);

  return scores.slice(0, limit);
}
