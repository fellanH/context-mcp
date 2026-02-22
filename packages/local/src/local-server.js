import http from "node:http";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

const LOCAL_USER = {
  id: "local",
  email: "local@localhost",
  tier: "local",
  linkedAt: null,
};

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function tryParse(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function mapRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title || null,
    body: row.body || null,
    tags: tryParse(row.tags, []),
    meta: tryParse(row.meta, {}),
    source: row.source || null,
    identity_key: row.identity_key || null,
    expires_at: row.expires_at || null,
    created_at: row.created_at,
  };
}

function mapCaptureResult(entry) {
  return {
    id: entry.id,
    kind: entry.kind,
    category: entry.category,
    title: entry.title || null,
    body: entry.body || null,
    tags: entry.tags || [],
    meta: entry.meta || {},
    source: entry.source || null,
    identity_key: entry.identity_key || null,
    expires_at: entry.expires_at || null,
    created_at: entry.createdAt,
  };
}

function serveStatic(req, res, pathname, appDistDir) {
  if (!existsSync(appDistDir)) {
    const msg = "Web UI not bundled. Run `node scripts/prepack.js` first.";
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end(msg);
    return;
  }

  let filePath = join(appDistDir, pathname === "/" ? "index.html" : pathname);

  // Security: prevent path traversal
  if (!filePath.startsWith(appDistDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!existsSync(filePath)) {
    const ext = extname(pathname);
    if (ext) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    // SPA fallback for React Router routes
    filePath = join(appDistDir, "index.html");
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const content = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": mime,
    "Content-Length": content.length,
  });
  res.end(content);
}

async function handleApi(
  req,
  res,
  url,
  ctx,
  { captureAndIndex, gatherVaultStatus },
) {
  const { method } = req;
  const pathname = url.pathname;

  if (pathname === "/api/me" && method === "GET") {
    return json(res, 200, LOCAL_USER);
  }

  if (pathname === "/api/register" && method === "POST") {
    return json(res, 200, LOCAL_USER);
  }

  if (pathname === "/api/vault/status" && method === "GET") {
    const status = gatherVaultStatus(ctx);
    return json(res, 200, status);
  }

  if (pathname === "/api/vault/entries" && method === "GET") {
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "50", 10),
      200,
    );
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);
    const kind = url.searchParams.get("kind") || null;
    const category = url.searchParams.get("category") || null;
    const q = url.searchParams.get("q") || null;

    let query = `SELECT * FROM vault WHERE (expires_at IS NULL OR expires_at > datetime('now'))`;
    const params = [];

    if (kind) {
      query += ` AND kind = ?`;
      params.push(kind);
    }
    if (category) {
      query += ` AND category = ?`;
      params.push(category);
    }
    if (q) {
      query += ` AND (title LIKE ? OR body LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }

    const countQuery = query.replace("SELECT *", "SELECT COUNT(*) as c");
    const total = ctx.db.prepare(countQuery).get(...params).c;

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = ctx.db.prepare(query).all(...params);
    return json(res, 200, { entries: rows.map(mapRow), total, limit, offset });
  }

  if (pathname === "/api/vault/entries" && method === "POST") {
    const data = await readBody(req);
    const entry = await captureAndIndex(ctx, data);
    return json(res, 201, mapCaptureResult(entry));
  }

  const entryMatch = pathname.match(/^\/api\/vault\/entries\/([^/]+)$/);
  if (entryMatch) {
    const id = entryMatch[1];

    if (method === "GET") {
      const row = ctx.stmts.getEntryById.get(id);
      if (!row) return json(res, 404, { error: "Entry not found" });
      return json(res, 200, mapRow(row));
    }

    if (method === "DELETE") {
      const entry = ctx.stmts.getEntryById.get(id);
      if (!entry) return json(res, 404, { error: "Entry not found" });

      if (entry.file_path) {
        try {
          unlinkSync(entry.file_path);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }

      const rowidResult = ctx.stmts.getRowid.get(id);
      if (rowidResult?.rowid) {
        try {
          ctx.deleteVec(Number(rowidResult.rowid));
        } catch {}
      }

      ctx.stmts.deleteEntry.run(id);
      return json(res, 200, { deleted: true });
    }
  }

  return json(res, 404, { error: "Not available in local mode" });
}

export async function startLocalServer(port = 4422) {
  const { resolveConfig } = await import("@context-vault/core/core/config");
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import("@context-vault/core/index/db");
  const { embed } = await import("@context-vault/core/index/embed");
  const { captureAndIndex } = await import("@context-vault/core/capture");
  const { gatherVaultStatus } = await import("@context-vault/core/core/status");

  const config = resolveConfig();
  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);

  const ctx = {
    db,
    config,
    stmts,
    embed,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  const appDistDir = join(__dirname, "..", "app-dist");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (pathname.startsWith("/api/")) {
      try {
        await handleApi(req, res, url, ctx, {
          captureAndIndex,
          gatherVaultStatus,
        });
      } catch (e) {
        json(res, 500, { error: e.message });
      }
      return;
    }

    serveStatic(req, res, pathname, appDistDir);
  });

  server.listen(port);
  return server;
}
