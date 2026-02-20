/**
 * tools.js — MCP tool registrations
 *
 * Six tools: save_context (write/update), get_context (search), list_context (browse),
 * delete_context (remove), submit_feedback (bug/feature reports), context_status (diag).
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
import { isEmbedAvailable } from "../index/embed.js";

/**
 * Register all MCP tools on the server.
 *
 * @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server
 * @param {{ db, config, stmts, embed, insertVec, deleteVec }} ctx
 */
const TOOL_TIMEOUT_MS = 60_000;

export function registerTools(server, ctx) {
  const { config } = ctx;
  const userId = ctx.userId !== undefined ? ctx.userId : undefined;

  // ─── Tool wrapper: tracks in-flight ops for graceful shutdown + timeout ────

  function tracked(handler) {
    return async (...args) => {
      if (ctx.activeOps) ctx.activeOps.count++;
      let timer;
      try {
        return await Promise.race([
          Promise.resolve(handler(...args)),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("TOOL_TIMEOUT")), TOOL_TIMEOUT_MS);
          }),
        ]);
      } catch (e) {
        if (e.message === "TOOL_TIMEOUT") {
          return err("Tool timed out after 60s. Try a simpler query or run `context-vault reindex` first.", "TIMEOUT");
        }
        throw e;
      } finally {
        clearTimeout(timer);
        if (ctx.activeOps) ctx.activeOps.count--;
      }
    };
  }

  // ─── Auto-Reindex (runs once per session, on first tool call) ──────────────

  // In hosted mode, skip reindex — DB is always in sync via writeEntry→indexEntry
  let reindexDone = userId !== undefined ? true : false;
  let reindexPromise = null;
  let reindexAttempts = 0;
  let reindexFailed = false;
  const MAX_REINDEX_ATTEMPTS = 2;

  async function ensureIndexed() {
    if (reindexDone) return;
    if (reindexPromise) return reindexPromise;
    // Assign promise synchronously to prevent concurrent calls from both entering reindex()
    const promise = reindex(ctx, { fullSync: true })
      .then((stats) => {
        reindexDone = true;
        const total = stats.added + stats.updated + stats.removed;
        if (total > 0) {
          console.error(`[context-vault] Auto-reindex: +${stats.added} ~${stats.updated} -${stats.removed} (${stats.unchanged} unchanged)`);
        }
      })
      .catch((e) => {
        reindexAttempts++;
        console.error(`[context-vault] Auto-reindex failed (attempt ${reindexAttempts}/${MAX_REINDEX_ATTEMPTS}): ${e.message}`);
        if (reindexAttempts >= MAX_REINDEX_ATTEMPTS) {
          console.error(`[context-vault] Giving up on auto-reindex. Run \`context-vault reindex\` manually to diagnose.`);
          reindexDone = true;
          reindexFailed = true;
        } else {
          reindexPromise = null; // Allow retry on next tool call
        }
      });
    reindexPromise = promise;
    return reindexPromise;
  }

  // ─── get_context (search) ──────────────────────────────────────────────────

  server.tool(
    "get_context",
    "Search your knowledge vault. Returns entries ranked by relevance using hybrid full-text + semantic search. Use this to find insights, decisions, patterns, or any saved context. Each result includes an `id` you can use with save_context or delete_context.",
    {
      query: z.string().optional().describe("Search query (natural language or keywords). Optional if filters (tags, kind, category) are provided."),
      kind: z.string().optional().describe("Filter by kind (e.g. 'insight', 'decision', 'pattern')"),
      category: z.enum(["knowledge", "entity", "event"]).optional().describe("Filter by category"),
      identity_key: z.string().optional().describe("For entity lookup: exact match on identity key. Requires kind."),
      tags: z.array(z.string()).optional().describe("Filter by tags (entries must match at least one)"),
      since: z.string().optional().describe("ISO date, return entries created after this"),
      until: z.string().optional().describe("ISO date, return entries created before this"),
      limit: z.number().optional().describe("Max results to return (default 10)"),
    },
    tracked(async ({ query, kind, category, identity_key, tags, since, until, limit }) => {
      const hasQuery = query?.trim();
      const hasFilters = kind || category || tags?.length || since || until || identity_key;
      if (!hasQuery && !hasFilters) return err("Required: query or at least one filter (kind, category, tags, since, until, identity_key)", "INVALID_INPUT");
      await ensureIndexed();

      const kindFilter = kind ? normalizeKind(kind) : null;

      // Gap 1: Entity exact-match by identity_key
      if (identity_key) {
        if (!kindFilter) return err("identity_key requires kind to be specified", "INVALID_INPUT");
        const match = ctx.stmts.getByIdentityKey.get(kindFilter, identity_key, userId !== undefined ? userId : null);
        if (match) {
          const entryTags = match.tags ? JSON.parse(match.tags) : [];
          const tagStr = entryTags.length ? entryTags.join(", ") : "none";
          const relPath = match.file_path && config.vaultDir ? match.file_path.replace(config.vaultDir + "/", "") : match.file_path || "n/a";
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
      const effectiveCategory = category || (kindFilter ? categoryFor(kindFilter) : null);
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
      const fetchLimit = tags?.length ? effectiveLimit * 10 : effectiveLimit;

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
        });

        // Post-filter by tags if provided, then apply requested limit
        filtered = tags?.length
          ? sorted.filter((r) => {
              const entryTags = r.tags ? JSON.parse(r.tags) : [];
              return tags.some((t) => entryTags.includes(t));
            }).slice(0, effectiveLimit)
          : sorted;
      } else {
        // Filter-only mode (no query, use SQL directly)
        const clauses = [];
        const params = [];
        if (userId !== undefined) { clauses.push("user_id = ?"); params.push(userId); }
        if (kindFilter) { clauses.push("kind = ?"); params.push(kindFilter); }
        if (category) { clauses.push("category = ?"); params.push(category); }
        if (effectiveSince) { clauses.push("created_at >= ?"); params.push(effectiveSince); }
        if (effectiveUntil) { clauses.push("created_at <= ?"); params.push(effectiveUntil); }
        clauses.push("(expires_at IS NULL OR expires_at > datetime('now'))");
        const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
        params.push(fetchLimit);
        const rows = ctx.db.prepare(`SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT ?`).all(...params);

        // Post-filter by tags if provided, then apply requested limit
        filtered = tags?.length
          ? rows.filter((r) => {
              const entryTags = r.tags ? JSON.parse(r.tags) : [];
              return tags.some((t) => entryTags.includes(t));
            }).slice(0, effectiveLimit)
          : rows;

        // Add score field for consistent output
        for (const r of filtered) r.score = 0;
      }

      if (!filtered.length) return ok(hasQuery ? "No results found for: " + query : "No entries found matching the given filters.");

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
      if (reindexFailed) lines.push(`> **Warning:** Auto-reindex failed. Results may be stale. Run \`context-vault reindex\` to fix.\n`);
      if (hasQuery && isEmbedAvailable() === false) lines.push(`> **Note:** Semantic search unavailable — results ranked by keyword match only. Run \`context-vault setup\` to download the embedding model.\n`);
      const heading = hasQuery ? `Results for "${query}"` : "Filtered entries";
      lines.push(`## ${heading} (${filtered.length} matches)\n`);
      for (let i = 0; i < filtered.length; i++) {
        const r = filtered[i];
        const entryTags = r.tags ? JSON.parse(r.tags) : [];
        const tagStr = entryTags.length ? entryTags.join(", ") : "none";
        const relPath = r.file_path && config.vaultDir ? r.file_path.replace(config.vaultDir + "/", "") : r.file_path || "n/a";
        lines.push(`### [${i + 1}/${filtered.length}] ${r.title || "(untitled)"} [${r.kind}/${r.category}]`);
        lines.push(`${r.score.toFixed(3)} · ${tagStr} · ${relPath} · id: \`${r.id}\``);
        lines.push(r.body?.slice(0, 300) + (r.body?.length > 300 ? "..." : ""));
        lines.push("");
      }
      if (autoWindowed) {
        lines.push(`_Showing events from last ${config.eventDecayDays || 30} days. Use since/until for custom range._`);
      }
      return ok(lines.join("\n"));
    })
  );

  // ─── save_context (write / update) ────────────────────────────────────────

  server.tool(
    "save_context",
    "Save knowledge to your vault. Creates a .md file and indexes it for search. Use for any kind of context: insights, decisions, patterns, references, or any custom kind. To update an existing entry, pass its `id` — omitted fields are preserved.",
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
    tracked(async ({ id, kind, title, body, tags, meta, folder, source, identity_key, expires_at }) => {
      const vaultErr = ensureVaultExists(config);
      if (vaultErr) return vaultErr;

      // ── Update mode ──
      if (id) {
        await ensureIndexed();

        const existing = ctx.stmts.getEntryById.get(id);
        if (!existing) return err(`Entry not found: ${id}`, "NOT_FOUND");

        // Ownership check: don't leak existence across users
        if (userId !== undefined && existing.user_id !== userId) {
          return err(`Entry not found: ${id}`, "NOT_FOUND");
        }

        if (kind && normalizeKind(kind) !== existing.kind) {
          return err(`Cannot change kind (current: "${existing.kind}"). Delete and re-create instead.`, "INVALID_UPDATE");
        }
        if (identity_key && identity_key !== existing.identity_key) {
          return err(`Cannot change identity_key (current: "${existing.identity_key}"). Delete and re-create instead.`, "INVALID_UPDATE");
        }

        // Decrypt existing entry before merge if encrypted
        if (ctx.decrypt && existing.body_encrypted) {
          const decrypted = await ctx.decrypt(existing);
          existing.body = decrypted.body;
          if (decrypted.title) existing.title = decrypted.title;
          if (decrypted.meta) existing.meta = JSON.stringify(decrypted.meta);
        }

        const entry = updateEntryFile(ctx, existing, { title, body, tags, meta, source, expires_at });
        await indexEntry(ctx, entry);
        const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
        const parts = [`✓ Updated ${entry.kind} → ${relPath}`, `  id: ${entry.id}`];
        if (entry.title) parts.push(`  title: ${entry.title}`);
        const entryTags = entry.tags || [];
        if (entryTags.length) parts.push(`  tags: ${entryTags.join(", ")}`);
        parts.push("", "_Search with get_context to verify changes._");
        return ok(parts.join("\n"));
      }

      // ── Create mode ──
      if (!kind) return err("Required: kind (for new entries)", "INVALID_INPUT");
      const kindErr = ensureValidKind(kind);
      if (kindErr) return kindErr;
      if (!body?.trim()) return err("Required: body (for new entries)", "INVALID_INPUT");

      // Normalize kind to canonical singular form (e.g. "insights" → "insight")
      const normalizedKind = normalizeKind(kind);

      if (categoryFor(normalizedKind) === "entity" && !identity_key) {
        return err(`Entity kind "${normalizedKind}" requires identity_key`, "MISSING_IDENTITY_KEY");
      }

      // Hosted tier limit enforcement (skipped in local mode — no checkLimits on ctx)
      if (ctx.checkLimits) {
        const usage = ctx.checkLimits();
        if (usage.entryCount >= usage.maxEntries) {
          return err(`Entry limit reached (${usage.maxEntries}). Upgrade to Pro for unlimited entries.`, "LIMIT_EXCEEDED");
        }
        if (usage.storageMb >= usage.maxStorageMb) {
          return err(`Storage limit reached (${usage.maxStorageMb} MB). Upgrade to Pro for more storage.`, "LIMIT_EXCEEDED");
        }
      }

      await ensureIndexed();

      const mergedMeta = { ...(meta || {}) };
      if (folder) mergedMeta.folder = folder;
      const finalMeta = Object.keys(mergedMeta).length ? mergedMeta : undefined;

      const entry = await captureAndIndex(ctx, { kind: normalizedKind, title, body, meta: finalMeta, tags, source, folder, identity_key, expires_at, userId }, indexEntry);
      const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
      const parts = [`✓ Saved ${normalizedKind} → ${relPath}`, `  id: ${entry.id}`];
      if (title) parts.push(`  title: ${title}`);
      if (tags?.length) parts.push(`  tags: ${tags.join(", ")}`);
      parts.push("", "_Use this id to update or delete later._");
      return ok(parts.join("\n"));
    })
  );

  // ─── list_context (browse) ────────────────────────────────────────────────

  server.tool(
    "list_context",
    "Browse vault entries without a search query. Returns id, title, kind, category, tags, created_at. Use get_context with a query for semantic search. Use this to browse by tags or find recent entries.",
    {
      kind: z.string().optional().describe("Filter by kind (e.g. 'insight', 'decision', 'pattern')"),
      category: z.enum(["knowledge", "entity", "event"]).optional().describe("Filter by category"),
      tags: z.array(z.string()).optional().describe("Filter by tags (entries must match at least one)"),
      since: z.string().optional().describe("ISO date, return entries created after this"),
      until: z.string().optional().describe("ISO date, return entries created before this"),
      limit: z.number().optional().describe("Max results to return (default 20, max 100)"),
      offset: z.number().optional().describe("Skip first N results for pagination"),
    },
    tracked(async ({ kind, category, tags, since, until, limit, offset }) => {
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
    })
  );

  // ─── delete_context (remove) ──────────────────────────────────────────────

  server.tool(
    "delete_context",
    "Delete an entry from your vault by its ULID id. Removes the file from disk and cleans up the search index.",
    {
      id: z.string().describe("The entry ULID to delete"),
    },
    tracked(async ({ id }) => {
      if (!id?.trim()) return err("Required: id (non-empty string)", "INVALID_INPUT");
      await ensureIndexed();

      const entry = ctx.stmts.getEntryById.get(id);
      if (!entry) return err(`Entry not found: ${id}`, "NOT_FOUND");

      // Ownership check: don't leak existence across users
      if (userId !== undefined && entry.user_id !== userId) {
        return err(`Entry not found: ${id}`, "NOT_FOUND");
      }

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
    })
  );

  // ─── submit_feedback (bug/feature reports) ────────────────────────────────

  server.tool(
    "submit_feedback",
    "Report a bug, request a feature, or suggest an improvement. Feedback is stored in the vault and triaged by the development pipeline.",
    {
      type: z.enum(["bug", "feature", "improvement"]).describe("Type of feedback"),
      title: z.string().describe("Short summary of the feedback"),
      body: z.string().describe("Detailed description"),
      severity: z.enum(["low", "medium", "high"]).optional().describe("Severity level (default: medium)"),
    },
    tracked(async ({ type, title, body, severity }) => {
      const vaultErr = ensureVaultExists(config);
      if (vaultErr) return vaultErr;

      await ensureIndexed();

      const effectiveSeverity = severity || "medium";
      const entry = await captureAndIndex(
        ctx,
        {
          kind: "feedback",
          title,
          body,
          tags: [type, effectiveSeverity],
          source: "submit_feedback",
          meta: { feedback_type: type, severity: effectiveSeverity, status: "new" },
          userId,
        },
        indexEntry
      );

      const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
      return ok(`Feedback submitted: ${type} [${effectiveSeverity}] → ${relPath}\n  id: ${entry.id}\n  title: ${title}`);
    })
  );

  // ─── ingest_url (fetch URL and save) ────────────────────────────────────────

  server.tool(
    "ingest_url",
    "Fetch a URL, extract its readable content, and save it as a vault entry. Useful for saving articles, documentation, or web pages to your knowledge vault.",
    {
      url: z.string().describe("The URL to fetch and save"),
      kind: z.string().optional().describe("Entry kind (default: reference)"),
      tags: z.array(z.string()).optional().describe("Tags for the entry"),
    },
    tracked(async ({ url: targetUrl, kind, tags }) => {
      const vaultErr = ensureVaultExists(config);
      if (vaultErr) return vaultErr;

      if (!targetUrl?.trim()) return err("Required: url (non-empty string)", "INVALID_INPUT");

      await ensureIndexed();

      // Hosted tier limit enforcement
      if (ctx.checkLimits) {
        const usage = ctx.checkLimits();
        if (usage.entryCount >= usage.maxEntries) {
          return err(`Entry limit reached (${usage.maxEntries}). Upgrade to Pro for unlimited entries.`, "LIMIT_EXCEEDED");
        }
      }

      try {
        const { ingestUrl } = await import("../capture/ingest-url.js");
        const entryData = await ingestUrl(targetUrl, { kind, tags });
        const entry = await captureAndIndex(ctx, { ...entryData, userId }, indexEntry);
        const relPath = entry.filePath ? entry.filePath.replace(config.vaultDir + "/", "") : entry.filePath;
        const parts = [
          `✓ Ingested URL → ${relPath}`,
          `  id: ${entry.id}`,
          `  title: ${entry.title || "(untitled)"}`,
          `  source: ${entry.source || targetUrl}`,
        ];
        if (entry.tags?.length) parts.push(`  tags: ${entry.tags.join(", ")}`);
        parts.push(`  body: ${entry.body?.length || 0} chars`);
        parts.push("", "_Use this id to update or delete later._");
        return ok(parts.join("\n"));
      } catch (e) {
        return err(`Failed to ingest URL: ${e.message}`, "INGEST_FAILED");
      }
    })
  );

  // ─── context_status (diagnostics) ──────────────────────────────────────────

  server.tool(
    "context_status",
    "Show vault health: resolved config, file counts per kind, database size, and any issues. Use to verify setup or troubleshoot. Call this when a user asks about their vault or to debug search issues.",
    {},
    () => {
      const status = gatherVaultStatus(ctx, { userId });

      const hasIssues = status.stalePaths || (status.embeddingStatus?.missing > 0);
      const healthIcon = hasIssues ? "⚠" : "✓";

      const lines = [
        `## ${healthIcon} Vault Status (connected)`,
        ``,
        `Vault:     ${config.vaultDir} (${config.vaultDirExists ? status.fileCount + " files" : "missing"})`,
        `Database:  ${config.dbPath} (${status.dbSize})`,
        `Dev dir:   ${config.devDir}`,
        `Data dir:  ${config.dataDir}`,
        `Config:    ${config.configPath}`,
        `Resolved via: ${status.resolvedFrom}`,
        `Schema:    v6 (multi-tenancy)`,
      ];

      if (status.embeddingStatus) {
        const { indexed, total, missing } = status.embeddingStatus;
        const pct = total > 0 ? Math.round((indexed / total) * 100) : 100;
        lines.push(`Embeddings: ${indexed}/${total} (${pct}%)`);
      }
      if (status.embedModelAvailable === false) {
        lines.push(`Embed model: unavailable (semantic search disabled, FTS still works)`);
      } else if (status.embedModelAvailable === true) {
        lines.push(`Embed model: loaded`);
      }
      lines.push(`Decay:     ${config.eventDecayDays} days (event recency window)`);
      if (status.expiredCount > 0) {
        lines.push(`Expired:   ${status.expiredCount} entries (pruned on next reindex)`);
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

      // Suggested actions
      const actions = [];
      if (status.stalePaths) actions.push("- Run `context-vault reindex` to fix stale paths");
      if (status.embeddingStatus?.missing > 0) actions.push("- Run `context-vault reindex` to generate missing embeddings");
      if (!config.vaultDirExists) actions.push("- Run `context-vault setup` to create the vault directory");
      if (status.kindCounts.length === 0 && config.vaultDirExists) actions.push("- Use `save_context` to add your first entry");

      if (actions.length) {
        lines.push("", "### Suggested Actions", ...actions);
      }

      return ok(lines.join("\n"));
    }
  );
}
