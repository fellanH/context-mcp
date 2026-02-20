/**
 * vault-api.js — REST API routes for vault operations.
 *
 * 7 endpoints exposing all vault operations as standard REST:
 *   GET    /api/vault/entries          List/browse with filters + pagination
 *   GET    /api/vault/entries/:id      Get single entry by ULID
 *   POST   /api/vault/entries          Create entry
 *   PUT    /api/vault/entries/:id      Partial update (omitted fields preserved)
 *   DELETE /api/vault/entries/:id      Delete entry + file + vector
 *   POST   /api/vault/search           Hybrid semantic + full-text search
 *   GET    /api/vault/status           Vault diagnostics + usage stats
 *
 * All endpoints require Authorization: Bearer cv_... and return JSON.
 *
 * In per-user DB mode (PER_USER_DB=true), each user's queries hit their own
 * isolated database. The WHERE user_id clauses are kept as defense-in-depth.
 */

import { Hono } from "hono";
import { unlinkSync } from "node:fs";
import { captureAndIndex, updateEntryFile } from "@context-vault/core/capture";
import { indexEntry } from "@context-vault/core/index";
import { hybridSearch } from "@context-vault/core/retrieve";
import { gatherVaultStatus } from "@context-vault/core/core/status";
import { normalizeKind } from "@context-vault/core/core/files";
import { categoryFor } from "@context-vault/core/core/categories";
import { isOverEntryLimit } from "../billing/stripe.js";
import { validateEntryInput } from "../validation/entry-validation.js";
import { getCachedUserCtx } from "../server/user-ctx.js";
import { bearerAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { generateOpenApiSpec } from "../api/openapi.js";

/**
 * Format a DB row into a clean API entry response.
 * Parses JSON strings for tags/meta and normalizes nulls.
 */
function formatEntry(row, decryptFn) {
  let { title, body, meta } = row;

  // Decrypt if encrypted
  if (decryptFn && row.body_encrypted) {
    const decrypted = decryptFn(row);
    body = decrypted.body;
    if (decrypted.title) title = decrypted.title;
    if (decrypted.meta) meta = JSON.stringify(decrypted.meta);
  }

  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: title || null,
    body: body || null,
    tags: row.tags ? JSON.parse(row.tags) : [],
    meta: meta ? (typeof meta === "string" ? JSON.parse(meta) : meta) : {},
    source: row.source || null,
    identity_key: row.identity_key || null,
    expires_at: row.expires_at || null,
    team_id: row.team_id || null,
    created_at: row.created_at,
  };
}

/**
 * Create vault REST API routes.
 *
 * @param {object} ctx — Shared server context
 * @param {string|null} masterSecret — VAULT_MASTER_SECRET
 */
export function createVaultApiRoutes(ctx, masterSecret) {
  const api = new Hono();

  // ─── OpenAPI spec (unauthenticated, public) ────────────────────────────────

  api.get("/api/vault/openapi.json", (c) => {
    const serverUrl = process.env.API_URL || process.env.PUBLIC_URL || null;
    const version = ctx.config?.version || "1.0.0";
    const spec = generateOpenApiSpec({ version, serverUrl });
    return c.json(spec);
  });

  // ─── Privacy policy (required for ChatGPT GPT publishing) ──────────────────

  api.get("/privacy", (c) => {
    return c.text(
      "Context Vault Privacy Policy\n\n" +
      "Context Vault stores knowledge entries you explicitly save. " +
      "Data is encrypted at rest (AES-256-GCM) and isolated per user. " +
      "We do not sell, share, or use your data for training. " +
      "You can export or delete all your data at any time via the API.\n\n" +
      "Contact: https://github.com/fellanH/context-vault"
    );
  });

  // All remaining vault API routes require auth + rate limiting
  api.use("/api/vault/entries/*", bearerAuth(), rateLimit());
  api.use("/api/vault/entries", bearerAuth(), rateLimit());
  api.use("/api/vault/search", bearerAuth(), rateLimit());
  api.use("/api/vault/status", bearerAuth(), rateLimit());

  // ─── GET /api/vault/entries — List/browse with filters + pagination ────────

  api.get("/api/vault/entries", async (c) => {
    const user = c.get("user");
    const teamId = c.req.query("team_id") || null;
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret, teamId ? { teamId } : null);

    const kind = c.req.query("kind") || null;
    const category = c.req.query("category") || null;
    const since = c.req.query("since") || null;
    const until = c.req.query("until") || null;
    const limit = Math.min(parseInt(c.req.query("limit") || "20", 10) || 20, 100);
    const offset = parseInt(c.req.query("offset") || "0", 10) || 0;

    const clauses = [];
    const params = [];

    if (userCtx.teamId) {
      // Team-scoped: show entries belonging to this team
      clauses.push("team_id = ?");
      params.push(userCtx.teamId);
    } else if (userCtx.userId) {
      // Defense-in-depth: still filter by user_id even in per-user DB mode
      clauses.push("user_id = ?");
      params.push(userCtx.userId);
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

    const total = userCtx.db.prepare(`SELECT COUNT(*) as c FROM vault ${where}`).get(...params).c;
    const rows = userCtx.db.prepare(
      `SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const entries = rows.map((row) => formatEntry(row, userCtx.decrypt));

    return c.json({ entries, total, limit, offset });
  });

  // ─── GET /api/vault/entries/:id — Get single entry by ULID ─────────────────

  api.get("/api/vault/entries/:id", async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);
    const id = c.req.param("id");

    const entry = userCtx.stmts.getEntryById.get(id);
    if (!entry) return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);

    // Ownership check (defense-in-depth in per-user DB mode)
    if (userCtx.userId && entry.user_id && entry.user_id !== userCtx.userId) {
      return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);
    }

    return c.json(formatEntry(entry, userCtx.decrypt));
  });

  // ─── POST /api/vault/entries — Create entry ────────────────────────────────

  api.post("/api/vault/entries", async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const validationError = validateEntryInput(data);
    if (validationError) {
      return c.json({ error: validationError.error, code: "INVALID_INPUT" }, validationError.status);
    }

    // Entity kind requires identity_key
    if (categoryFor(data.kind) === "entity" && !data.identity_key) {
      return c.json({ error: `Entity kind "${data.kind}" requires identity_key`, code: "MISSING_IDENTITY_KEY" }, 400);
    }

    // Entry limit enforcement
    if (userCtx.userId) {
      const { c: entryCount } = userCtx.db.prepare("SELECT COUNT(*) as c FROM vault WHERE user_id = ? OR user_id IS NULL").get(userCtx.userId);
      if (isOverEntryLimit(user.tier, entryCount)) {
        return c.json({ error: "Entry limit reached. Upgrade to Pro.", code: "LIMIT_EXCEEDED" }, 403);
      }
    }

    try {
      const entry = await captureAndIndex(
        userCtx,
        {
          kind: data.kind,
          title: data.title,
          body: data.body,
          meta: data.meta,
          tags: data.tags,
          source: data.source || "rest-api",
          identity_key: data.identity_key,
          expires_at: data.expires_at,
          userId: userCtx.userId,
          teamId: data.team_id || null,
        },
        indexEntry
      );

      return c.json(formatEntry(userCtx.stmts.getEntryById.get(entry.id), userCtx.decrypt), 201);
    } catch (err) {
      console.error(`[vault-api] Create entry error: ${err.message}`);
      return c.json({ error: "Failed to create entry", code: "CREATE_FAILED" }, 500);
    }
  });

  // ─── PUT /api/vault/entries/:id — Partial update ───────────────────────────

  api.put("/api/vault/entries/:id", async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);
    const id = c.req.param("id");

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);

    const validationError = validateEntryInput(data, { requireKind: false, requireBody: false });
    if (validationError) {
      return c.json({ error: validationError.error, code: "INVALID_INPUT" }, validationError.status);
    }

    const existing = userCtx.stmts.getEntryById.get(id);
    if (!existing) return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);

    // Ownership check
    if (userCtx.userId && existing.user_id && existing.user_id !== userCtx.userId) {
      return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);
    }

    // Cannot change kind or identity_key
    if (data.kind && normalizeKind(data.kind) !== existing.kind) {
      return c.json({ error: `Cannot change kind (current: "${existing.kind}"). Delete and re-create instead.`, code: "INVALID_UPDATE" }, 400);
    }
    if (data.identity_key && data.identity_key !== existing.identity_key) {
      return c.json({ error: `Cannot change identity_key. Delete and re-create instead.`, code: "INVALID_UPDATE" }, 400);
    }

    // Decrypt existing entry before merge if encrypted
    if (userCtx.decrypt && existing.body_encrypted) {
      const decrypted = userCtx.decrypt(existing);
      existing.body = decrypted.body;
      if (decrypted.title) existing.title = decrypted.title;
      if (decrypted.meta) existing.meta = JSON.stringify(decrypted.meta);
    }

    try {
      const entry = updateEntryFile(userCtx, existing, {
        title: data.title,
        body: data.body,
        tags: data.tags,
        meta: data.meta,
        source: data.source,
        expires_at: data.expires_at,
      });
      await indexEntry(userCtx, entry);

      return c.json(formatEntry(userCtx.stmts.getEntryById.get(id), userCtx.decrypt));
    } catch (err) {
      console.error(`[vault-api] Update entry error: ${err.message}`);
      return c.json({ error: "Failed to update entry", code: "UPDATE_FAILED" }, 500);
    }
  });

  // ─── DELETE /api/vault/entries/:id — Delete entry + file + vector ──────────

  api.delete("/api/vault/entries/:id", async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);
    const id = c.req.param("id");

    const entry = userCtx.stmts.getEntryById.get(id);
    if (!entry) return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);

    // Ownership check
    if (userCtx.userId && entry.user_id && entry.user_id !== userCtx.userId) {
      return c.json({ error: "Entry not found", code: "NOT_FOUND" }, 404);
    }

    // Delete file from disk first (source of truth)
    if (entry.file_path) {
      try { unlinkSync(entry.file_path); } catch {}
    }

    // Delete vector embedding
    const rowidResult = userCtx.stmts.getRowid.get(id);
    if (rowidResult?.rowid) {
      try { userCtx.deleteVec(Number(rowidResult.rowid)); } catch {}
    }

    // Delete DB row (FTS trigger handles FTS cleanup)
    userCtx.stmts.deleteEntry.run(id);

    return c.json({ deleted: true, id, kind: entry.kind, title: entry.title || null });
  });

  // ─── POST /api/vault/search — Hybrid semantic + full-text search ───────────

  api.post("/api/vault/search", async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);

    const data = await c.req.json().catch(() => null);
    if (!data) return c.json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
    if (!data.query?.trim()) return c.json({ error: "query is required", code: "INVALID_INPUT" }, 400);

    const limit = Math.min(parseInt(data.limit || 20, 10) || 20, 100);
    const offset = parseInt(data.offset || 0, 10) || 0;

    try {
      const results = await hybridSearch(userCtx, data.query, {
        kindFilter: data.kind ? normalizeKind(data.kind) : null,
        categoryFilter: data.category || null,
        since: data.since || null,
        until: data.until || null,
        limit,
        offset,
        decayDays: userCtx.config.eventDecayDays || 30,
        userIdFilter: data.team_id ? null : userCtx.userId,
        teamIdFilter: data.team_id || null,
      });

      // Decrypt and format results
      const formatted = results.map((row) => {
        const entry = formatEntry(row, userCtx.decrypt);
        entry.score = Math.round(row.score * 1000) / 1000;
        return entry;
      });

      return c.json({ results: formatted, count: formatted.length, query: data.query });
    } catch (err) {
      console.error(`[vault-api] Search error: ${err.message}`);
      return c.json({ error: "Search failed", code: "SEARCH_FAILED" }, 500);
    }
  });

  // ─── POST /api/vault/import/bulk — Bulk import entries ──────────────────────

  api.post("/api/vault/import/bulk", bearerAuth(), rateLimit(), async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);

    const data = await c.req.json().catch(() => null);
    if (!data || !Array.isArray(data.entries)) {
      return c.json({ error: "Invalid body — expected { entries: [...] }", code: "INVALID_INPUT" }, 400);
    }

    if (data.entries.length > 500) {
      return c.json({ error: "Maximum 500 entries per request", code: "LIMIT_EXCEEDED" }, 400);
    }

    // Entry limit enforcement
    if (userCtx.userId) {
      const { c: entryCount } = userCtx.db.prepare("SELECT COUNT(*) as c FROM vault WHERE user_id = ? OR user_id IS NULL").get(userCtx.userId);
      const remaining = isOverEntryLimit(user.tier, entryCount) ? 0 : (user.tier === "free" ? 100 - entryCount : Infinity);
      if (remaining <= 0) {
        return c.json({ error: "Entry limit reached. Upgrade to Pro.", code: "LIMIT_EXCEEDED" }, 403);
      }
    }

    let imported = 0;
    let failed = 0;
    const errors = [];

    for (const entry of data.entries) {
      try {
        const validationError = validateEntryInput(entry);
        if (validationError) {
          failed++;
          errors.push(`${entry.title || entry.id || "unknown"}: ${validationError.error}`);
          continue;
        }

        await captureAndIndex(
          userCtx,
          {
            kind: entry.kind,
            title: entry.title,
            body: entry.body,
            meta: entry.meta,
            tags: entry.tags,
            source: entry.source || "bulk-import",
            identity_key: entry.identity_key,
            expires_at: entry.expires_at,
            userId: userCtx.userId,
          },
          indexEntry
        );
        imported++;
      } catch (err) {
        failed++;
        errors.push(`${entry.title || entry.id || "unknown"}: ${err.message}`);
      }
    }

    return c.json({ imported, failed, errors: errors.slice(0, 10) });
  });

  // NOTE: GET /api/vault/export is defined in management.js (with Pro tier check)

  // ─── POST /api/vault/ingest — Fetch URL and save as entry ─────────────────

  api.post("/api/vault/ingest", bearerAuth(), rateLimit(), async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);

    const data = await c.req.json().catch(() => null);
    if (!data?.url) return c.json({ error: "url is required", code: "INVALID_INPUT" }, 400);

    try {
      const { ingestUrl } = await import("@context-vault/core/capture/ingest-url");
      const entry = await ingestUrl(data.url, { kind: data.kind, tags: data.tags });
      const result = await captureAndIndex(
        userCtx,
        { ...entry, userId: userCtx.userId },
        indexEntry
      );
      return c.json(formatEntry(userCtx.stmts.getEntryById.get(result.id), userCtx.decrypt), 201);
    } catch (err) {
      return c.json({ error: `Ingestion failed: ${err.message}`, code: "INGEST_FAILED" }, 500);
    }
  });

  // ─── GET /api/vault/manifest — Lightweight entry list for sync ────────────

  api.get("/api/vault/manifest", bearerAuth(), rateLimit(), async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);

    const clauses = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
    const params = [];
    if (userCtx.userId) {
      clauses.push("(user_id = ? OR user_id IS NULL)");
      params.push(userCtx.userId);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const rows = userCtx.db.prepare(`SELECT id, kind, title, created_at FROM vault ${where} ORDER BY created_at DESC`).all(...params);
    return c.json({ entries: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title || null, created_at: r.created_at })) });
  });

  // ─── GET /api/vault/status — Vault diagnostics + usage stats ───────────────

  api.get("/api/vault/status", async (c) => {
    const user = c.get("user");
    const userCtx = await getCachedUserCtx(ctx, user, masterSecret);

    const status = gatherVaultStatus(userCtx, { userId: userCtx.userId });

    return c.json({
      entries: {
        total: status.kindCounts.reduce((sum, k) => sum + k.c, 0),
        by_kind: Object.fromEntries(status.kindCounts.map((k) => [k.kind, k.c])),
        by_category: Object.fromEntries(status.categoryCounts.map((k) => [k.category, k.c])),
      },
      files: {
        total: status.fileCount,
        directories: status.subdirs,
      },
      database: {
        size: status.dbSize,
        size_bytes: status.dbSizeBytes,
        stale_paths: status.staleCount,
        expired: status.expiredCount,
      },
      embeddings: status.embeddingStatus,
      embed_model_available: status.embedModelAvailable,
      health: status.errors.length === 0 && !status.stalePaths ? "ok" : "degraded",
      errors: status.errors,
    });
  });

  return api;
}
