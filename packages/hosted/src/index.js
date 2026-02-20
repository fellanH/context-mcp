/**
 * @context-vault/hosted — Hosted context-vault server
 *
 * Hono HTTP server serving MCP over Streamable HTTP transport.
 * Same 6 tools as local mode, shared via registerTools(server, ctx).
 *
 * Stateless per-request model: each request gets a fresh McpServer + transport.
 *
 * Frontend routing: APP_HOSTS / MARKETING_HOSTS env vars determine which
 * static build (app vs marketing) is served, based on the request Host header.
 *
 * Database isolation modes:
 *   PER_USER_DB=true  → Each user gets their own vault.db + vault/ directory
 *   PER_USER_DB=false → Shared vault.db with WHERE user_id filtering (legacy)
 *
 * Auth modes:
 *   AUTH_REQUIRED=true  → MCP endpoint requires Bearer API key (production)
 *   AUTH_REQUIRED=false → MCP endpoint is open (development, default)
 */

import "./instrument.js";
import * as Sentry from "@sentry/node";

import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { join } from "node:path";
import { writeFileSync, unlinkSync, readFileSync, statfsSync } from "node:fs";
import { registerTools } from "@context-vault/core/server/tools";
import { createCtx, PER_USER_DB } from "./server/ctx.js";
import { initMetaDb, prepareMetaStatements, getMetaDb } from "./auth/meta-db.js";
import { bearerAuth } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/logger.js";
import { createManagementRoutes } from "./server/management.js";
import { createVaultApiRoutes } from "./routes/vault-api.js";
import { getCachedUserCtx } from "./server/user-ctx.js";
import { pool } from "./server/user-db.js";
import { scheduleBackups, lastBackupTimestamp } from "./backup/r2-backup.js";

// ─── Config ─────────────────────────────────────────────────────────────────

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "true";

// ─── Startup Validation ─────────────────────────────────────────────────────

const VAULT_MASTER_SECRET = process.env.VAULT_MASTER_SECRET || null;

function validateEnv(config) {
  if (AUTH_REQUIRED) {
    if (!process.env.STRIPE_SECRET_KEY) {
      console.warn("[hosted] \u26a0 STRIPE_SECRET_KEY not set — billing disabled");
    }
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.warn("[hosted] \u26a0 STRIPE_WEBHOOK_SECRET not set — webhooks disabled");
    }
    if (!process.env.STRIPE_PRICE_PRO) {
      console.warn("[hosted] \u26a0 STRIPE_PRICE_PRO not set — checkout disabled");
    }
    if (!VAULT_MASTER_SECRET) {
      console.error("[hosted] FATAL: VAULT_MASTER_SECRET is required when AUTH_REQUIRED=true");
      process.exit(1);
    }
    if (VAULT_MASTER_SECRET.length < 16) {
      console.error("[hosted] FATAL: VAULT_MASTER_SECRET must be at least 16 characters");
      process.exit(1);
    }
  }

  // Verify data dir is writable
  try {
    const probe = join(config.dataDir, ".write-test");
    writeFileSync(probe, "");
    unlinkSync(probe);
  } catch (err) {
    console.error(`[hosted] \u26a0 Data dir not writable: ${config.dataDir} — ${err.message}`);
  }
}

// ─── Shared Context (initialized once at startup) ───────────────────────────

const ctx = await createCtx();
console.log(`[hosted] Mode: ${PER_USER_DB ? "per-user DB isolation" : "shared DB (legacy)"}`);
if (!PER_USER_DB) {
  console.log(`[hosted] Vault: ${ctx.config.vaultDir}`);
  console.log(`[hosted] Database: ${ctx.config.dbPath}`);
}
console.log(`[hosted] Data dir: ${ctx.config.dataDir}`);

validateEnv(ctx.config);

// Initialize meta database for auth and usage tracking
const metaDbPath = join(ctx.config.dataDir, "meta.db");
const metaDb = initMetaDb(metaDbPath);
prepareMetaStatements(metaDb);
console.log(`[hosted] Meta DB: ${metaDbPath}`);
console.log(`[hosted] Auth: ${AUTH_REQUIRED ? "required" : "open (dev mode)"}`);

// ─── Automated Backups ───────────────────────────────────────────────────────

scheduleBackups(ctx, getMetaDb(), ctx.config);

// ─── Package version ────────────────────────────────────────────────────────

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
  pkgVersion = pkg.version || pkgVersion;
} catch {}

const MCP_REQUEST_TIMEOUT_MS = 60_000;

// ─── Factory: create MCP server per request ─────────────────────────────────

async function createMcpServer(user) {
  const server = new McpServer(
    { name: "context-vault-hosted", version: pkgVersion },
    { capabilities: { tools: {} } }
  );
  const userCtx = await getCachedUserCtx(ctx, user, VAULT_MASTER_SECRET);
  registerTools(server, userCtx);
  return server;
}

// ─── Hono App ───────────────────────────────────────────────────────────────

const app = new Hono();

// Global error handler — catches all unhandled errors, returns generic 500
app.onError((err, c) => {
  Sentry.captureException(err);
  console.error(JSON.stringify({
    level: "error",
    requestId: c.get("requestId") || null,
    method: c.req.method,
    path: c.req.path,
    error: err.message,
    ts: new Date().toISOString(),
  }));
  return c.json({ error: "Internal server error" }, 500);
});

// 404 handler — JSON instead of Hono's default HTML
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
app.use("*", secureHeaders());

// Request body size limit (512KB)
app.use("*", bodyLimit({ maxSize: 512 * 1024 }));

// Structured JSON request logging
app.use("*", requestLogger());

// CORS for browser-based MCP clients
// When AUTH_REQUIRED and no CORS_ORIGIN set → block browser origins (empty array)
// When !AUTH_REQUIRED (dev) → allow all
const corsOrigin = AUTH_REQUIRED
  ? (process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",").map(s => s.trim())
      : [])
  : "*";

if (AUTH_REQUIRED && !process.env.CORS_ORIGIN) {
  console.warn("[hosted] \u26a0 CORS_ORIGIN not set with AUTH_REQUIRED=true — browser origins blocked");
}

app.use("*", cors({
  origin: corsOrigin,
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Vault-Secret", "mcp-session-id", "Last-Event-ID", "mcp-protocol-version"],
  exposeHeaders: ["mcp-session-id", "mcp-protocol-version", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
}));

// Health check (unauthenticated) — real DB checks for Fly.io
app.get("/health", (c) => {
  const checks = {
    status: "ok",
    version: pkgVersion,
    auth: AUTH_REQUIRED,
    perUserDb: PER_USER_DB,
    region: process.env.FLY_REGION || "local",
    machine: process.env.FLY_MACHINE_ID || "local",
  };

  if (PER_USER_DB) {
    checks.user_db_pool = pool.size;
    checks.vault_db = "per-user";
  } else {
    try { ctx.db.prepare("SELECT 1").get(); checks.vault_db = "ok"; }
    catch { checks.vault_db = "error"; checks.status = "degraded"; }
  }

  try { getMetaDb().prepare("SELECT 1").get(); checks.meta_db = "ok"; }
  catch { checks.meta_db = "error"; checks.status = "degraded"; }

  // Disk usage (Fly.io volume at /data)
  try {
    const stats = statfsSync("/data");
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    const usedPct = Math.round(((totalBytes - freeBytes) / totalBytes) * 100);
    const freeMb = Math.round(freeBytes / (1024 * 1024));
    checks.disk = { usedPct, freeMb };
    if (usedPct > 90) checks.status = "degraded";
  } catch {
    checks.disk = null;
  }

  checks.last_backup = lastBackupTimestamp;
  checks.uptime_s = Math.floor(process.uptime());

  const statusCode = checks.status === "ok" ? 200 : 503;
  return c.json(checks, statusCode);
});

// Management REST API (always requires auth)
app.route("/", createManagementRoutes(ctx));

// Vault REST API (auth + rate limiting applied per-route)
app.route("/", createVaultApiRoutes(ctx, VAULT_MASTER_SECRET));

// MCP endpoint — optionally auth-protected
async function handleMcpRequest(c, user) {
  let timer;
  try {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = await createMcpServer(user);
    await server.connect(transport);
    return await Promise.race([
      transport.handleRequest(c.req.raw),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("MCP request timed out")), MCP_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    const isTimeout = err.message === "MCP request timed out";
    console.error(JSON.stringify({
      level: "error",
      requestId: c.get("requestId") || null,
      path: "/mcp",
      error: err.message,
      timeout: isTimeout,
      ts: new Date().toISOString(),
    }));
    return c.json(
      { error: isTimeout ? "Request timed out" : "Internal server error" },
      isTimeout ? 504 : 500,
    );
  } finally {
    clearTimeout(timer);
  }
}

if (AUTH_REQUIRED) {
  app.all("/mcp", bearerAuth(), rateLimit(), async (c) => {
    return handleMcpRequest(c, c.get("user"));
  });
} else {
  app.all("/mcp", async (c) => {
    return handleMcpRequest(c, null);
  });
}

// Redirect root to marketing site (frontends served by Vercel)
app.get("/", (c) => c.redirect("https://context-vault.com", 302));

// ─── Start Server ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);

const httpServer = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[hosted] MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(`[hosted] Health check: http://localhost:${PORT}/health`);
  console.log(`[hosted] Management API: http://localhost:${PORT}/api/*`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[hosted] ${signal} received, draining...`);
  httpServer.close(() => {
    // Close per-user DB pool
    try { pool.closeAll(); } catch {}
    // WAL checkpoint + close shared DB (legacy mode)
    if (!PER_USER_DB && ctx.db) {
      try { ctx.db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
      try { ctx.db.close(); } catch {}
    }
    try { getMetaDb().pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { getMetaDb().close(); } catch {}
    process.exit(0);
  });
  // Force exit after 10 seconds if drain hangs
  setTimeout(() => { process.exit(1); }, 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
