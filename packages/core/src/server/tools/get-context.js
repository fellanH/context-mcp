import { z } from "zod";
import { hybridSearch } from "../../retrieve/index.js";
import { categoryFor } from "../../core/categories.js";
import { normalizeKind } from "../../core/files.js";
import { ok, err } from "../helpers.js";
import { isEmbedAvailable } from "../../index/embed.js";

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
  if (autoWindowed) {
    const days = config.eventDecayDays || 30;
    lines.push(
      `> ℹ Event search limited to last ${days} days. Use \`since\` parameter for older results.\n`,
    );
  }
  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    const entryTags = r.tags ? JSON.parse(r.tags) : [];
    const tagStr = entryTags.length ? entryTags.join(", ") : "none";
    const relPath =
      r.file_path && config.vaultDir
        ? r.file_path.replace(config.vaultDir + "/", "")
        : r.file_path || "n/a";
    lines.push(
      `### [${i + 1}/${filtered.length}] ${r.title || "(untitled)"} [${r.kind}/${r.category}]`,
    );
    const dateStr =
      r.updated_at && r.updated_at !== r.created_at
        ? `${r.created_at} (updated ${r.updated_at})`
        : r.created_at || "";
    lines.push(
      `${r.score.toFixed(3)} · ${tagStr} · ${relPath} · ${dateStr} · id: \`${r.id}\``,
    );
    lines.push(r.body?.slice(0, 300) + (r.body?.length > 300 ? "..." : ""));
    lines.push("");
  }
  return ok(lines.join("\n"));
}
