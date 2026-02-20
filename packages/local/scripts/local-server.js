#!/usr/bin/env node
/**
 * local-server.js — Local mode: serves app + vault API with no auth.
 *
 * Uses local SQLite vault. No authentication required.
 * Usage: node local-server.js [--port 3141]
 */

import { createServer } from "node:http";
import {
  createReadStream,
  existsSync,
  statSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";
import { execSync } from "node:child_process";
import { resolveConfig } from "@context-vault/core/core/config";
import {
  initDatabase,
  prepareStatements,
  insertVec,
  deleteVec,
} from "@context-vault/core/index/db";
import { embed } from "@context-vault/core/index/embed";
import { captureAndIndex, updateEntryFile } from "@context-vault/core/capture";
import { indexEntry } from "@context-vault/core/index";
import { hybridSearch } from "@context-vault/core/retrieve";
import { gatherVaultStatus } from "@context-vault/core/core/status";
import { normalizeKind } from "@context-vault/core/core/files";
import { categoryFor } from "@context-vault/core/core/categories";
import { parseFile } from "@context-vault/core/capture/importers";
import { importEntries } from "@context-vault/core/capture/import-pipeline";
import { ingestUrl } from "@context-vault/core/capture/ingest-url";
import {
  buildLocalManifest,
  fetchRemoteManifest,
  computeSyncPlan,
  executeSync,
} from "@context-vault/core/sync";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOCAL_ROOT = resolve(__dirname, "..");

// Try bundled path first (npm install), then workspace path (local dev)
const bundledDist = resolve(LOCAL_ROOT, "app-dist");
const workspaceDist = resolve(LOCAL_ROOT, "..", "app", "dist");
const APP_DIST = existsSync(join(bundledDist, "index.html"))
  ? bundledDist
  : workspaceDist;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
};

function formatEntry(row) {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title || null,
    body: row.body || null,
    tags: row.tags ? JSON.parse(row.tags) : [],
    meta: row.meta
      ? typeof row.meta === "string"
        ? JSON.parse(row.meta)
        : row.meta
      : {},
    source: row.source || null,
    identity_key: row.identity_key || null,
    expires_at: row.expires_at || null,
    created_at: row.created_at,
  };
}

function validateEntry(data, { requireKind = true, requireBody = true } = {}) {
  if (requireKind && !data.kind)
    return { error: "kind is required", status: 400 };
  if (data.kind && !/^[a-z0-9-]+$/.test(data.kind))
    return {
      error: "kind must be lowercase alphanumeric/hyphens",
      status: 400,
    };
  if (requireBody && !data.body)
    return { error: "body is required", status: 400 };
  if (data.body && data.body.length > 100 * 1024)
    return { error: "body max 100KB", status: 400 };
  if (categoryFor(data.kind) === "entity" && !data.identity_key)
    return {
      error: `Entity kind "${data.kind}" requires identity_key`,
      status: 400,
    };
  return null;
}

function getAllowedOrigin(req) {
  const origin = req.headers["origin"];
  if (!origin) return null;
  const lower = origin.toLowerCase();
  if (
    lower === "https://context-vault.com" ||
    lower === "https://www.context-vault.com"
  )
    return origin;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(lower)) return origin;
  return null;
}

async function main() {
  const portArg = process.argv.find((a) => a.startsWith("--port="));
  const portVal = portArg
    ? portArg.split("=")[1]
    : process.argv[process.argv.indexOf("--port") + 1];
  const port = parseInt(portVal || "3141", 10);

  const config = resolveConfig();
  config.vaultDirExists = existsSync(config.vaultDir);
  let db = await initDatabase(config.dbPath);
  let stmts = prepareStatements(db);

  const state = {
    db,
    config,
    stmts,
    embed,
    get ctx() {
      return {
        db: state.db,
        config: state.config,
        stmts: state.stmts,
        embed: state.embed,
        insertVec: (r, e) => insertVec(state.stmts, r, e),
        deleteVec: (r) => deleteVec(state.stmts, r),
        userId: null,
      };
    },
  };

  const server = createServer(async (req, res) => {
    const url = req.url?.replace(/\?.*$/, "") || "/";

    // ─── CORS ──────────────────────────────────────────────────────────────────
    const allowedOrigin = getAllowedOrigin(req);
    const corsHeaders = allowedOrigin
      ? {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          Vary: "Origin",
        }
      : { Vary: "Origin" };

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    const json = (data, status = 200) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        ...corsHeaders,
      });
      res.end(JSON.stringify(data));
    };

    const readBody = () =>
      new Promise((resolve) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          try {
            resolve(body ? JSON.parse(body) : null);
          } catch {
            resolve(null);
          }
        });
      });

    const ctx = state.ctx;

    // ─── API: POST /api/local/browse — native folder picker dialog ────────────
    if (url === "/api/local/browse" && req.method === "POST") {
      const os = platform();
      try {
        let selected;
        if (os === "darwin") {
          selected = execSync(
            `osascript -e 'POSIX path of (choose folder with prompt "Select vault folder")'`,
            { encoding: "utf-8", timeout: 30000 },
          ).trim();
        } else if (os === "linux") {
          selected = execSync(
            `zenity --file-selection --directory --title="Select vault folder" 2>/dev/null`,
            { encoding: "utf-8", timeout: 30000 },
          ).trim();
        } else {
          return json(
            { error: "Folder picker not supported on this platform" },
            501,
          );
        }

        if (selected) {
          return json({ path: selected });
        }
        return json({ path: null, cancelled: true });
      } catch {
        // User cancelled the dialog or command failed
        return json({ path: null, cancelled: true });
      }
    }

    // ─── API: POST /api/local/connect — switch to a local vault folder ───────
    if (url === "/api/local/connect" && req.method === "POST") {
      const data = await readBody();
      if (!data?.vaultDir?.trim())
        return json(
          { error: "vaultDir is required", code: "INVALID_INPUT" },
          400,
        );
      let vaultPath = data.vaultDir.trim().replace(/^~/, homedir());
      vaultPath = resolve(vaultPath);
      if (!existsSync(vaultPath))
        return json(
          { error: "Vault folder not found", code: "NOT_FOUND" },
          404,
        );
      if (!statSync(vaultPath).isDirectory())
        return json(
          { error: "Path is not a directory", code: "INVALID_INPUT" },
          400,
        );
      try {
        try {
          state.db.close();
        } catch {}
        const newConfig = {
          ...state.config,
          vaultDir: vaultPath,
          dbPath: join(vaultPath, ".context-vault.db"),
          vaultDirExists: true,
        };
        state.config = newConfig;
        state.db = await initDatabase(newConfig.dbPath);
        state.stmts = prepareStatements(state.db);
        console.log(`[context-vault] Switched to vault: ${vaultPath}`);
        return json({
          userId: "local",
          email: "local@localhost",
          name: "Local",
          tier: "free",
          createdAt: new Date().toISOString(),
        });
      } catch (e) {
        console.error(`[local-server] Connect error: ${e.message}`);
        return json(
          { error: `Failed to connect: ${e.message}`, code: "CONNECT_FAILED" },
          500,
        );
      }
    }

    // ─── API: GET /api/health — lightweight liveness check ────────────────────
    if (url === "/api/health" && req.method === "GET") {
      return json({ ok: true, mode: "local" });
    }

    // ─── API: /api/me (local mode — no auth) ─────────────────────────────────
    if (url === "/api/me" && req.method === "GET") {
      return json({
        userId: "local",
        email: "local@localhost",
        name: "Local",
        tier: "free",
        createdAt: new Date().toISOString(),
      });
    }

    // ─── API: /api/billing/usage (local — unlimited) ─────────────────────────
    if (url === "/api/billing/usage" && req.method === "GET") {
      const status = gatherVaultStatus(ctx, {});
      const total = status.kindCounts.reduce((s, k) => s + k.c, 0);
      const storageMb =
        Math.round((status.dbSizeBytes / (1024 * 1024)) * 100) / 100;
      return json({
        tier: "free",
        limits: {
          maxEntries: "unlimited",
          requestsPerDay: "unlimited",
          storageMb: 1024,
          exportEnabled: true,
        },
        usage: { requestsToday: 0, entriesUsed: total, storageMb },
      });
    }

    // ─── API: /api/keys (local — empty) ──────────────────────────────────────
    if (url === "/api/keys" && req.method === "GET") {
      return json({ keys: [] });
    }

    // ─── API: /api/vault/status ─────────────────────────────────────────────
    if (url === "/api/vault/status" && req.method === "GET") {
      const status = gatherVaultStatus(ctx, {});
      return json({
        entries: {
          total: status.kindCounts.reduce((s, k) => s + k.c, 0),
          by_kind: Object.fromEntries(
            status.kindCounts.map((k) => [k.kind, k.c]),
          ),
          by_category: Object.fromEntries(
            status.categoryCounts.map((k) => [k.category, k.c]),
          ),
        },
        files: { total: status.fileCount, directories: status.subdirs },
        database: {
          size: status.dbSize,
          size_bytes: status.dbSizeBytes,
          stale_paths: status.staleCount,
          expired: status.expiredCount,
        },
        embeddings: status.embeddingStatus,
        embed_model_available: status.embedModelAvailable,
        health:
          status.errors.length === 0 && !status.stalePaths ? "ok" : "degraded",
        errors: status.errors,
      });
    }

    // ─── API: GET /api/vault/entries ────────────────────────────────────────
    if (url.startsWith("/api/vault/entries") && req.method === "GET") {
      const idMatch = url.match(/\/api\/vault\/entries\/([^/]+)$/);
      if (idMatch) {
        const entry = stmts.getEntryById.get(idMatch[1]);
        if (!entry)
          return json({ error: "Entry not found", code: "NOT_FOUND" }, 404);
        return json(formatEntry(entry));
      }
      const u = new URL(req.url || "", "http://localhost");
      const kind = u.searchParams.get("kind") || null;
      const category = u.searchParams.get("category") || null;
      const limit = Math.min(
        parseInt(u.searchParams.get("limit") || "20", 10) || 20,
        100,
      );
      const offset = parseInt(u.searchParams.get("offset") || "0", 10) || 0;
      const clauses = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
      const params = [];
      if (kind) {
        clauses.push("kind = ?");
        params.push(normalizeKind(kind));
      }
      if (category) {
        clauses.push("category = ?");
        params.push(category);
      }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      const total = ctx.db
        .prepare(`SELECT COUNT(*) as c FROM vault ${where}`)
        .get(...params).c;
      const rows = ctx.db
        .prepare(
          `SELECT * FROM vault ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      return json({ entries: rows.map(formatEntry), total, limit, offset });
    }

    // ─── API: POST /api/vault/entries ────────────────────────────────────────
    if (url === "/api/vault/entries" && req.method === "POST") {
      const data = await readBody();
      if (!data)
        return json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
      const err = validateEntry(data);
      if (err)
        return json({ error: err.error, code: "INVALID_INPUT" }, err.status);
      try {
        const entry = await captureAndIndex(ctx, {
          kind: data.kind,
          title: data.title,
          body: data.body,
          meta: data.meta,
          tags: data.tags,
          source: data.source || "rest-api",
          identity_key: data.identity_key,
          expires_at: data.expires_at,
          userId: null,
        });
        return json(formatEntry(stmts.getEntryById.get(entry.id)), 201);
      } catch (e) {
        console.error(`[local-server] Create error: ${e.message}`);
        return json(
          { error: "Failed to create entry", code: "CREATE_FAILED" },
          500,
        );
      }
    }

    // ─── API: PUT /api/vault/entries/:id ─────────────────────────────────────
    if (url.match(/^\/api\/vault\/entries\/[^/]+$/) && req.method === "PUT") {
      const id = url.split("/").pop();
      const data = await readBody();
      if (!data)
        return json({ error: "Invalid JSON body", code: "INVALID_INPUT" }, 400);
      const err = validateEntry(data, {
        requireKind: false,
        requireBody: false,
      });
      if (err)
        return json({ error: err.error, code: "INVALID_INPUT" }, err.status);
      const existing = stmts.getEntryById.get(id);
      if (!existing)
        return json({ error: "Entry not found", code: "NOT_FOUND" }, 404);
      try {
        const entry = updateEntryFile(ctx, existing, {
          title: data.title,
          body: data.body,
          tags: data.tags,
          meta: data.meta,
          source: data.source,
          expires_at: data.expires_at,
        });
        await indexEntry(ctx, entry);
        return json(formatEntry(stmts.getEntryById.get(id)));
      } catch (e) {
        console.error(`[local-server] Update error: ${e.message}`);
        return json(
          { error: "Failed to update entry", code: "UPDATE_FAILED" },
          500,
        );
      }
    }

    // ─── API: DELETE /api/vault/entries/:id ──────────────────────────────────
    if (
      url.match(/^\/api\/vault\/entries\/[^/]+$/) &&
      req.method === "DELETE"
    ) {
      const id = url.split("/").pop();
      const entry = stmts.getEntryById.get(id);
      if (!entry)
        return json({ error: "Entry not found", code: "NOT_FOUND" }, 404);
      if (entry.file_path) {
        try {
          unlinkSync(entry.file_path);
        } catch {}
      }
      const rowidResult = stmts.getRowid.get(id);
      if (rowidResult?.rowid) {
        try {
          deleteVec(stmts, Number(rowidResult.rowid));
        } catch {}
      }
      stmts.deleteEntry.run(id);
      return json({
        deleted: true,
        id,
        kind: entry.kind,
        title: entry.title || null,
      });
    }

    // ─── API: POST /api/vault/search ─────────────────────────────────────────
    if (url === "/api/vault/search" && req.method === "POST") {
      const data = await readBody();
      if (!data || !data.query?.trim())
        return json({ error: "query is required", code: "INVALID_INPUT" }, 400);
      const limit = Math.min(parseInt(data.limit || 20, 10) || 20, 100);
      const offset = parseInt(data.offset || 0, 10) || 0;
      try {
        const results = await hybridSearch(ctx, data.query, {
          kindFilter: data.kind ? normalizeKind(data.kind) : null,
          categoryFilter: data.category || null,
          limit,
          offset,
          decayDays: ctx.config.eventDecayDays || 30,
          userIdFilter: undefined,
        });
        const formatted = results.map((row) => ({
          ...formatEntry(row),
          score: Math.round(row.score * 1000) / 1000,
        }));
        return json({
          results: formatted,
          count: formatted.length,
          query: data.query,
        });
      } catch (e) {
        console.error(`[local-server] Search error: ${e.message}`);
        return json({ error: "Search failed", code: "SEARCH_FAILED" }, 500);
      }
    }

    // ─── API: POST /api/vault/import/bulk — Bulk import entries ─────────────
    if (url === "/api/vault/import/bulk" && req.method === "POST") {
      const data = await readBody();
      if (!data || !Array.isArray(data.entries)) {
        return json(
          {
            error: "Invalid body — expected { entries: [...] }",
            code: "INVALID_INPUT",
          },
          400,
        );
      }
      if (data.entries.length > 500) {
        return json(
          { error: "Maximum 500 entries per request", code: "LIMIT_EXCEEDED" },
          400,
        );
      }

      const result = await importEntries(ctx, data.entries, {
        source: "bulk-import",
      });
      return json({
        imported: result.imported,
        failed: result.failed,
        errors: result.errors.slice(0, 10).map((e) => e.error),
      });
    }

    // ─── API: POST /api/vault/import/file — Import from file content ────────
    if (url === "/api/vault/import/file" && req.method === "POST") {
      const data = await readBody();
      if (!data?.filename || !data?.content) {
        return json(
          { error: "filename and content are required", code: "INVALID_INPUT" },
          400,
        );
      }

      const entries = parseFile(data.filename, data.content, {
        kind: data.kind,
        source: data.source || "file-import",
      });
      if (!entries.length)
        return json({
          imported: 0,
          failed: 0,
          errors: ["No entries parsed from file"],
        });

      const result = await importEntries(ctx, entries, {
        source: data.source || "file-import",
      });
      return json({
        imported: result.imported,
        failed: result.failed,
        errors: result.errors.slice(0, 10).map((e) => e.error),
      });
    }

    // ─── API: GET /api/vault/export — Export all entries ─────────────────────
    if (url.startsWith("/api/vault/export") && req.method === "GET") {
      const u = new URL(req.url || "", "http://localhost");
      const format = u.searchParams.get("format") || "json";

      const rows = ctx.db
        .prepare(
          "SELECT * FROM vault WHERE (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC",
        )
        .all();

      const entries = rows.map(formatEntry);

      if (format === "csv") {
        const headers = [
          "id",
          "kind",
          "category",
          "title",
          "body",
          "tags",
          "source",
          "identity_key",
          "expires_at",
          "created_at",
        ];
        const csvLines = [headers.join(",")];
        for (const e of entries) {
          const row = headers.map((h) => {
            let val = e[h];
            if (Array.isArray(val)) val = val.join(", ");
            if (val == null) val = "";
            val = String(val);
            if (val.includes(",") || val.includes('"') || val.includes("\n")) {
              val = '"' + val.replace(/"/g, '""') + '"';
            }
            return val;
          });
          csvLines.push(row.join(","));
        }
        res.writeHead(200, {
          "Content-Type": "text/csv",
          ...corsHeaders,
        });
        res.end(csvLines.join("\n"));
        return;
      }

      return json({
        entries,
        total: entries.length,
        exported_at: new Date().toISOString(),
      });
    }

    // ─── API: POST /api/vault/ingest — Fetch URL and save as entry ──────────
    if (url === "/api/vault/ingest" && req.method === "POST") {
      const data = await readBody();
      if (!data?.url)
        return json({ error: "url is required", code: "INVALID_INPUT" }, 400);

      try {
        const entry = await ingestUrl(data.url, {
          kind: data.kind,
          tags: data.tags,
        });
        const result = await captureAndIndex(ctx, entry);
        return json(formatEntry(ctx.stmts.getEntryById.get(result.id)), 201);
      } catch (e) {
        return json(
          { error: `Ingestion failed: ${e.message}`, code: "INGEST_FAILED" },
          500,
        );
      }
    }

    // ─── API: GET /api/vault/manifest — Lightweight entry list for sync ─────
    if (url === "/api/vault/manifest" && req.method === "GET") {
      const rows = ctx.db
        .prepare(
          "SELECT id, kind, title, created_at FROM vault WHERE (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY created_at DESC",
        )
        .all();
      return json({
        entries: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title || null,
          created_at: r.created_at,
        })),
      });
    }

    // ─── API: GET /api/local/link — Get link status ─────────────────────────
    if (url === "/api/local/link" && req.method === "GET") {
      const dataDir = join(homedir(), ".context-mcp");
      const configPath = join(dataDir, "config.json");
      let storedConfig = {};
      if (existsSync(configPath)) {
        try {
          storedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch {}
      }
      return json({
        linked: !!storedConfig.apiKey,
        email: storedConfig.email || null,
        hostedUrl: storedConfig.hostedUrl || null,
        linkedAt: storedConfig.linkedAt || null,
        tier: storedConfig.tier || null,
      });
    }

    // ─── API: POST /api/local/link — Link/unlink hosted account ─────────────
    if (url === "/api/local/link" && req.method === "POST") {
      const data = await readBody();
      const dataDir = join(homedir(), ".context-mcp");
      const configPath = join(dataDir, "config.json");

      let storedConfig = {};
      if (existsSync(configPath)) {
        try {
          storedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch {}
      }

      if (!data?.apiKey) {
        // Unlink
        delete storedConfig.apiKey;
        delete storedConfig.hostedUrl;
        delete storedConfig.userId;
        delete storedConfig.email;
        delete storedConfig.linkedAt;
        delete storedConfig.tier;
        writeFileSync(configPath, JSON.stringify(storedConfig, null, 2) + "\n");
        return json({ linked: false });
      }

      const hostedUrl = data.hostedUrl || "https://api.context-vault.com";
      try {
        const response = await fetch(`${hostedUrl}/api/me`, {
          headers: { Authorization: `Bearer ${data.apiKey}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const user = await response.json();

        storedConfig.apiKey = data.apiKey;
        storedConfig.hostedUrl = hostedUrl;
        storedConfig.userId = user.userId || user.id;
        storedConfig.email = user.email;
        storedConfig.tier = user.tier || "free";
        storedConfig.linkedAt = new Date().toISOString();

        mkdirSync(dataDir, { recursive: true });
        writeFileSync(configPath, JSON.stringify(storedConfig, null, 2) + "\n");

        return json({
          linked: true,
          email: user.email,
          tier: user.tier || "free",
        });
      } catch (e) {
        return json(
          { error: `Verification failed: ${e.message}`, code: "AUTH_FAILED" },
          401,
        );
      }
    }

    // ─── API: POST /api/local/sync — Bidirectional sync ─────────────────────
    if (url === "/api/local/sync" && req.method === "POST") {
      const dataDir = join(homedir(), ".context-mcp");
      const configPath = join(dataDir, "config.json");
      let storedConfig = {};
      if (existsSync(configPath)) {
        try {
          storedConfig = JSON.parse(readFileSync(configPath, "utf-8"));
        } catch {}
      }

      if (!storedConfig.apiKey) {
        return json(
          { error: "Not linked. Use link endpoint first.", code: "NOT_LINKED" },
          400,
        );
      }

      try {
        const local = buildLocalManifest(ctx);
        const remote = await fetchRemoteManifest(
          storedConfig.hostedUrl,
          storedConfig.apiKey,
        );
        const plan = computeSyncPlan(local, remote);
        const result = await executeSync(ctx, {
          hostedUrl: storedConfig.hostedUrl,
          apiKey: storedConfig.apiKey,
          plan,
        });
        return json(result);
      } catch (e) {
        return json(
          { error: `Sync failed: ${e.message}`, code: "SYNC_FAILED" },
          500,
        );
      }
    }

    // ─── Static files ───────────────────────────────────────────────────────
    const filePath = join(
      APP_DIST,
      url === "/" ? "index.html" : url.replace(/^\//, ""),
    );
    if (!filePath.startsWith(APP_DIST)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      const fallback = join(APP_DIST, "index.html");
      if (existsSync(fallback)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        createReadStream(fallback).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }
    const type = MIME[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    createReadStream(filePath).pipe(res);
  });

  server.listen(port, () => {
    console.log(`[context-vault] Local mode: http://localhost:${port}`);
    console.log(`[context-vault] Vault: ${config.vaultDir}`);
    console.log(`[context-vault] No authentication required`);
  });

  process.on("SIGINT", () => {
    try {
      state.db.close();
    } catch {}
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    try {
      state.db.close();
    } catch {}
    process.exit(0);
  });
}

main().catch((e) => {
  console.error(`[local-server] Fatal: ${e.message}`);
  process.exit(1);
});
