#!/usr/bin/env node
/**
 * serve.js — Lightweight HTTP server for context-mcp UI
 *
 * Structure-agnostic: discovers tables, columns, and directories at runtime.
 * Works with any SQLite database and any vault directory layout.
 *
 * Usage: node serve.js [--port 3141] [--db-path /path/to/vault.db] [--vault-dir /path/to/vault]
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../src/config.js";
import { initDatabase } from "../src/db.js";
import { embed } from "../src/embed.js";
import { hybridSearch } from "../src/search.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config & DB (mutable — can be reconnected) ────────────────────────────

let config = resolveConfig();
let db = initDatabase(config.dbPath);

function reconnectDb(dbPath) {
  try { db.close(); } catch {}
  db = initDatabase(dbPath);
}

// ─── Load UI HTML once ──────────────────────────────────────────────────────

const htmlContent = readFileSync(resolve(__dirname, "index.html"), "utf-8");

// ─── Helpers ────────────────────────────────────────────────────────────────

function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function htmlResponse(res) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(htmlContent);
}

function errorResponse(res, message, status = 500) {
  jsonResponse(res, { error: message }, status);
}

function safeTableName(name) {
  // Only allow alphanumeric, underscore, hyphen
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name) ? name : null;
}

// ─── Discovery ──────────────────────────────────────────────────────────────
// Returns everything the UI needs to build its sidebar and choose views.

function handleDiscover(res) {
  // 1. Discover all tables with schemas and row counts
  const rawTables = db.prepare(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all();

  const tables = rawTables.map((t) => {
    try {
      const count = db.prepare(`SELECT COUNT(*) as count FROM "${t.name}"`).get().count;
      const cols = db.prepare(`PRAGMA table_info("${t.name}")`).all();
      return {
        name: t.name,
        type: t.type,
        count,
        columns: cols.map((c) => ({ name: c.name, type: c.type, pk: !!c.pk })),
      };
    } catch {
      return { name: t.name, type: t.type, count: 0, columns: [] };
    }
  });

  // 2. For tables with a "kind" or "type" or "category" column, get distinct values
  const tableGroups = {};
  for (const t of tables) {
    const groupCol = t.columns.find((c) =>
      ["kind", "type", "category", "status", "group"].includes(c.name.toLowerCase())
    );
    if (groupCol && t.count > 0) {
      try {
        const groups = db.prepare(
          `SELECT "${groupCol.name}" as grp, COUNT(*) as count FROM "${t.name}" WHERE "${groupCol.name}" IS NOT NULL GROUP BY "${groupCol.name}" ORDER BY count DESC`
        ).all();
        tableGroups[t.name] = { column: groupCol.name, groups: groups.map((g) => ({ value: g.grp, count: g.count })) };
      } catch {}
    }
  }

  // 3. Knowledge directory structure (top-level only)
  let directories = [];
  let vaultDirName = basename(config.vaultDir);
  if (existsSync(config.vaultDir)) {
    try {
      const entries = readdirSync(config.vaultDir, { withFileTypes: true });
      directories = entries
        .filter((e) => !e.name.startsWith("."))
        .map((e) => {
          const fullPath = join(config.vaultDir, e.name);
          const item = { name: e.name, type: e.isDirectory() ? "directory" : "file" };
          if (e.isDirectory()) {
            try {
              // Count files recursively
              const count = countFiles(fullPath);
              item.fileCount = count;
            } catch { item.fileCount = 0; }
          }
          if (e.isFile()) {
            try { item.size = statSync(fullPath).size; } catch {}
          }
          return item;
        })
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
          return a.name.localeCompare(b.name);
        });
    } catch {}
  }

  // 4. DB size
  let dbSize = "unknown";
  try {
    const bytes = statSync(config.dbPath).size;
    dbSize = bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)}KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  } catch {}

  jsonResponse(res, {
    tables,
    tableGroups,
    directories,
    vaultDirName,
    dbSize,
    connection: {
      dbPath: config.dbPath,
      vaultDir: config.vaultDir,
      dataDir: config.dataDir,
      devDir: config.devDir,
      vaultDirExists: existsSync(config.vaultDir),
      dbExists: existsSync(config.dbPath),
    },
  });
}

function countFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isFile()) count++;
    else if (entry.isDirectory()) count += countFiles(join(dir, entry.name));
  }
  return count;
}

// ─── Generic Table Data ─────────────────────────────────────────────────────
// Query any table with pagination, search, and optional group filtering.

function handleTableData(res, url) {
  const params = url.searchParams;
  const table = params.get("table");
  if (!table || !safeTableName(table)) return errorResponse(res, "Invalid table name", 400);

  // Verify table exists
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(table);
  if (!exists) return errorResponse(res, "Table not found", 404);

  const limit = Math.min(parseInt(params.get("limit") || "50", 10), 200);
  const offset = parseInt(params.get("offset") || "0", 10);
  const q = params.get("q") || "";
  const groupCol = params.get("groupCol") || "";
  const groupVal = params.get("groupVal") || "";
  const sortCol = params.get("sort") || "";
  const sortDir = params.get("dir") === "asc" ? "ASC" : "DESC";

  // Get column info for this table
  const colInfo = db.prepare(`PRAGMA table_info("${table}")`).all();
  const colNames = colInfo.map((c) => c.name);

  // Build WHERE clause
  const conditions = [];
  const binds = [];

  // Group filter
  if (groupCol && groupVal && colNames.includes(groupCol)) {
    conditions.push(`"${groupCol}" = ?`);
    binds.push(groupVal);
  }

  // Search: LIKE across all text-looking columns
  if (q) {
    const textCols = colInfo.filter((c) =>
      !c.type || c.type.toUpperCase().includes("TEXT") || c.type.toUpperCase().includes("VARCHAR") || c.type === ""
    );
    if (textCols.length > 0) {
      const likeClauses = textCols.map((c) => `"${c.name}" LIKE ?`);
      conditions.push(`(${likeClauses.join(" OR ")})`);
      for (const _ of textCols) binds.push(`%${q}%`);
    }
  }

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";

  // Sort
  let orderBy = "";
  if (sortCol && colNames.includes(sortCol)) {
    orderBy = ` ORDER BY "${sortCol}" ${sortDir}`;
  } else {
    // Auto-detect: prefer created_at, date, updated_at, id, or rowid
    const dateCols = ["created_at", "updated_at", "date", "timestamp", "created", "modified"];
    const autoSort = dateCols.find((c) => colNames.includes(c));
    if (autoSort) {
      orderBy = ` ORDER BY "${autoSort}" DESC`;
    }
  }

  try {
    const rows = db.prepare(`SELECT * FROM "${table}"${where}${orderBy} LIMIT ? OFFSET ?`).all(...binds, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) as count FROM "${table}"${where}`).get(...binds).count;

    jsonResponse(res, {
      table,
      columns: colInfo.map((c) => ({ name: c.name, type: c.type, pk: !!c.pk })),
      rows,
      total,
    });
  } catch (e) {
    errorResponse(res, "Query failed: " + e.message);
  }
}

// ─── Knowledge Directory Browser ────────────────────────────────────────────

function handleBrowse(res, url) {
  const subpath = url.searchParams.get("path") || "";
  const baseDir = config.vaultDir;

  if (!existsSync(baseDir)) {
    return jsonResponse(res, { exists: false, path: baseDir, baseName: basename(baseDir), items: [] });
  }

  const targetDir = subpath ? resolve(baseDir, subpath) : baseDir;

  // Safety: prevent traversal outside knowledge dir
  if (!targetDir.startsWith(baseDir)) {
    return errorResponse(res, "Invalid path", 400);
  }

  if (!existsSync(targetDir)) {
    return jsonResponse(res, { exists: false, path: targetDir, baseName: basename(baseDir), items: [] });
  }

  try {
    const entries = readdirSync(targetDir, { withFileTypes: true });
    const items = entries
      .filter((e) => !e.name.startsWith("."))
      .map((e) => {
        const fullPath = join(targetDir, e.name);
        const item = {
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
          path: subpath ? join(subpath, e.name) : e.name,
        };
        if (e.isFile()) {
          try {
            const st = statSync(fullPath);
            item.size = st.size;
            item.modified = st.mtime.toISOString();
          } catch {}
        }
        if (e.isDirectory()) {
          try {
            const children = readdirSync(fullPath, { withFileTypes: true });
            item.childCount = children.filter((c) => !c.name.startsWith(".")).length;
          } catch { item.childCount = 0; }
        }
        return item;
      })
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    jsonResponse(res, { exists: true, path: targetDir, baseName: basename(baseDir), relativePath: subpath, items });
  } catch (e) {
    errorResponse(res, "Failed to browse: " + e.message);
  }
}

function handleFileContent(res, url) {
  const filePath = url.searchParams.get("path") || "";
  const baseDir = config.vaultDir;

  if (!filePath || !existsSync(baseDir)) {
    return errorResponse(res, "Invalid path", 400);
  }

  const fullPath = resolve(baseDir, filePath);

  // Safety: prevent traversal
  if (!fullPath.startsWith(baseDir)) {
    return errorResponse(res, "Invalid path", 400);
  }

  if (!existsSync(fullPath)) {
    return errorResponse(res, "File not found", 404);
  }

  try {
    const content = readFileSync(fullPath, "utf-8");
    const stats = statSync(fullPath);
    jsonResponse(res, {
      path: filePath,
      fullPath,
      baseName: basename(baseDir),
      name: basename(fullPath),
      content,
      size: stats.size,
      modified: stats.mtime.toISOString(),
    });
  } catch (e) {
    errorResponse(res, "Failed to read file: " + e.message);
  }
}

// ─── Semantic Search ─────────────────────────────────────────────────────────

async function handleSearch(res, url) {
  const query = url.searchParams.get("q") || "";
  const kindParam = url.searchParams.get("kind") || url.searchParams.get("type") || "";
  const kindFilter = kindParam ? kindParam.replace(/s$/, "") : null;

  if (!query) return jsonResponse(res, { results: [] });

  const sorted = await hybridSearch(db, embed, query, kindFilter);
  jsonResponse(res, { query, results: sorted });
}

// ─── Config Handlers ─────────────────────────────────────────────────────────

const configFilePath = resolve(__dirname, "..", "config.json");

function handleGetConfig(res) {
  try {
    const raw = existsSync(configFilePath) ? readFileSync(configFilePath, "utf-8") : "{}";
    const cfg = JSON.parse(raw);
    jsonResponse(res, {
      config: cfg,
      path: configFilePath,
      active: {
        dbPath: config.dbPath,
        vaultDir: config.vaultDir,
        dataDir: config.dataDir,
        devDir: config.devDir,
      },
    });
  } catch (e) {
    errorResponse(res, "Failed to read config: " + e.message);
  }
}

const MAX_BODY = 1024 * 1024; // 1MB

function handlePutConfig(req, res) {
  let body = "";
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      req.destroy();
      return errorResponse(res, "Request body too large", 413);
    }
    body += chunk;
  });
  req.on("end", () => {
    try {
      const newConfig = JSON.parse(body);
      const allowed = ["vaultDir", "dataDir", "dbPath", "devDir"];
      const sanitized = {};
      for (const key of allowed) {
        if (newConfig[key] !== undefined) sanitized[key] = newConfig[key];
      }
      writeFileSync(configFilePath, JSON.stringify(sanitized, null, 2) + "\n");

      // Reconnect DB if dbPath changed
      const newDbPath = resolve(sanitized.dbPath || config.dbPath);
      if (newDbPath !== config.dbPath && existsSync(newDbPath)) {
        reconnectDb(newDbPath);
        config.dbPath = newDbPath;
      }

      if (sanitized.vaultDir) config.vaultDir = resolve(sanitized.vaultDir);
      if (sanitized.dataDir) config.dataDir = resolve(sanitized.dataDir);
      if (sanitized.devDir) config.devDir = resolve(sanitized.devDir);
      config.vaultDirExists = existsSync(config.vaultDir);

      jsonResponse(res, { ok: true, config: sanitized });
    } catch (e) {
      errorResponse(res, "Invalid JSON: " + e.message, 400);
    }
  });
}

// ─── Server ─────────────────────────────────────────────────────────────────

const port = (() => {
  const portArg = process.argv.indexOf("--port");
  if (portArg !== -1 && process.argv[portArg + 1]) return parseInt(process.argv[portArg + 1], 10);
  if (process.env.PORT) return parseInt(process.env.PORT, 10);
  return 3141;
})();

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;

  try {
    if (path === "/") return htmlResponse(res);
    if (path === "/api/discover") return handleDiscover(res);
    if (path === "/api/table-data") return handleTableData(res, url);
    if (path === "/api/search") return handleSearch(res, url);
    if (path === "/api/browse") return handleBrowse(res, url);
    if (path === "/api/file") return handleFileContent(res, url);
    if (path === "/api/config" && req.method === "GET") return handleGetConfig(res);
    if (path === "/api/config" && req.method === "PUT") return handlePutConfig(req, res);
    errorResponse(res, "Not found", 404);
  } catch (e) {
    console.error(e);
    errorResponse(res, e.message);
  }
});

server.listen(port, () => {
  console.log(`Vault UI → http://localhost:${port}`);
  console.log(`DB: ${config.dbPath}`);
  console.log(`Vault: ${config.vaultDir}`);
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown() {
  server.close(() => {
    try { db.close(); } catch {}
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
