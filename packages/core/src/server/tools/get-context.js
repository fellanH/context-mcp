import { z } from "zod";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { hybridSearch } from "../../retrieve/index.js";
import { categoryFor } from "../../core/categories.js";
import { normalizeKind } from "../../core/files.js";
import { ok, err } from "../helpers.js";
import { isEmbedAvailable } from "../../index/embed.js";

const STALE_DUPLICATE_DAYS = 7;
const DEFAULT_PIVOT_COUNT = 2;
const SKELETON_BODY_CHARS = 100;

/**
 * Truncate a body string to ~SKELETON_BODY_CHARS, breaking at sentence or
 * word boundary. Returns the truncated string with "..." appended.
 */
export function skeletonBody(body) {
  if (!body) return "";
  if (body.length <= SKELETON_BODY_CHARS) return body;
  const slice = body.slice(0, SKELETON_BODY_CHARS);
  const sentenceEnd = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf(".\n"),
  );
  if (sentenceEnd > SKELETON_BODY_CHARS * 0.4) {
    return slice.slice(0, sentenceEnd + 1) + "...";
  }
  const wordEnd = slice.lastIndexOf(" ");
  if (wordEnd > SKELETON_BODY_CHARS * 0.4) {
    return slice.slice(0, wordEnd) + "...";
  }
  return slice + "...";
}

/**
 * Detect conflicts among a set of search result entries.
 *
 * Two checks are performed:
 *   1. Supersession: if entry A's `superseded_by` points to any entry B in the
 *      result set, A is stale and should be discarded in favour of B.
 *   2. Stale duplicate: two entries share the same kind and at least one common
 *      tag, but their `updated_at` timestamps differ by more than
 *      STALE_DUPLICATE_DAYS days — suggesting the older one may be outdated.
 *
 * No LLM calls, no new dependencies — pure in-memory set operations on the
 * rows already fetched from the DB.
 *
 * @param {Array} entries - Result rows (as returned by hybridSearch / filter-only mode)
 * @param {import('../types.js').BaseCtx} _ctx - Unused for now; reserved for future DB look-ups
 * @returns {Array<{entry_a_id: string, entry_b_id: string, reason: string, recommendation: string}>}
 */
export function detectConflicts(entries, _ctx) {
  const conflicts = [];
  const idSet = new Set(entries.map((e) => e.id));

  for (const entry of entries) {
    if (entry.superseded_by && idSet.has(entry.superseded_by)) {
      conflicts.push({
        entry_a_id: entry.id,
        entry_b_id: entry.superseded_by,
        reason: "superseded",
        recommendation: `Discard \`${entry.id}\` — it has been explicitly superseded by \`${entry.superseded_by}\`.`,
      });
    }
  }

  const supersededConflictPairs = new Set(
    conflicts.map((c) => `${c.entry_a_id}|${c.entry_b_id}`),
  );

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];

      if (
        supersededConflictPairs.has(`${a.id}|${b.id}`) ||
        supersededConflictPairs.has(`${b.id}|${a.id}`)
      ) {
        continue;
      }

      if (a.kind !== b.kind) continue;

      const tagsA = a.tags ? JSON.parse(a.tags) : [];
      const tagsB = b.tags ? JSON.parse(b.tags) : [];

      if (!tagsA.length || !tagsB.length) continue;

      const tagsSetA = new Set(tagsA);
      const sharedTag = tagsB.some((t) => tagsSetA.has(t));
      if (!sharedTag) continue;

      const dateA = new Date(a.updated_at || a.created_at);
      const dateB = new Date(b.updated_at || b.created_at);
      if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) continue;

      const diffDays = Math.abs(dateA - dateB) / 86400000;
      if (diffDays <= STALE_DUPLICATE_DAYS) continue;

      const [older, newer] = dateA < dateB ? [a, b] : [b, a];
      conflicts.push({
        entry_a_id: older.id,
        entry_b_id: newer.id,
        reason: "stale_duplicate",
        recommendation: `Verify \`${older.id}\` is still accurate — it shares kind "${older.kind}" and tags with \`${newer.id}\` but was last updated ${Math.round(diffDays)} days earlier.`,
      });
    }
  }

  return conflicts;
}

/**
 * Check if an entry's source files have changed since the entry was saved.
 * Returns { stale: true, stale_reason } if stale, or null if fresh.
 * Best-effort: any read/parse failure returns null (no crash).
 *
 * @param {object} entry - DB row with source_files JSON column
 * @returns {{ stale: boolean, stale_reason: string } | null}
 */
function checkStaleness(entry) {
  if (!entry.source_files) return null;
  let sourceFiles;
  try {
    sourceFiles = JSON.parse(entry.source_files);
  } catch {
    return null;
  }
  if (!Array.isArray(sourceFiles) || sourceFiles.length === 0) return null;

  for (const sf of sourceFiles) {
    try {
      const absPath = sf.path.startsWith("/")
        ? sf.path
        : resolve(process.cwd(), sf.path);
      if (!existsSync(absPath)) {
        return { stale: true, stale_reason: "source file not found" };
      }
      const contents = readFileSync(absPath);
      const currentHash = createHash("sha256").update(contents).digest("hex");
      if (currentHash !== sf.hash) {
        return {
          stale: true,
          stale_reason: "source file modified since observation",
        };
      }
    } catch {
      // skip this file on any error — best-effort
    }
  }
  return null;
}

export const name = "get_context";

export const description =
  "Search your knowledge vault. Returns entries ranked by relevance using hybrid full-text + semantic search. Use this to find insights, decisions, patterns, or any saved context. Each result includes an `id` you can use with save_context or delete_context.";

export const inputSchema = {
  query: z
    .string()
    .optional()
    .describe(
      "Search query (natural language or keywords). Optional if filters (tags, kind, category) are provided.",
    ),
  kind: z
    .string()
    .optional()
    .describe("Filter by kind (e.g. 'insight', 'decision', 'pattern')"),
  category: z
    .enum(["knowledge", "entity", "event"])
    .optional()
    .describe("Filter by category"),
  identity_key: z
    .string()
    .optional()
    .describe("For entity lookup: exact match on identity key. Requires kind."),
  tags: z
    .array(z.string())
    .optional()
    .describe("Filter by tags (entries must match at least one)"),
  since: z
    .string()
    .optional()
    .describe("ISO date, return entries created after this"),
  until: z
    .string()
    .optional()
    .describe("ISO date, return entries created before this"),
  limit: z.number().optional().describe("Max results to return (default 10)"),
  include_superseded: z
    .boolean()
    .optional()
    .describe(
      "If true, include entries that have been superseded by newer ones. Default: false.",
    ),
  detect_conflicts: z
    .boolean()
    .optional()
    .describe(
      "If true, compare results for contradicting entries and append a conflicts array. Flags superseded entries still in results and stale duplicates (same kind+tags, updated_at >7 days apart). No LLM calls — pure DB logic.",
    ),
  max_tokens: z
    .number()
    .optional()
    .describe(
      "Limit output to entries that fit within this token budget (rough estimate: 1 token ≈ 4 chars). Entries are packed greedily by relevance rank. At least 1 result is always returned. Response metadata includes tokens_used and tokens_budget.",
    ),
  pivot_count: z
    .number()
    .optional()
    .describe(
      "Skeleton mode: top pivot_count entries by relevance are returned with full body. Remaining entries are returned as skeletons (title + tags + first ~100 chars of body). Default: 2. Set to 0 to skeleton all results, or a high number to disable.",
    ),
};

/**
 * @param {object} args
 * @param {import('../types.js').BaseCtx & Partial<import('../types.js').HostedCtxExtensions>} ctx
 * @param {import('../types.js').ToolShared} shared
 */
export async function handler(
  {
    query,
    kind,
    category,
    identity_key,
    tags,
    since,
    until,
    limit,
    include_superseded,
    detect_conflicts,
    max_tokens,
    pivot_count,
  },
  ctx,
  { ensureIndexed, reindexFailed },
) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  const hasQuery = query?.trim();
  const hasFilters =
    kind || category || tags?.length || since || until || identity_key;
  if (!hasQuery && !hasFilters)
    return err(
      "Required: query or at least one filter (kind, category, tags, since, until, identity_key)",
      "INVALID_INPUT",
    );
  await ensureIndexed();

  const kindFilter = kind ? normalizeKind(kind) : null;

  // Gap 1: Entity exact-match by identity_key
  if (identity_key) {
    if (!kindFilter)
      return err("identity_key requires kind to be specified", "INVALID_INPUT");
    const match = ctx.stmts.getByIdentityKey.get(
      kindFilter,
      identity_key,
      userId !== undefined ? userId : null,
    );
    if (match) {
      const entryTags = match.tags ? JSON.parse(match.tags) : [];
      const tagStr = entryTags.length ? entryTags.join(", ") : "none";
      const relPath =
        match.file_path && config.vaultDir
          ? match.file_path.replace(config.vaultDir + "/", "")
          : match.file_path || "n/a";
      const lines = [
        `## Entity Match (exact)\n`,
        `### ${match.title || "(untitled)"} [${match.kind}/${match.category}]`,
        `1.000 · ${tagStr} · ${relPath} · id: \`${match.id}\``,
        match.body?.slice(0, 300) + (match.body?.length > 300 ? "..." : ""),
      ];
      return ok(lines.join("\n"));
    }
    // Fall through to semantic search as fallback
  }

  // Gap 2: Event default time-window
  const effectiveCategory =
    category || (kindFilter ? categoryFor(kindFilter) : null);
  let effectiveSince = since || null;
  let effectiveUntil = until || null;
  let autoWindowed = false;
  if (effectiveCategory === "event" && !since && !until) {
    const decayMs = (config.eventDecayDays || 30) * 86400000;
    effectiveSince = new Date(Date.now() - decayMs).toISOString();
    autoWindowed = true;
  }

  const effectiveLimit = limit || 10;
  // When tag-filtering, over-fetch to compensate for post-filter reduction
  const MAX_FETCH_LIMIT = 500;
  const fetchLimit = tags?.length
    ? Math.min(effectiveLimit * 10, MAX_FETCH_LIMIT)
    : effectiveLimit;

  let filtered;
  if (hasQuery) {
    // Hybrid search mode
    const sorted = await hybridSearch(ctx, query, {
      kindFilter,
      categoryFilter: category || null,
      since: effectiveSince,
      until: effectiveUntil,
      limit: fetchLimit,
      decayDays: config.eventDecayDays || 30,
      userIdFilter: userId,
      includeSuperseeded: include_superseded ?? false,
    });

    // Post-filter by tags if provided, then apply requested limit
    filtered = tags?.length
      ? sorted
          .filter((r) => {
            const entryTags = r.tags ? JSON.parse(r.tags) : [];
            return tags.some((t) => entryTags.includes(t));
          })
          .slice(0, effectiveLimit)
      : sorted;
  } else {
    // Filter-only mode (no query, use SQL directly)
    const clauses = [];
    const params = [];
    if (userId !== undefined) {
      clauses.push("user_id = ?");
      params.push(userId);
    }
    if (kindFilter) {
      clauses.push("kind = ?");
      params.push(kindFilter);
    }
    if (category) {
      clauses.push("category = ?");
      params.push(category);
    }
    if (effectiveSince) {
      clauses.push("created_at >= ?");
      params.push(effectiveSince);
    }
    if (effectiveUntil) {
      clauses.push("created_at <= ?");
      params.push(effectiveUntil);
    }
    clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(fetchLimit);
    const rows = ctx.db
      .prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params);

    // Post-filter by tags if provided, then apply requested limit
    filtered = tags?.length
      ? rows
          .filter((r) => {
            const entryTags = r.tags ? JSON.parse(r.tags) : [];
            return tags.some((t) => entryTags.includes(t));
          })
          .slice(0, effectiveLimit)
      : rows;

    // Add score field for consistent output
    for (const r of filtered) r.score = 0;
  }

  if (!filtered.length) {
    if (autoWindowed) {
      const days = config.eventDecayDays || 30;
      return ok(
        hasQuery
          ? `No results found for "${query}" in events (last ${days} days).\nTry with \`since: "YYYY-MM-DD"\` to search older events.`
          : `No entries found matching the given filters in events (last ${days} days).\nTry with \`since: "YYYY-MM-DD"\` to search older events.`,
      );
    }
    return ok(
      hasQuery
        ? "No results found for: " + query
        : "No entries found matching the given filters.",
    );
  }

  // Decrypt encrypted entries if ctx.decrypt is available
  if (ctx.decrypt) {
    for (const r of filtered) {
      if (r.body_encrypted) {
        const decrypted = await ctx.decrypt(r);
        r.body = decrypted.body;
        if (decrypted.title) r.title = decrypted.title;
        if (decrypted.meta) r.meta = JSON.stringify(decrypted.meta);
      }
    }
  }

  // Token-budgeted packing
  let tokensBudget = null;
  let tokensUsed = null;
  if (max_tokens != null && max_tokens > 0) {
    tokensBudget = max_tokens;
    const packed = [];
    let used = 0;
    for (const entry of filtered) {
      const entryTokens = Math.ceil((entry.body?.length || 0) / 4);
      if (packed.length === 0 || used + entryTokens <= tokensBudget) {
        packed.push(entry);
        used += entryTokens;
      }
      if (used >= tokensBudget) break;
    }
    tokensUsed = used;
    filtered = packed;
  }

  // Skeleton mode: determine pivot threshold
  const effectivePivot = pivot_count != null ? pivot_count : DEFAULT_PIVOT_COUNT;

  // Conflict detection
  const conflicts = detect_conflicts ? detectConflicts(filtered, ctx) : [];

  const lines = [];
  if (reindexFailed)
    lines.push(
      `> **Warning:** Auto-reindex failed. Results may be stale. Run \`context-vault reindex\` to fix.\n`,
    );
  if (hasQuery && isEmbedAvailable() === false)
    lines.push(
      `> **Note:** Semantic search unavailable — results ranked by keyword match only. Run \`context-vault setup\` to download the embedding model.\n`,
    );
  const heading = hasQuery ? `Results for "${query}"` : "Filtered entries";
  lines.push(`## ${heading} (${filtered.length} matches)\n`);
  if (tokensBudget != null) {
    lines.push(
      `> Token budget: ${tokensUsed} / ${tokensBudget} tokens used.\n`,
    );
  }
  if (autoWindowed) {
    const days = config.eventDecayDays || 30;
    lines.push(
      `> ℹ Event search limited to last ${days} days. Use \`since\` parameter for older results.\n`,
    );
  }
  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const isSkeleton = i >= effectivePivot;
    const entryTags = r.tags ? JSON.parse(r.tags) : [];
    const tagStr = entryTags.length ? entryTags.join(", ") : "none";
    const relPath =
      r.file_path && config.vaultDir
        ? r.file_path.replace(config.vaultDir + "/", "")
        : r.file_path || "n/a";
    const skeletonLabel = isSkeleton ? " ⊘ skeleton" : "";
    lines.push(
      `### [${i + 1}/${filtered.length}] ${r.title || "(untitled)"} [${r.kind}/${r.category}]${skeletonLabel}`,
    );
    const dateStr =
      r.updated_at && r.updated_at !== r.created_at
        ? `${r.created_at} (updated ${r.updated_at})`
        : r.created_at || "";
    lines.push(
      `${r.score.toFixed(3)} · ${tagStr} · ${relPath} · ${dateStr} · skeleton: ${isSkeleton} · id: \`${r.id}\``,
    );
    const stalenessResult = checkStaleness(r);
    if (stalenessResult) {
      r.stale = true;
      r.stale_reason = stalenessResult.stale_reason;
      lines.push(`> ⚠ **Stale**: ${stalenessResult.stale_reason}`);
    }
    if (isSkeleton) {
      lines.push(skeletonBody(r.body));
    } else {
      lines.push(r.body?.slice(0, 300) + (r.body?.length > 300 ? "..." : ""));
    }
    lines.push("");
  }

  if (detect_conflicts) {
    if (conflicts.length === 0) {
      lines.push(
        `## Conflict Detection\n\nNo conflicts detected among results.\n`,
      );
    } else {
      lines.push(`## Conflict Detection (${conflicts.length} flagged)\n`);
      for (const c of conflicts) {
        lines.push(
          `- **${c.reason}**: \`${c.entry_a_id}\` vs \`${c.entry_b_id}\``,
        );
        lines.push(`  Recommendation: ${c.recommendation}`);
      }
      lines.push("");
    }
  }

  const result = ok(lines.join("\n"));
  if (tokensBudget != null) {
    result._meta = { tokens_used: tokensUsed, tokens_budget: tokensBudget };
  }
  return result;
}
