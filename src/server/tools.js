/**
 * tools.js — MCP tool registrations
 *
 * Three tools: save_context (write), get_context (read), context_status (diag).
 * Auto-reindex runs transparently on first tool call per session.
 */

import { z } from "zod";
import { existsSync } from "node:fs";

import { captureAndIndex } from "../capture/index.js";
import { hybridSearch } from "../retrieve/index.js";
import { reindex, indexEntry } from "../index/index.js";
import { gatherVaultStatus } from "../core/status.js";
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
        } else {
          reindexPromise = null; // Allow retry on next tool call
        }
      });
    return reindexPromise;
  }

  // ─── get_context (read) ────────────────────────────────────────────────────

  server.tool(
    "get_context",
    "Search your knowledge vault. Returns entries ranked by relevance using hybrid full-text + semantic search. Use this to find insights, decisions, patterns, or any saved context.",
    {
      query: z.string().describe("Search query (natural language or keywords)"),
      kind: z.string().optional().describe("Filter by kind (e.g. 'insight', 'decision', 'pattern')"),
      tags: z.array(z.string()).optional().describe("Filter by tags (entries must match at least one)"),
      limit: z.number().optional().describe("Max results to return (default 10)"),
    },
    async ({ query, kind, tags, limit }) => {
      await ensureIndexed();

      const kindFilter = kind ? kind.replace(/s$/, "") : null;
      const sorted = await hybridSearch(ctx, query, { kindFilter, limit: limit || 10 });

      // Post-filter by tags if provided
      const filtered = tags?.length
        ? sorted.filter((r) => {
            const entryTags = r.tags ? JSON.parse(r.tags) : [];
            return tags.some((t) => entryTags.includes(t));
          })
        : sorted;

      if (!filtered.length) return ok("No results found for: " + query);

      const lines = [`## Results for "${query}" (${filtered.length} matches)\n`];
      for (const r of filtered) {
        const meta = r.meta ? JSON.parse(r.meta) : {};
        lines.push(`### ${r.title || "(untitled)"} [${r.kind}]`);
        lines.push(`Score: ${r.score.toFixed(3)} | Tags: ${r.tags || "none"} | File: ${r.file_path || "n/a"}`);
        lines.push(r.body?.slice(0, 300) + (r.body?.length > 300 ? "..." : ""));
        lines.push("");
      }
      return ok(lines.join("\n"));
    }
  );

  // ─── save_context (write) ──────────────────────────────────────────────────

  server.tool(
    "save_context",
    "Save knowledge to your vault. Creates a .md file and indexes it for search. Use for any kind of context: insights, decisions, patterns, references, or any custom kind.",
    {
      kind: z.string().describe("Entry kind — determines folder (e.g. 'insight', 'decision', 'pattern', 'reference', or any custom kind)"),
      title: z.string().optional().describe("Entry title (optional for insights)"),
      body: z.string().describe("Main content"),
      tags: z.array(z.string()).optional().describe("Tags for categorization and search"),
      meta: z.any().optional().describe("Additional structured metadata (JSON object, e.g. { language: 'js', status: 'accepted' })"),
      folder: z.string().optional().describe("Subfolder within the kind directory (e.g. 'react/hooks')"),
      source: z.string().optional().describe("Where this knowledge came from"),
    },
    async ({ kind, title, body, tags, meta, folder, source }) => {
      const vaultErr = ensureVaultExists(config);
      if (vaultErr) return vaultErr;
      const kindErr = ensureValidKind(kind);
      if (kindErr) return kindErr;
      if (!body?.trim()) return err("Required: body (non-empty string)", "INVALID_INPUT");

      await ensureIndexed();

      const mergedMeta = { ...(meta || {}) };
      if (folder) mergedMeta.folder = folder;
      const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

      const entry = await captureAndIndex(ctx, { kind, title, body, meta: finalMeta, tags, source, folder }, indexEntry);
      return ok(`Saved ${kind} ${entry.id}\nFile: ${entry.filePath}${title ? "\nTitle: " + title : ""}`);
    }
  );

  // ─── context_status (diagnostics) ──────────────────────────────────────────

  server.tool(
    "context_status",
    "Show vault health: resolved config, file counts per kind, database size, and any issues. Use to verify setup or troubleshoot.",
    {},
    () => {
      const status = gatherVaultStatus(ctx);

      const lines = [
        `## Vault Status`,
        ``,
        `Vault:     ${config.vaultDir} (exists: ${config.vaultDirExists}, ${status.fileCount} files)`,
        `Database:  ${config.dbPath} (exists: ${existsSync(config.dbPath)}, ${status.dbSize})`,
        `Dev dir:   ${config.devDir}`,
        `Data dir:  ${config.dataDir}`,
        `Config:    ${config.configPath}`,
        `Resolved via: ${status.resolvedFrom}`,
        `Schema:    v4 (vault table)`,
        ``,
        `### Indexed`,
      ];

      if (status.kindCounts.length) {
        for (const { kind, c } of status.kindCounts) lines.push(`- ${c} ${kind}s`);
      } else {
        lines.push(`- (empty)`);
      }

      if (status.subdirs.length) {
        lines.push(``);
        lines.push(`### Disk Directories`);
        for (const { name, count } of status.subdirs) lines.push(`- ${name}/: ${count} files`);
      }

      if (status.stalePaths) {
        lines.push(``);
        lines.push(`### Stale Paths Detected`);
        lines.push(`DB contains ${status.staleCount} paths not matching current vault dir.`);
        lines.push(`Auto-reindex will fix this on next search or save.`);
      }

      if (status.embeddingStatus) {
        const { indexed, total, missing } = status.embeddingStatus;
        if (missing > 0) {
          lines.push(``);
          lines.push(`### Embeddings`);
          lines.push(`${indexed}/${total} entries have embeddings (${missing} missing)`);
        }
      }

      return ok(lines.join("\n"));
    }
  );
}
