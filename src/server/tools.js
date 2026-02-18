/**
 * tools.js — MCP tool registrations
 *
 * Five tools: save_context (write/update), get_context (search), list_context (browse),
 * delete_context (remove), context_status (diag).
 * Auto-reindex runs transparently on first tool call per session.
 */

import { z } from "zod";
import { existsSync, unlinkSync } from "node:fs";

import { captureAndIndex, updateEntryFile } from "../capture/index.js";
import { hybridSearch } from "../retrieve/index.js";
import { reindex, indexEntry } from "../index/index.js";
import { gatherVaultStatus } from "../core/status.js";
import { categoryFor } from "../core/categories.js";
import { normalizeKind } from "../core/files.js";
import { ok, err, ensureVaultExists, ensureValidKind } from "./helpers.js";

/**
 * Register all MCP tools on the server.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {{ db, config, stmts, embed, insertVec, deleteVec }} ctx
 */
export function registerTools(server, ctx) {
  const { config } = ctx;

  // ─── Auto-Reindex (runs once per session, on first tool call) ──────────────

  let reindexDone = false;
  let reindexPromise = null;
  let reindexAttempts = 0;
  let reindexFailed = false;
  const MAX_REINDEX_ATTEMPTS = 2;

  async function ensureIndexed() {
    if (reindexDone) return;
    if (reindexPromise) return reindexPromise;
    reindexPromise = reindex(ctx, { fullSync: true })
      .then((stats) => {
        reindexDone = true;
        const total = stats.added + stats.updated + stats.removed;
        if (total > 0) {
          console.error(`[context-mcp] Auto-reindex: +${stats.added} ~${stats.updated} -${stats.removed} (${stats.unchanged} unchanged)`);
        }
      })
      .catch((e) => {
        reindexAttempts++;
        console.error(`[context-mcp] Auto-reindex failed (attempt ${reindexAttempts}/${MAX_REINDEX_ATTEMPTS}): ${e.message}`);
        if (reindexAttempts >= MAX_REINDEX_ATTEMPTS) {
          console.error(`[context-mcp] Giving up on auto-reindex. Run \`context-mcp reindex\` manually to diagnose.`);
          reindexDone = true;
          reindexFailed = true;
        } else {
          reindexPromise = null; // Allow retry on next tool call
        }
      });
    return reindexPromise;
  }

  // ─── get_context (search) ──────────────────────────────────────────────────

  server.tool(
    "get_context",
    "Search your knowledge vault. Returns entries ranked by relevance using hybrid full-text + semantic search. Use this to find insights, decisions, patterns, or any saved context.",
    {
      query: z.string().describe("Search query (natural language or keywords)"),
      kind: z.string().optional().describe("Filter by kind (e.g. 'insight', 'decision', 'pattern')"),
      category: z.enum(["knowledge", "entity", "event"]).optional().describe("Filter by category"),
      tags: z.array(z.string()).optional().describe("Filter by tags (entries must match at least one)"),
      since: z.string().optional().describe("ISO date, return entries created after this"),
      until: z.string().optional().describe("ISO date, return entries created before this"),
      limit: z.number().optional().describe("Max results to return (default 10)"),
    },
    async ({ query, kind, category, tags, since, until, limit }) => {
      if (!query?.trim()) return err("Required: query (non-empty string)", "INVALID_INPUT");
      await ensureIndexed();

      const kindFilter = kind ? normalizeKind(kind) : null;
      const sorted = await hybridSearch(ctx, query, {
        kindFilter,
        categoryFilter: category || null,
        since: since || null,
        until: until || null,
        limit: limit || 10,
      });

      // Post-filter by tags if provided
      const filtered = tags?.length
        ? sorted.filter((r) => {
            const entryTags = r.tags ? JSON.parse(r.tags) : [];
            return tags.some((t) => entryTags.includes(t));
          })
        : sorted;

      if (!filtered.length) return ok("No results found for: " + query);

      const lines = [];
      if (reindexFailed) lines.push(`> **Warning:** Auto-reindex failed. Results may be stale. Run \`context-mcp reindex\` to fix.\n`);
      lines.push(`## Results for "${query}" (${filtered.length} matches)\n`);
      for (let i = 0; i < filtered.length; i++) {
        const r = filtered[i];
        const entryTags = r.tags ? JSON.parse(r.tags) : [];
        const tagStr = entryTags.length ? entryTags.join(", ") : "none";
        const relPath = r.file_path && config.vaultDir ? r.file_path.replace(config.vaultDir + "/", "") : r.file_path || "n/a";
        lines.push(`### [${i + 1}/${filtered.length}] ${r.title || "(untitled)"} [${r.kind}/${r.category}]`);
        lines.push(`${r.score.toFixed(3)} · ${tagStr} · ${relPath}`);
        lines.push(r.body?.slice(0, 300) + (r.body?.length > 300 ? "..." : ""));
        lines.push("");
      }
      return ok(lines.join("\n"));
    }
  );

  // ─── save_context (write / update) ────────────────────────────────────────

  server.tool(
    "save_context",
    "Save knowledge to your vault. Creates a .md file and indexes it for search. Use for any kind of context: insights, decisions, patterns, references, or any custom kind.",
    {
      id: z.string().optional().describe("Entry ULID to update. When provided, updates the existing entry instead of creating new. Omitted fields are preserved."),
      kind: z.string().optional().describe("Entry kind — determines folder (e.g. 'insight', 'decision', 'pattern', 'reference', or any custom kind). Required for new entries."),
      title: z.string().optional().describe("Entry title (optional for insights)"),
      body: z.string().optional().describe("Main content. Required for new entries."),
      tags: z.array(z.string()).optional().describe("Tags for categorization and search"),
      meta: z.any().optional().describe("Additional structured metadata (JSON object, e.g. { language: 'js', status: 'accepted' })"),
      folder: z.string().optional().describe("Subfolder within the kind directory (e.g. 'react/hooks')"),
      source: z.string().optional().describe("Where this knowledge came from"),
      identity_key: z.string().optional().describe("Required for entity kinds (contact, project, tool, source). The unique identifier for this entity."),
      expires_at: z.string().optional().describe("ISO date for TTL expiry"),
    },
    async ({ id, kind, title, body, tags, meta, folder, source, identity_key, expires_at }) => {
      const vaultErr = ensureVaultExists(config);
      if (vaultErr) return vaultErr;

      // ── Update mode ──
      if (id) {
        await ensureIndexed();

        const existing = ctx.stmts.getEntryById.get(id);
        if (!existing) return err(`Entry not found: ${id}`, "NOT_FOUND");

        if (kind && normalizeKind(kind) !== existing.kind) {
          return err(`Cannot change kind (current: "${existing.kind}"). Delete and re-create instead.`, "INVALID_UPDATE");
        }
        if (identity_key && identity_key !== existing.identity_key) {
          return err(`Cannot change identity_key (current: "${existing.identity_key}"). Delete and re-create instead.`, "INVALID_UPDATE");
        }

        const entry = updateEntryFile(ctx, existing, { title, body, tags, meta, source, expires_at });
        await indexEntry(ctx, entry);
        const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
        const parts = [`✓ Updated ${entry.kind} → ${relPath}`, `  id: ${entry.id}`];
        if (entry.title) parts.push(`  title: ${entry.title}`);
        const entryTags = entry.tags || [];
        if (entryTags.length) parts.push(`  tags: ${entryTags.join(", ")}`);
        return ok(parts.join("\n"));
      }

      // ── Create mode ──
      if (!kind) return err("Required: kind (for new entries)", "INVALID_INPUT");
      const kindErr = ensureValidKind(kind);
      if (kindErr) return kindErr;
      if (!body?.trim()) return err("Required: body (for new entries)", "INVALID_INPUT");

      if (categoryFor(kind) === "entity" && !identity_key) {
        return err(`Entity kind "${kind}" requires identity_key`, "MISSING_IDENTITY_KEY");
      }

      await ensureIndexed();

      const mergedMeta = { ...(meta || {}) };
      if (folder) mergedMeta.folder = folder;
      const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

      const entry = await captureAndIndex(ctx, { kind, title, body, meta: finalMeta, tags, source, folder, identity_key, expires_at }, indexEntry);
      const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
      const parts = [`✓ Saved ${kind} → ${relPath}`, `  id: ${entry.id}`];
      if (title) parts.push(`  title: ${title}`);
      if (tags?.length) parts.push(`  tags: ${tags.join(", ")}`);
      return ok(parts.join("\n"));
    }
  );

  // ─── list_context (browse) ────────────────────────────────────────────────

  server.tool(
    "list_context",
    "Browse vault entries without a search query. Returns id, title, kind, category, tags, created_at. Use get_context with a query for semantic search.",
    {
      kind: z.string().optional().describe("Filter by kind (e.g. 'insight', 'decision', 'pattern')"),
      category: z.enum(["knowledge", "entity", "event"]).optional().describe("Filter by category"),
      tags: z.array(z.string()).optional().describe("Filter by tags (entries must match at least one)"),
      since: z.string().optional().describe("ISO date, return entries created after this"),
      until: z.string().optional().describe("ISO date, return entries created before this"),
      limit: z.number().optional().describe("Max results to return (default 20, max 100)"),
      offset: z.number().optional().describe("Skip first N results for pagination"),
    },
    async ({ kind, category, tags, since, until, limit, offset }) => {
      await ensureIndexed();

      const clauses = [];
      const params = [];

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

      const countParams = [...params];
      const total = ctx.db.prepare(`SELECT COUNT(*) as c FROM vault ${where}`).get(...countParams).c;

      params.push(effectiveLimit, effectiveOffset);
      const rows = ctx.db.prepare(`SELECT id, title, kind, category, tags, created_at FROM vault ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params);

      // Post-filter by tags if provided
      const filtered = tags?.length
        ? rows.filter((r) => {
            const entryTags = r.tags ? JSON.parse(r.tags) : [];
            return tags.some((t) => entryTags.includes(t));
          })
        : rows;

      if (!filtered.length) return ok("No entries found matching the given filters.");

      const lines = [`## Vault Entries (${filtered.length} shown, ${total} total)\n`];
      for (const r of filtered) {
        const entryTags = r.tags ? JSON.parse(r.tags) : [];
        const tagStr = entryTags.length ? entryTags.join(", ") : "none";
        lines.push(`- **${r.title || "(untitled)"}** [${r.kind}/${r.category}] — ${tagStr} — ${r.created_at} — \`${r.id}\``);
      }

      if (effectiveOffset + effectiveLimit < total) {
        lines.push(`\n_Page ${Math.floor(effectiveOffset / effectiveLimit) + 1}. Use offset: ${effectiveOffset + effectiveLimit} for next page._`);
      }

      return ok(lines.join("\n"));
    }
  );

  // ─── delete_context (remove) ──────────────────────────────────────────────

  server.tool(
    "delete_context",
    "Delete an entry from your vault by its ULID id. Removes the file from disk and cleans up the search index.",
    {
      id: z.string().describe("The entry ULID to delete"),
    },
    async ({ id }) => {
      if (!id?.trim()) return err("Required: id (non-empty string)", "INVALID_INPUT");
      await ensureIndexed();

      const entry = ctx.stmts.getEntryById.get(id);
      if (!entry) return err(`Entry not found: ${id}`, "NOT_FOUND");

      // Delete file from disk first (source of truth)
      if (entry.file_path) {
        try { unlinkSync(entry.file_path); } catch {}
      }

      // Delete vector embedding
      const rowidResult = ctx.stmts.getRowid.get(id);
      if (rowidResult?.rowid) {
        try { ctx.deleteVec(Number(rowidResult.rowid)); } catch {}
      }

      // Delete DB row (FTS trigger handles FTS cleanup)
      ctx.stmts.deleteEntry.run(id);

      return ok(`Deleted ${entry.kind}: ${entry.title || "(untitled)"} [${id}]`);
    }
  );

  // ─── context_status (diagnostics) ──────────────────────────────────────────

  server.tool(
    "context_status",
    "Show vault health: resolved config, file counts per kind, database size, and any issues. Use to verify setup or troubleshoot.",
    {},
    () => {
      const status = gatherVaultStatus(ctx);

      const hasIssues = status.stalePaths || (status.embeddingStatus?.missing > 0);
      const healthIcon = hasIssues ? "⚠" : "✓";

      const lines = [
        `## ${healthIcon} Vault Status`,
        ``,
        `Vault:     ${config.vaultDir} (${config.vaultDirExists ? status.fileCount + " files" : "missing"})`,
        `Database:  ${config.dbPath} (${status.dbSize})`,
        `Dev dir:   ${config.devDir}`,
        `Data dir:  ${config.dataDir}`,
        `Config:    ${config.configPath}`,
        `Resolved via: ${status.resolvedFrom}`,
        `Schema:    v5 (categories)`,
      ];

      if (status.embeddingStatus) {
        const { indexed, total, missing } = status.embeddingStatus;
        const pct = total > 0 ? Math.round((indexed / total) * 100) : 100;
        lines.push(`Embeddings: ${indexed}/${total} (${pct}%)`);
      }

      lines.push(``, `### Indexed`);

      if (status.kindCounts.length) {
        for (const { kind, c } of status.kindCounts) lines.push(`- ${c} ${kind}s`);
      } else {
        lines.push(`- (empty)`);
      }

      if (status.categoryCounts.length) {
        lines.push(``);
        lines.push(`### Categories`);
        for (const { category, c } of status.categoryCounts) lines.push(`- ${category}: ${c}`);
      }

      if (status.subdirs.length) {
        lines.push(``);
        lines.push(`### Disk Directories`);
        for (const { name, count } of status.subdirs) lines.push(`- ${name}/: ${count} files`);
      }

      if (status.stalePaths) {
        lines.push(``);
        lines.push(`### ⚠ Stale Paths`);
        lines.push(`DB contains ${status.staleCount} paths not matching current vault dir.`);
        lines.push(`Auto-reindex will fix this on next search or save.`);
      }

      return ok(lines.join("\n"));
    }
  );
}
