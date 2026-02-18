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

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { join } from "node:path";
import { registerTools } from "@context-vault/core/server/tools";
import { createCtx } from "./server/ctx.js";
import { initMetaDb, prepareMetaStatements } from "./auth/meta-db.js";
import { bearerAuth } from "./middleware/auth.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { createManagementRoutes } from "./server/management.js";

// ─── Config ─────────────────────────────────────────────────────────────────

const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "true";

// ─── Shared Context (initialized once at startup) ───────────────────────────

const ctx = createCtx();
console.log(`[hosted] Vault: ${ctx.config.vaultDir}`);
console.log(`[hosted] Database: ${ctx.config.dbPath}`);

// Initialize meta database for auth and usage tracking
const metaDbPath = join(ctx.config.dataDir, "meta.db");
initMetaDb(metaDbPath);
prepareMetaStatements(initMetaDb(metaDbPath));
console.log(`[hosted] Meta DB: ${metaDbPath}`);
console.log(`[hosted] Auth: ${AUTH_REQUIRED ? "required" : "open (dev mode)"}`);

// ─── Factory: create MCP server per request ─────────────────────────────────

function createMcpServer() {
  const server = new McpServer(
    { name: "context-vault-hosted", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  registerTools(server, ctx);
  return server;
}

// ─── Hono App ───────────────────────────────────────────────────────────────

const app = new Hono();

// CORS for browser-based MCP clients
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "mcp-session-id", "Last-Event-ID", "mcp-protocol-version"],
  exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
}));

// Health check (unauthenticated)
app.get("/health", (c) => c.json({ status: "ok", version: "0.1.0", auth: AUTH_REQUIRED }));

// Management REST API (always requires auth)
app.route("/", createManagementRoutes(ctx));

// MCP endpoint — optionally auth-protected
if (AUTH_REQUIRED) {
  app.all("/mcp", bearerAuth(), rateLimit(), async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMcpServer();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
} else {
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createMcpServer();
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
}

// ─── Start Server ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000", 10);

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[hosted] MCP server listening on http://localhost:${PORT}/mcp`);
  console.log(`[hosted] Health check: http://localhost:${PORT}/health`);
  console.log(`[hosted] Management API: http://localhost:${PORT}/api/*`);
});

// ─── Graceful Shutdown ──────────────────────────────────────────────────────

function shutdown() {
  console.log("[hosted] Shutting down...");
  try { ctx.db.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
