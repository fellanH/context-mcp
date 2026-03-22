import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { DEFAULT_GROWTH_THRESHOLDS, DEFAULT_LIFECYCLE, DEFAULT_AUTO_INSIGHTS, DEFAULT_INDEXING } from './constants.js';
import type { VaultConfig } from './types.js';

/**
 * Guard against writes to the real config file during test runs.
 * Set CONTEXT_VAULT_TEST=1 in test helpers to activate.
 *
 * Allows writes if the target path is under a temp directory (tests with
 * HOME overridden to a temp dir). Blocks writes to non-temp paths.
 */
export function assertNotTestMode(targetPath: string): void {
  if (process.env.CONTEXT_VAULT_TEST !== '1') return;
  const resolved = resolve(targetPath);
  const tmp = tmpdir();
  // Allow writes to temp directories (tests with HOME isolation)
  if (resolved.startsWith(tmp) || resolved.startsWith('/tmp/') || resolved.startsWith('/var/folders/')) {
    return;
  }
  throw new Error(
    `[context-vault] Refusing to write to real config in test mode (${targetPath}). ` +
      'Set HOME or CONTEXT_VAULT_DATA_DIR to a temp directory.'
  );
}

export function parseArgs(argv: string[]): Record<string, string | number> {
  const args: Record<string, string | number> = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--vault-dir' && argv[i + 1]) args.vaultDir = argv[++i];
    else if (argv[i] === '--data-dir' && argv[i + 1]) args.dataDir = argv[++i];
    else if (argv[i] === '--db-path' && argv[i + 1]) args.dbPath = argv[++i];
    else if (argv[i] === '--dev-dir' && argv[i + 1]) args.devDir = argv[++i];
    else if (argv[i] === '--event-decay-days' && argv[i + 1])
      args.eventDecayDays = Number(argv[++i]);
  }
  return args;
}

export function resolveConfig(): VaultConfig {
  const HOME = homedir();
  const cliArgs = parseArgs(process.argv);

  const dataDir = resolve(
    (cliArgs.dataDir as string) ||
      process.env.CONTEXT_VAULT_DATA_DIR ||
      process.env.CONTEXT_MCP_DATA_DIR ||
      join(HOME, '.context-mcp')
  );
  const config: VaultConfig = {
    vaultDir: join(HOME, '.vault'),
    dataDir,
    dbPath: join(dataDir, 'vault.db'),
    devDir: join(HOME, 'dev'),
    eventDecayDays: 30,
    thresholds: { ...DEFAULT_GROWTH_THRESHOLDS },
    telemetry: false,
    resolvedFrom: 'defaults',
    recall: {
      maxResults: 5,
      maxOutputBytes: 2000,
      minRelevanceScore: 0.3,
      excludeKinds: [],
      excludeCategories: ['event'],
      bodyTruncateChars: 400,
    },
    consolidation: {
      tagThreshold: 10,
      maxAgeDays: 7,
      autoConsolidate: false,
    },
    lifecycle: structuredClone(DEFAULT_LIFECYCLE),
    autoInsights: { ...DEFAULT_AUTO_INSIGHTS },
    indexing: { ...DEFAULT_INDEXING },
  };

  const configPath = join(dataDir, 'config.json');
  if (existsSync(configPath)) {
    try {
      const fc = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (fc.vaultDir) config.vaultDir = fc.vaultDir;
      if (fc.dataDir) {
        config.dataDir = fc.dataDir;
        config.dbPath = join(resolve(fc.dataDir), 'vault.db');
      }
      if (fc.dbPath) config.dbPath = fc.dbPath;
      if (fc.devDir) config.devDir = fc.devDir;
      if (fc.eventDecayDays != null) config.eventDecayDays = fc.eventDecayDays;
      if (fc.growthWarningThreshold != null) {
        config.thresholds.totalEntries = {
          ...config.thresholds.totalEntries,
          warn: Number(fc.growthWarningThreshold),
        };
      }
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
      if (fc.recall && typeof fc.recall === 'object') {
        const r = fc.recall;
        if (r.maxResults != null) config.recall.maxResults = Number(r.maxResults);
        if (r.maxOutputBytes != null) config.recall.maxOutputBytes = Number(r.maxOutputBytes);
        if (r.minRelevanceScore != null)
          config.recall.minRelevanceScore = Number(r.minRelevanceScore);
        if (Array.isArray(r.excludeKinds)) config.recall.excludeKinds = r.excludeKinds;
        if (Array.isArray(r.excludeCategories))
          config.recall.excludeCategories = r.excludeCategories;
        if (r.bodyTruncateChars != null)
          config.recall.bodyTruncateChars = Number(r.bodyTruncateChars);
      }
      if (fc.consolidation && typeof fc.consolidation === 'object') {
        const c = fc.consolidation;
        if (c.tagThreshold != null) config.consolidation.tagThreshold = Number(c.tagThreshold);
        if (c.maxAgeDays != null) config.consolidation.maxAgeDays = Number(c.maxAgeDays);
        if (c.autoConsolidate != null)
          config.consolidation.autoConsolidate = c.autoConsolidate === true;
      }
      if (fc.lifecycle && typeof fc.lifecycle === 'object') {
        for (const [tier, rules] of Object.entries(fc.lifecycle)) {
          if (rules && typeof rules === 'object') {
            if (!config.lifecycle[tier]) config.lifecycle[tier] = {};
            if ((rules as Record<string, unknown>).archiveAfterDays != null)
              config.lifecycle[tier].archiveAfterDays = Number(
                (rules as Record<string, unknown>).archiveAfterDays
              );
          }
        }
      }
      if (fc.autoInsights && typeof fc.autoInsights === 'object') {
        const ai = fc.autoInsights;
        if (ai.enabled != null) config.autoInsights.enabled = ai.enabled === true;
        if (Array.isArray(ai.patterns)) config.autoInsights.patterns = ai.patterns;
        if (ai.minChars != null) config.autoInsights.minChars = Number(ai.minChars);
        if (ai.maxPerSession != null) config.autoInsights.maxPerSession = Number(ai.maxPerSession);
        if (ai.tier) config.autoInsights.tier = String(ai.tier);
      }
      if (fc.indexing && typeof fc.indexing === 'object') {
        const ix = fc.indexing;
        if (Array.isArray(ix.excludeKinds)) config.indexing.excludeKinds = ix.excludeKinds;
        if (Array.isArray(ix.excludeCategories)) config.indexing.excludeCategories = ix.excludeCategories;
        if (ix.maxBodySize != null) config.indexing.maxBodySize = Number(ix.maxBodySize);
        if (ix.autoIndexEvents != null) config.indexing.autoIndexEvents = ix.autoIndexEvents === true;
      }
      config.resolvedFrom = 'config file';
    } catch (e) {
      throw new Error(`[context-vault] Invalid config at ${configPath}: ${(e as Error).message}`);
    }
  }
  config.configPath = configPath;

  if (process.env.CONTEXT_VAULT_VAULT_DIR || process.env.CONTEXT_MCP_VAULT_DIR) {
    config.vaultDir = process.env.CONTEXT_VAULT_VAULT_DIR || process.env.CONTEXT_MCP_VAULT_DIR!;
    config.resolvedFrom = 'env';
  }
  if (process.env.CONTEXT_VAULT_DB_PATH || process.env.CONTEXT_MCP_DB_PATH) {
    config.dbPath = process.env.CONTEXT_VAULT_DB_PATH || process.env.CONTEXT_MCP_DB_PATH!;
    config.resolvedFrom = 'env';
  }
  if (process.env.CONTEXT_VAULT_DEV_DIR || process.env.CONTEXT_MCP_DEV_DIR) {
    config.devDir = process.env.CONTEXT_VAULT_DEV_DIR || process.env.CONTEXT_MCP_DEV_DIR!;
    config.resolvedFrom = 'env';
  }
  if (
    process.env.CONTEXT_VAULT_EVENT_DECAY_DAYS != null ||
    process.env.CONTEXT_MCP_EVENT_DECAY_DAYS != null
  ) {
    config.eventDecayDays = Number(
      process.env.CONTEXT_VAULT_EVENT_DECAY_DAYS ?? process.env.CONTEXT_MCP_EVENT_DECAY_DAYS
    );
    config.resolvedFrom = 'env';
  }

  if (process.env.CONTEXT_VAULT_TELEMETRY !== undefined) {
    config.telemetry =
      process.env.CONTEXT_VAULT_TELEMETRY === '1' || process.env.CONTEXT_VAULT_TELEMETRY === 'true';
  }

  if (cliArgs.vaultDir) {
    config.vaultDir = cliArgs.vaultDir as string;
    config.resolvedFrom = 'CLI args';
  }
  if (cliArgs.dbPath) {
    config.dbPath = cliArgs.dbPath as string;
    config.resolvedFrom = 'CLI args';
  }
  if (cliArgs.devDir) {
    config.devDir = cliArgs.devDir as string;
    config.resolvedFrom = 'CLI args';
  }
  if (cliArgs.eventDecayDays != null) {
    config.eventDecayDays = cliArgs.eventDecayDays as number;
    config.resolvedFrom = 'CLI args';
  }

  config.vaultDir = resolve(config.vaultDir);
  config.dataDir = resolve(config.dataDir);
  config.dbPath = resolve(config.dbPath);
  config.devDir = resolve(config.devDir);
  config.vaultDirExists = existsSync(config.vaultDir);

  return config;
}
