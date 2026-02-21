/**
 * config.js — CLI argument parsing and configuration resolution
 *
 * Resolution chain (highest priority last):
 *   1. Convention defaults
 *   2. Config file (~/.context-mcp/config.json)
 *   3. Environment variables (CONTEXT_VAULT_* or CONTEXT_MCP_*)
 *   4. CLI arguments
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

export function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--vault-dir" && argv[i + 1]) args.vaultDir = argv[++i];
    else if (argv[i] === "--data-dir" && argv[i + 1]) args.dataDir = argv[++i];
    else if (argv[i] === "--db-path" && argv[i + 1]) args.dbPath = argv[++i];
    else if (argv[i] === "--dev-dir" && argv[i + 1]) args.devDir = argv[++i];
    else if (argv[i] === "--event-decay-days" && argv[i + 1])
      args.eventDecayDays = Number(argv[++i]);
  }
  return args;
}

export function resolveConfig() {
  const HOME = homedir();
  const cliArgs = parseArgs(process.argv);

  // 1. Convention defaults
  const dataDir = resolve(
    cliArgs.dataDir ||
      process.env.CONTEXT_VAULT_DATA_DIR ||
      process.env.CONTEXT_MCP_DATA_DIR ||
      join(HOME, ".context-mcp"),
  );
  const config = {
    vaultDir: join(HOME, "vault"),
    dataDir,
    dbPath: join(dataDir, "vault.db"),
    devDir: join(HOME, "dev"),
    eventDecayDays: 30,
    resolvedFrom: "defaults",
  };

  // 2. Config file
  const configPath = join(dataDir, "config.json");
  if (existsSync(configPath)) {
    try {
      const fc = JSON.parse(readFileSync(configPath, "utf-8"));
      if (fc.vaultDir) config.vaultDir = fc.vaultDir;
      if (fc.dataDir) {
        config.dataDir = fc.dataDir;
        config.dbPath = join(resolve(fc.dataDir), "vault.db");
      }
      if (fc.dbPath) config.dbPath = fc.dbPath;
      if (fc.devDir) config.devDir = fc.devDir;
      if (fc.eventDecayDays != null) config.eventDecayDays = fc.eventDecayDays;
      // Hosted account linking (Phase 4)
      if (fc.hostedUrl) config.hostedUrl = fc.hostedUrl;
      if (fc.apiKey) config.apiKey = fc.apiKey;
      if (fc.userId) config.userId = fc.userId;
      if (fc.email) config.email = fc.email;
      if (fc.linkedAt) config.linkedAt = fc.linkedAt;
      config.resolvedFrom = "config file";
    } catch (e) {
      throw new Error(
        `[context-vault] Invalid config at ${configPath}: ${e.message}`,
      );
    }
  }
  config.configPath = configPath;

  // 3. Environment variable overrides (CONTEXT_VAULT_* takes priority over CONTEXT_MCP_*)
  if (
    process.env.CONTEXT_VAULT_VAULT_DIR ||
    process.env.CONTEXT_MCP_VAULT_DIR
  ) {
    config.vaultDir =
      process.env.CONTEXT_VAULT_VAULT_DIR || process.env.CONTEXT_MCP_VAULT_DIR;
    config.resolvedFrom = "env";
  }
  if (process.env.CONTEXT_VAULT_DB_PATH || process.env.CONTEXT_MCP_DB_PATH) {
    config.dbPath =
      process.env.CONTEXT_VAULT_DB_PATH || process.env.CONTEXT_MCP_DB_PATH;
    config.resolvedFrom = "env";
  }
  if (process.env.CONTEXT_VAULT_DEV_DIR || process.env.CONTEXT_MCP_DEV_DIR) {
    config.devDir =
      process.env.CONTEXT_VAULT_DEV_DIR || process.env.CONTEXT_MCP_DEV_DIR;
    config.resolvedFrom = "env";
  }
  if (
    process.env.CONTEXT_VAULT_EVENT_DECAY_DAYS != null ||
    process.env.CONTEXT_MCP_EVENT_DECAY_DAYS != null
  ) {
    config.eventDecayDays = Number(
      process.env.CONTEXT_VAULT_EVENT_DECAY_DAYS ??
        process.env.CONTEXT_MCP_EVENT_DECAY_DAYS,
    );
    config.resolvedFrom = "env";
  }

  // 3b. Hosted account env overrides
  if (process.env.CONTEXT_VAULT_API_KEY) {
    config.apiKey = process.env.CONTEXT_VAULT_API_KEY;
  }
  if (process.env.CONTEXT_VAULT_HOSTED_URL) {
    config.hostedUrl = process.env.CONTEXT_VAULT_HOSTED_URL;
  }

  // 4. CLI arg overrides (highest priority)
  if (cliArgs.vaultDir) {
    config.vaultDir = cliArgs.vaultDir;
    config.resolvedFrom = "CLI args";
  }
  if (cliArgs.dbPath) {
    config.dbPath = cliArgs.dbPath;
    config.resolvedFrom = "CLI args";
  }
  if (cliArgs.devDir) {
    config.devDir = cliArgs.devDir;
    config.resolvedFrom = "CLI args";
  }
  if (cliArgs.eventDecayDays != null) {
    config.eventDecayDays = cliArgs.eventDecayDays;
    config.resolvedFrom = "CLI args";
  }

  // Resolve all paths to absolute
  config.vaultDir = resolve(config.vaultDir);
  config.dataDir = resolve(config.dataDir);
  config.dbPath = resolve(config.dbPath);
  config.devDir = resolve(config.devDir);

  // Check existence
  config.vaultDirExists = existsSync(config.vaultDir);

  return config;
}
