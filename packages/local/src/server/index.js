#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"),
);

import { resolveConfig } from "@context-vault/core/core/config";
import { appendErrorLog } from "@context-vault/core/core/error-log";
import {
  sendTelemetryEvent,
  maybeShowTelemetryNotice,
} from "@context-vault/core/core/telemetry";
import { embed } from "@context-vault/core/index/embed";
import {
  initDatabase,
  NativeModuleError,
  prepareStatements,
  insertVec,
  deleteVec,
} from "@context-vault/core/index/db";
import { registerTools } from "@context-vault/core/server/tools";
import { pruneExpired } from "@context-vault/core/index/index";

// ─── Phased Startup ─────────────────────────────────────────────────────────

async function main() {
  let phase = "CONFIG";
  let db;
  let config;

  try {
    // ── Phase: CONFIG ────────────────────────────────────────────────────────
    config = resolveConfig();

    // ── Phase: DIRS ──────────────────────────────────────────────────────────
    phase = "DIRS";
    mkdirSync(config.dataDir, { recursive: true });
    mkdirSync(config.vaultDir, { recursive: true });
    maybeShowTelemetryNotice(config.dataDir);

    // Verify vault directory is writable (catch permission issues early)
    try {
      const probe = join(config.vaultDir, ".write-probe");
      writeFileSync(probe, "");
      unlinkSync(probe);
    } catch (writeErr) {
      console.error(
        `[context-vault] FATAL: Vault directory is not writable: ${config.vaultDir}`,
      );
      console.error(`[context-vault] ${writeErr.message}`);
      console.error(
        `[context-vault] Fix permissions: chmod u+w "${config.vaultDir}"`,
      );
      process.exit(1);
    }

    // Write .context-mcp marker (non-fatal)
    try {
      const markerPath = join(config.vaultDir, ".context-mcp");
      const markerData = existsSync(markerPath)
        ? JSON.parse(readFileSync(markerPath, "utf-8"))
        : {};
      writeFileSync(
        markerPath,
        JSON.stringify(
          {
            created: markerData.created || new Date().toISOString(),
            version: pkg.version,
          },
          null,
          2,
        ) + "\n",
      );
    } catch (markerErr) {
      console.error(
        `[context-vault] Warning: could not write marker file: ${markerErr.message}`,
      );
    }

    config.vaultDirExists = existsSync(config.vaultDir);

    // Startup diagnostics
    console.error(`[context-vault] Vault: ${config.vaultDir}`);
    console.error(`[context-vault] Database: ${config.dbPath}`);
    console.error(`[context-vault] Dev dir: ${config.devDir}`);
    if (!config.vaultDirExists) {
      console.error(`[context-vault] WARNING: Vault directory not found!`);
    }

    // ── Phase: DB ────────────────────────────────────────────────────────────
    phase = "DB";
    db = await initDatabase(config.dbPath);
    const stmts = prepareStatements(db);

    const ctx = {
      db,
      config,
      stmts,
      embed,
      insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
      deleteVec: (rowid) => deleteVec(stmts, rowid),
      activeOps: { count: 0 },
      toolStats: { ok: 0, errors: 0, lastError: null },
    };

    // ── Phase: PRUNE ─────────────────────────────────────────────────────────
    try {
      const pruned = await pruneExpired(ctx);
      if (pruned > 0) {
        console.error(
          `[context-vault] Pruned ${pruned} expired ${pruned === 1 ? "entry" : "entries"}`,
        );
      }
    } catch (pruneErr) {
      console.error(
        `[context-vault] Warning: startup prune failed: ${pruneErr.message}`,
      );
    }

    // ── Phase: SERVER ────────────────────────────────────────────────────────
    phase = "SERVER";
    const server = new McpServer(
      { name: "context-vault", version: pkg.version },
      { capabilities: { tools: {} } },
    );

    // Hot-reload config.json on every tool call (Option C from #144).
    // resolveConfig() re-reads the small file each time — negligible I/O
    // compared to DB queries and embedding operations that follow.
    let lastVaultDir = config.vaultDir;
    Object.defineProperty(ctx, "config", {
      get() {
        const fresh = resolveConfig();
        if (fresh.vaultDir !== lastVaultDir) {
          console.error(
            `[context-vault] Config reloaded: vaultDir changed to ${fresh.vaultDir}`,
          );
          lastVaultDir = fresh.vaultDir;
        }
        return fresh;
      },
      configurable: true,
    });

    registerTools(server, ctx);

    // ── Graceful Shutdown ────────────────────────────────────────────────────
    function closeDb() {
      try {
        if (db.inTransaction) {
          console.error("[context-vault] Rolling back active transaction...");
          db.exec("ROLLBACK");
        }
        db.pragma("wal_checkpoint(TRUNCATE)");
        db.close();
        console.error("[context-vault] Database closed cleanly.");
      } catch (shutdownErr) {
        console.error(`[context-vault] Shutdown error: ${shutdownErr.message}`);
      }
      process.exit(0);
    }

    function shutdown(signal) {
      console.error(`[context-vault] Received ${signal}, shutting down...`);

      if (ctx.activeOps.count > 0) {
        console.error(
          `[context-vault] Waiting for ${ctx.activeOps.count} in-flight operation(s)...`,
        );
        const check = setInterval(() => {
          if (ctx.activeOps.count === 0) {
            clearInterval(check);
            closeDb();
          }
        }, 100);
        // Force shutdown after 5 seconds even if ops are still running
        setTimeout(() => {
          clearInterval(check);
          console.error(
            `[context-vault] Force shutdown — ${ctx.activeOps.count} operation(s) still running`,
          );
          closeDb();
        }, 5000);
      } else {
        closeDb();
      }
    }
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // ── Phase: CONNECTED ─────────────────────────────────────────────────────
    phase = "CONNECTED";
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // ── Non-blocking Update Check ────────────────────────────────────────────
    setTimeout(() => {
      import("node:child_process")
        .then(({ execSync }) => {
          try {
            const latest = execSync("npm view context-vault version", {
              encoding: "utf-8",
              timeout: 5000,
              stdio: ["pipe", "pipe", "pipe"],
            }).trim();
            if (latest && latest !== pkg.version) {
              console.error(
                `[context-vault] Update available: v${pkg.version} → v${latest}. Run: context-vault update`,
              );
            }
          } catch {}
        })
        .catch(() => {});
    }, 3000);
  } catch (err) {
    const dataDir = config?.dataDir || join(homedir(), ".context-mcp");

    const logEntry = {
      timestamp: new Date().toISOString(),
      error_type: err.constructor?.name || "Error",
      message: err.message,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
      cv_version: pkg.version,
      phase,
    };
    appendErrorLog(dataDir, logEntry);

    sendTelemetryEvent(config, {
      event: "startup_error",
      code: phase,
      tool: null,
      cv_version: pkg.version,
    });

    if (err instanceof NativeModuleError) {
      // Boxed diagnostic for native module mismatch
      console.error("");
      console.error(
        "╔══════════════════════════════════════════════════════════════╗",
      );
      console.error(
        "║  context-vault: Native Module Error                         ║",
      );
      console.error(
        "╚══════════════════════════════════════════════════════════════╝",
      );
      console.error("");
      console.error(err.message);
      console.error("");
      console.error(`  Node.js path:    ${process.execPath}`);
      console.error(`  Node.js version: ${process.version}`);
      console.error(`  Error log:       ${join(dataDir, "error.log")}`);
      console.error("");
      process.exit(78); // EX_CONFIG
    }

    console.error(
      `[context-vault] Fatal error during ${phase} phase: ${err.message}`,
    );
    console.error(`[context-vault] Error log: ${join(dataDir, "error.log")}`);
    if (phase === "DB") {
      console.error(
        `[context-vault] Try deleting the DB file and restarting: rm "${config?.dbPath || "vault.db"}"`,
      );
    }
    process.exit(1);
  }
}

// ─── Top-level Safety Net ────────────────────────────────────────────────────
// Catch any errors that escape the main() try/catch (e.g. thrown in MCP
// transport callbacks or in unrelated async chains).  Claude Code surfaces
// stderr when a server exits unexpectedly, so every message written here will
// be visible to the user.

process.on("uncaughtException", (err) => {
  const dataDir = join(homedir(), ".context-mcp");
  const logEntry = {
    timestamp: new Date().toISOString(),
    error_type: "uncaughtException",
    message: err.message,
    stack: err.stack?.split("\n").slice(0, 5).join(" | "),
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cv_version: pkg.version,
  };
  appendErrorLog(dataDir, logEntry);
  console.error(`[context-vault] Uncaught exception: ${err.message}`);
  console.error(`[context-vault] Error log: ${join(dataDir, "error.log")}`);
  console.error(`[context-vault] Run: context-vault doctor`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  const dataDir = join(homedir(), ".context-mcp");
  const message = reason instanceof Error ? reason.message : String(reason);
  const logEntry = {
    timestamp: new Date().toISOString(),
    error_type: "unhandledRejection",
    message,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    cv_version: pkg.version,
  };
  appendErrorLog(dataDir, logEntry);
  console.error(`[context-vault] Unhandled rejection: ${message}`);
  console.error(`[context-vault] Error log: ${join(dataDir, "error.log")}`);
  console.error(`[context-vault] Run: context-vault doctor`);
  process.exit(1);
});

main().catch((err) => {
  console.error(`[context-vault] Unexpected fatal error: ${err.message}`);
  process.exit(1);
});
