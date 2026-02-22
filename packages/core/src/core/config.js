import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { DEFAULT_GROWTH_THRESHOLDS } from "../constants.js";

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
    thresholds: { ...DEFAULT_GROWTH_THRESHOLDS },
    telemetry: false,
    resolvedFrom: "defaults",
  };

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
      if (fc.thresholds) {
        const t = fc.thresholds;
        if (t.totalEntries)
          config.thresholds.totalEntries = {
            ...config.thresholds.totalEntries,
            ...t.totalEntries,
          };
        if (t.eventEntries)
          config.thresholds.eventEntries = {
            ...config.thresholds.eventEntries,
            ...t.eventEntries,
          };
        if (t.vaultSizeBytes)
          config.thresholds.vaultSizeBytes = {
            ...config.thresholds.vaultSizeBytes,
            ...t.vaultSizeBytes,
          };
        if (t.eventsWithoutTtl)
          config.thresholds.eventsWithoutTtl = {
            ...config.thresholds.eventsWithoutTtl,
            ...t.eventsWithoutTtl,
          };
      }
      if (fc.telemetry != null) config.telemetry = fc.telemetry === true;
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

  if (process.env.CONTEXT_VAULT_API_KEY) {
    config.apiKey = process.env.CONTEXT_VAULT_API_KEY;
  }
  if (process.env.CONTEXT_VAULT_HOSTED_URL) {
    config.hostedUrl = process.env.CONTEXT_VAULT_HOSTED_URL;
  }
  if (process.env.CONTEXT_VAULT_TELEMETRY !== undefined) {
    config.telemetry =
      process.env.CONTEXT_VAULT_TELEMETRY === "1" ||
      process.env.CONTEXT_VAULT_TELEMETRY === "true";
  }

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
