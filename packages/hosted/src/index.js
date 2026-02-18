/**
 * @context-vault/hosted — Hosted context-vault server
 *
 * Hono HTTP server serving MCP over Streamable HTTP transport.
 * Same 6 tools as local mode, shared via registerTools(server, ctx).
 *
 * Stateless per-request model: each request gets a fresh McpServer + transport
 * but shares the same ctx (DB, embeddings, config).
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
import { createCtx } from "./server/ctx.js";
import { initMetaDb, prepareMetaStatements, getMetaDb } from "./auth/meta-db.js";
import { bearerAuth } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLogger } from "./middleware/logger.js";
import { createManagementRoutes } from "./server/management.js";
import { encryptForStorage, decryptFromStorage } from "./encryption/vault-crypto.js";
import { getTierLimits } from "./billing/stripe.js";
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

  // Verify vault dir is writable
  try {
    const probe = join(config.vaultDir, ".write-test");
    writeFileSync(probe, "");
    unlinkSync(probe);
  } catch (err) {
    console.error(`[hosted] \u26a0 Vault dir not writable: ${config.vaultDir} — ${err.message}`);
  }
}

// ─── Shared Context (initialized once at startup) ───────────────────────────

const ctx = await createCtx();
console.log(`[hosted] Vault: ${ctx.config.vaultDir}`);
console.log(`[hosted] Database: ${ctx.config.dbPath}`);

validateEnv(ctx.config);

// Initialize meta database for auth and usage tracking
const metaDbPath = join(ctx.config.dataDir, "meta.db");
initMetaDb(metaDbPath);
prepareMetaStatements(initMetaDb(metaDbPath));
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

// ─── Factory: create MCP server per request ─────────────────────────────────

function createMcpServer(user) {
  const userId = user?.userId || null;
  const server = new McpServer(
    { name: "context-vault-hosted", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  // Per-request ctx: shares db/stmts/embed but adds user identity
  // Only set userId when truthy (authenticated) — undefined means local/dev mode (no filtering)
  const userCtx = userId ? { ...ctx, userId } : ctx;

  // Add encryption/decryption functions when master secret is configured and user is authenticated
  if (VAULT_MASTER_SECRET && userId) {
    userCtx.encrypt = (entry) => encryptForStorage(entry, userId, VAULT_MASTER_SECRET);
    userCtx.decrypt = (row) => decryptFromStorage(row, userId, VAULT_MASTER_SECRET);
  }

  // Attach tier limits for hosted mode
  if (userId && user.tier) {
    const limits = getTierLimits(user.tier);
    userCtx.checkLimits = () => {
      const entryCount = ctx.db.prepare("SELECT COUNT(*) as c FROM vault WHERE user_id = ?").get(userId).c;
      const storageBytes = ctx.db.prepare(
        "SELECT COALESCE(SUM(LENGTH(COALESCE(body,'')) + LENGTH(COALESCE(body_encrypted,'')) + LENGTH(COALESCE(title,'')) + LENGTH(COALESCE(meta,''))), 0) as s FROM vault WHERE user_id = ?"
      ).get(userId).s;
      return {
        entryCount,
        storageMb: storageBytes / (1024 * 1024),
        maxEntries: limits.maxEntries,
        maxStorageMb: limits.storageMb,
      };
    };
  }

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
  ? (process.env.CORS_ORIGIN || [])
  : "*";

if (AUTH_REQUIRED && !process.env.CORS_ORIGIN) {
  console.warn("[hosted] \u26a0 CORS_ORIGIN not set with AUTH_REQUIRED=true — browser origins blocked");
}

app.use("*", cors({
  origin: corsOrigin,
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "mcp-session-id", "Last-Event-ID", "mcp-protocol-version"],
  exposeHeaders: ["mcp-session-id", "mcp-protocol-version", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
}));

// Health check (unauthenticated) — real DB checks for Fly.io
app.get("/health", (c) => {
  const checks = {
    status: "ok",
    version: pkgVersion,
    auth: AUTH_REQUIRED,
    region: process.env.FLY_REGION || "local",
    machine: process.env.FLY_MACHINE_ID || "local",
  };

  try { ctx.db.prepare("SELECT 1").get(); checks.vault_db = "ok"; }
  catch { checks.vault_db = "error"; checks.status = "degraded"; }
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

// MCP endpoint — optionally auth-protected
if (AUTH_REQUIRED) {
  app.all("/mcp", bearerAuth(), rateLimit(), async (c) => {
    try {
      const user = c.get("user");
      const transport = new WebStandardStreamableHTTPServerTransport();
      const server = createMcpServer(user);
      await server.connect(transport);
      return transport.handleRequest(c.req.raw);
    } catch (err) {
      console.error(JSON.stringify({
        level: "error",
        requestId: c.get("requestId") || null,
        path: "/mcp",
        error: err.message,
        ts: new Date().toISOString(),
      }));
      return c.json({ error: "Internal server error" }, 500);
    }
  });
} else {
  app.all("/mcp", async (c) => {
    try {
      const transport = new WebStandardStreamableHTTPServerTransport();
      const server = createMcpServer(null);
      await server.connect(transport);
      return transport.handleRequest(c.req.raw);
    } catch (err) {
      console.error(JSON.stringify({
        level: "error",
        requestId: c.get("requestId") || null,
        path: "/mcp",
        error: err.message,
        ts: new Date().toISOString(),
      }));
      return c.json({ error: "Internal server error" }, 500);
    }
  });
}

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
    // WAL checkpoint before closing to ensure all data is flushed
    try { ctx.db.pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { getMetaDb().pragma("wal_checkpoint(TRUNCATE)"); } catch {}
    try { ctx.db.close(); } catch {}
    try { getMetaDb().close(); } catch {}
    process.exit(0);
  });
  // Force exit after 10 seconds if drain hangs
  setTimeout(() => { process.exit(1); }, 10_000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
