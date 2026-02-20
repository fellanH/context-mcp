import { z } from "zod";
import { normalizeKind } from "../../core/files.js";
import { ok } from "../helpers.js";

export const name = "list_context";

export const description =
  "Browse vault entries without a search query. Returns id, title, kind, category, tags, created_at. Use get_context with a query for semantic search. Use this to browse by tags or find recent entries.";

export const inputSchema = {
  kind: z.string().optional().describe("Filter by kind (e.g. 'insight', 'decision', 'pattern')"),
  category: z.enum(["knowledge", "entity", "event"]).optional().describe("Filter by category"),
  tags: z.array(z.string()).optional().describe("Filter by tags (entries must match at least one)"),
  since: z.string().optional().describe("ISO date, return entries created after this"),
  until: z.string().optional().describe("ISO date, return entries created before this"),
  limit: z.number().optional().describe("Max results to return (default 20, max 100)"),
  offset: z.number().optional().describe("Skip first N results for pagination"),
};

export async function handler({ kind, category, tags, since, until, limit, offset }, ctx, { ensureIndexed, reindexFailed }) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  await ensureIndexed();

  const clauses = [];
  const params = [];

  if (userId !== undefined) {
    clauses.push("user_id = ?");
    params.push(userId);
  }
  if (kind) {
    clauses.push("kind = ?");
    params.push(normalizeKind(kind));
  }
  if (category) {
    clauses.push("category = ?");
    params.push(category);
  }
  if (since) {
    clauses.push("created_at >= ?");
    params.push(since);
  }
  if (until) {
    clauses.push("created_at <= ?");
    params.push(until);
  }
  clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const effectiveLimit = Math.min(limit || 20, 100);
  const effectiveOffset = offset || 0;
  // When tag-filtering, over-fetch to compensate for post-filter reduction
  const fetchLimit = tags?.length ? effectiveLimit * 10 : effectiveLimit;

  const countParams = [...params];
  const total = ctx.db.prepare(`SELECT COUNT(*) as c FROM vault ${where}`).get(...countParams).c;

  params.push(fetchLimit, effectiveOffset);
  const rows = ctx.db.prepare(`SELECT id, title, kind, category, tags, created_at, SUBSTR(body, 1, 120) as preview FROM vault ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params);

  // Post-filter by tags if provided, then apply requested limit
  const filtered = tags?.length
    ? rows.filter((r) => {
        const entryTags = r.tags ? JSON.parse(r.tags) : [];
        return tags.some((t) => entryTags.includes(t));
      }).slice(0, effectiveLimit)
    : rows;

  if (!filtered.length) return ok("No entries found matching the given filters.");

  const lines = [];
  if (reindexFailed) lines.push(`> **Warning:** Auto-reindex failed. Results may be stale. Run \`context-vault reindex\` to fix.\n`);
  lines.push(`## Vault Entries (${filtered.length} shown, ${total} total)\n`);
  for (const r of filtered) {
    const entryTags = r.tags ? JSON.parse(r.tags) : [];
    const tagStr = entryTags.length ? entryTags.join(", ") : "none";
    lines.push(`- **${r.title || "(untitled)"}** [${r.kind}/${r.category}] — ${tagStr} — ${r.created_at} — \`${r.id}\``);
    if (r.preview) lines.push(`  ${r.preview.replace(/\n+/g, " ").trim()}${r.preview.length >= 120 ? "…" : ""}`);
  }

  if (effectiveOffset + effectiveLimit < total) {
    lines.push(`\n_Page ${Math.floor(effectiveOffset / effectiveLimit) + 1}. Use offset: ${effectiveOffset + effectiveLimit} for next page._`);
  }

  return ok(lines.join("\n"));
}
