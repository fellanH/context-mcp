/**
 * End-to-end onboarding test: full new-user journey.
 *
 * Tests the complete flow: setup -> save -> search -> recall -> uninstall.
 * Runs in an isolated HOME directory to avoid touching real user files.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CLI_PATH = resolve(__dirname, '../../packages/local/bin/cli.js');

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runCli(
  args: string,
  options: { env?: Record<string, string>; timeout?: number; input?: string } = {}
): RunResult {
  const { env = {}, timeout = 60000, input } = options;
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout,
      env: { ...process.env, ...env, NO_COLOR: '1', CONTEXT_VAULT_TEST: '1' },
      input,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('onboarding journey', () => {
  let tmpHome: string;
  let vaultDir: string;
  let dataDir: string;
  let configPath: string;
  let claudeRulesPath: string;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'cv-onboarding-e2e-'));
    vaultDir = join(tmpHome, '.vault');
    dataDir = join(tmpHome, '.context-mcp');
    configPath = join(dataDir, 'config.json');
    claudeRulesPath = join(tmpHome, '.claude', 'rules', 'context-vault.md');

    // Create the .claude dir so setup detects Claude Code as a tool and installs rules
    mkdirSync(join(tmpHome, '.claude', 'rules'), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  // ── Step 1: Setup ──────────────────────────────────────────────────────────

  it('setup exits successfully in non-interactive mode', () => {
    const { exitCode, stdout } = runCli('setup --yes --skip-embeddings', {
      env: { HOME: tmpHome },
      timeout: 90000,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Setup complete');
  }, 90000);

  it('setup creates vault directory', () => {
    expect(existsSync(vaultDir)).toBe(true);
  });

  it('setup writes config.json with vault and db paths', () => {
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.vaultDir).toBe(vaultDir);
    expect(config.dbPath).toBeDefined();
  });

  it('setup output includes transparency about installed file paths', () => {
    // The setup output should mention the temp HOME path to provide
    // transparency to the user about where files are being installed.
    const { stdout } = runCli('setup --yes --skip-embeddings', {
      env: { HOME: tmpHome },
      timeout: 90000,
    });
    expect(stdout).toContain(tmpHome);
  }, 90000);

  it('setup config can be patched to lower recall threshold for test isolation', () => {
    // Lower the minRelevanceScore so recall works in a freshly seeded vault.
    // In production, scores grow naturally as the vault accumulates entries.
    // In an isolated test vault with a single entry, FTS scores are low (~0.06),
    // so we lower the threshold to verify recall returns results at all.
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    config.recall = { ...config.recall, minRelevanceScore: 0 };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const updated = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(updated.recall.minRelevanceScore).toBe(0);
  });

  it('setup installs agent rules for Claude Code when .claude dir exists', () => {
    // The .claude dir was created in beforeAll, so rules should be installed.
    // If Claude Code detection fails for another reason, we skip gracefully.
    expect(existsSync(claudeRulesPath)).toBe(true);
    const rules = readFileSync(claudeRulesPath, 'utf-8');
    expect(rules.length).toBeGreaterThan(50);
    expect(rules).toContain('context-vault');
  });

  // ── Step 2: First save ─────────────────────────────────────────────────────

  it('save creates a vault entry successfully', () => {
    const { exitCode, stdout } = runCli(
      `save --kind insight --title "E2E onboarding test insight" --body "Testing the full onboarding flow end to end" --tags "e2e,onboarding" --source cli-test`,
      { env: { HOME: tmpHome } }
    );

    expect(exitCode).toBe(0);
    expect(stdout).toContain('Saved insight');
  });

  it('save creates a markdown file in the vault directory', () => {
    const insightDir = join(vaultDir, 'knowledge', 'insight');
    expect(existsSync(insightDir)).toBe(true);

    const mdFiles = readdirSync(insightDir).filter((f) => f.endsWith('.md'));
    // Seed entry + our saved entry = at least 2
    expect(mdFiles.length).toBeGreaterThanOrEqual(2);
  });

  it('saved markdown file contains the entry content', () => {
    const insightDir = join(vaultDir, 'knowledge', 'insight');
    const mdFiles = readdirSync(insightDir).filter((f) => f.endsWith('.md'));

    // Find the file containing our entry (not the seed)
    const ourFile = mdFiles
      .map((f) => readFileSync(join(insightDir, f), 'utf-8'))
      .find((content) => content.includes('E2E onboarding test insight'));

    expect(ourFile).toBeDefined();
    expect(ourFile).toContain('Testing the full onboarding flow end to end');
    expect(ourFile).toContain('e2e');
    expect(ourFile).toContain('onboarding');
  });

  it('saved entry is indexed in vault.db (searchable via CLI)', () => {
    const { exitCode, stdout } = runCli('search "E2E onboarding test" --limit 5', {
      env: { HOME: tmpHome },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('E2E onboarding test');
  });

  // ── Step 3: First recall (search) ─────────────────────────────────────────

  it('search returns the saved entry by title query', () => {
    const { exitCode, stdout } = runCli('search "onboarding test insight" --limit 5', {
      env: { HOME: tmpHome },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('E2E onboarding test insight');
  });

  it('search returns the saved entry by body content', () => {
    const { exitCode, stdout } = runCli('search "full onboarding flow end to end" --limit 5', {
      env: { HOME: tmpHome },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('onboarding');
  });

  // ── Step 4: Recall hook ────────────────────────────────────────────────────

  it('recall returns hints matching the saved entry via stdin JSON', () => {
    const recallPayload = JSON.stringify({ prompt: 'E2E onboarding test insight' });

    const { exitCode, stdout } = runCli('recall', {
      env: { HOME: tmpHome },
      input: recallPayload,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain('<context-vault>');
    expect(stdout).toContain('onboarding');
  });

  it('recall output is valid XML-wrapped context block', () => {
    const recallPayload = JSON.stringify({ prompt: 'E2E onboarding test insight' });

    const { stdout } = runCli('recall', {
      env: { HOME: tmpHome },
      input: recallPayload,
    });

    // Should be a well-formed context-vault block
    expect(stdout).toMatch(/<context-vault>[\s\S]+<\/context-vault>/);
    expect(stdout).toContain('<entry kind="insight"');
  });

  it('recall completes within a reasonable time budget', () => {
    const recallPayload = JSON.stringify({ prompt: 'E2E onboarding test' });

    const start = Date.now();
    runCli('recall', {
      env: { HOME: tmpHome },
      input: recallPayload,
    });
    const elapsed = Date.now() - start;

    // 10 second upper bound accounts for Node.js process startup overhead.
    // The underlying search logic itself runs in <200ms (verified separately in unit tests).
    expect(elapsed).toBeLessThan(10000);
  });

  // ── Step 5: Uninstall ──────────────────────────────────────────────────────

  it('uninstall exits successfully in non-interactive mode', () => {
    const { exitCode } = runCli('uninstall', {
      env: { HOME: tmpHome },
    });

    expect(exitCode).toBe(0);
  });

  it('uninstall removes agent rules file', () => {
    expect(existsSync(claudeRulesPath)).toBe(false);
  });

  it('uninstall does NOT delete vault data (user-owned)', () => {
    expect(existsSync(vaultDir)).toBe(true);

    const dbPath = join(dataDir, 'vault.db');
    expect(existsSync(dbPath)).toBe(true);
  });

  it('vault markdown files survive uninstall', () => {
    const insightDir = join(vaultDir, 'knowledge', 'insight');
    expect(existsSync(insightDir)).toBe(true);

    const mdFiles = readdirSync(insightDir).filter((f) => f.endsWith('.md'));
    expect(mdFiles.length).toBeGreaterThanOrEqual(1);

    // Specifically the seed entry should still be present
    const seedPath = join(insightDir, 'getting-started.md');
    expect(existsSync(seedPath)).toBe(true);
  });

  it('saved entry markdown file survives uninstall', () => {
    const insightDir = join(vaultDir, 'knowledge', 'insight');
    const files = readdirSync(insightDir).map((f) => readFileSync(join(insightDir, f), 'utf-8'));
    const ourEntry = files.find((c) => c.includes('E2E onboarding test insight'));
    expect(ourEntry).toBeDefined();
  });
});

describe('onboarding journey — Cursor MCP config roundtrip', () => {
  let tmpHome: string;
  let vaultDir: string;
  let dataDir: string;
  let cursorConfigPath: string;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'cv-onboarding-cursor-'));
    vaultDir = join(tmpHome, '.vault');
    dataDir = join(tmpHome, '.context-mcp');
    cursorConfigPath = join(tmpHome, '.cursor', 'mcp.json');

    mkdirSync(join(tmpHome, '.cursor'), { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it('setup writes Cursor MCP config with context-vault entry', () => {
    const { exitCode } = runCli('setup --yes --skip-embeddings', {
      env: { HOME: tmpHome },
      timeout: 90000,
    });

    expect(exitCode).toBe(0);
    expect(existsSync(cursorConfigPath)).toBe(true);

    const config = JSON.parse(readFileSync(cursorConfigPath, 'utf-8'));
    expect(config.mcpServers?.['context-vault']).toBeDefined();
    expect(config.mcpServers['context-vault'].command).toBeDefined();
    expect(Array.isArray(config.mcpServers['context-vault'].args)).toBe(true);
  }, 90000);

  it('uninstall removes context-vault entry from Cursor MCP config', () => {
    const { exitCode } = runCli('uninstall', {
      env: { HOME: tmpHome },
    });

    expect(exitCode).toBe(0);

    const config = JSON.parse(readFileSync(cursorConfigPath, 'utf-8'));
    expect(config.mcpServers?.['context-vault']).toBeUndefined();
  });

  it('vault data survives Cursor-path uninstall', () => {
    expect(existsSync(vaultDir)).toBe(true);
    expect(existsSync(join(dataDir, 'vault.db'))).toBe(true);
  });
});
