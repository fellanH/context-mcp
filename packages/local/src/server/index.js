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
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"),
);

import { resolveConfig } from "@context-vault/core/core/config";
import { embed } from "@context-vault/core/index/embed";
import {
  initDatabase,
  NativeModuleError,
  prepareStatements,
  insertVec,
  deleteVec,
} from "@context-vault/core/index/db";
import { registerTools } from "@context-vault/core/server/tools";

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

    // ── Phase: SERVER ────────────────────────────────────────────────────────
    phase = "SERVER";
    const server = new McpServer(
      { name: "context-vault", version: pkg.version },
      { capabilities: { tools: {} } },
    );

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
      console.error("");
      process.exit(78); // EX_CONFIG
    }

    console.error(
      `[context-vault] Fatal error during ${phase} phase: ${err.message}`,
    );
    if (phase === "DB") {
      console.error(
        `[context-vault] Try deleting the DB file and restarting: rm "${config?.dbPath || "vault.db"}"`,
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[context-vault] Unexpected fatal error: ${err.message}`);
  process.exit(1);
});
