#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { resolveConfig } from "../core/config.js";
import { embed } from "../index/embed.js";
import { initDatabase, prepareStatements, insertVec, deleteVec } from "../index/db.js";
import { registerTools } from "./tools.js";

// ─── Config Resolution ──────────────────────────────────────────────────────

const config = resolveConfig();

// Create directories
mkdirSync(config.dataDir, { recursive: true });
mkdirSync(config.vaultDir, { recursive: true });

// Write .context-mcp marker if missing
const markerPath = join(config.vaultDir, ".context-mcp");
if (!existsSync(markerPath)) {
  writeFileSync(markerPath, JSON.stringify({ created: new Date().toISOString() }, null, 2) + "\n");
}

// Update existence flag after directory creation
config.vaultDirExists = existsSync(config.vaultDir);

// Startup diagnostics
console.error(`[context-mcp] Vault: ${config.vaultDir}`);
console.error(`[context-mcp] Database: ${config.dbPath}`);
console.error(`[context-mcp] Dev dir: ${config.devDir}`);
if (!config.vaultDirExists) {
  console.error(`[context-mcp] WARNING: Vault directory not found!`);
}

// ─── Database Init ───────────────────────────────────────────────────────────

const db = initDatabase(config.dbPath);
const stmts = prepareStatements(db);

const ctx = {
  db,
  config,
  stmts,
  embed,
  insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
  deleteVec: (rowid) => deleteVec(stmts, rowid),
};

// ─── MCP Server ──────────────────────────────────────────────────────────────

const { version } = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));

const server = new McpServer(
  { name: "context-mcp", version },
  { capabilities: { tools: {} } }
);

registerTools(server, ctx);

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown() {
  try { db.close(); } catch {}
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
