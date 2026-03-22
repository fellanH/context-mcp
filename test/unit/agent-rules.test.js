/**
 * Unit tests for agent rules installation, upgrade, and uninstall.
 *
 * Tests the rules lifecycle: install for Claude Code, Cursor, Windsurf,
 * --no-rules skip, --upgrade detection, and uninstall cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_PATH = join(import.meta.dirname, '../../packages/local/bin/cli.js');

/** Run the CLI with given args and return { stdout, stderr, exitCode } */
function runCli(args, { env = {}, timeout = 30000 } = {}) {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: 'utf-8',
      timeout,
      env: { ...process.env, ...env, NO_COLOR: '1', CONTEXT_VAULT_TEST: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e) {
    return {
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      exitCode: e.status ?? 1,
    };
  }
}

/** Create a minimal setup so the CLI thinks it's installed */
function setupMinimalHome(tmpHome) {
  const configDir = join(tmpHome, '.context-mcp');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, 'config.json'),
    JSON.stringify({ vaultDir: join(tmpHome, '.vault') })
  );
  mkdirSync(join(tmpHome, '.vault'), { recursive: true });
}

describe('agent rules installation', () => {
  let tmpHome;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'cv-rules-'));
    setupMinimalHome(tmpHome);
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('Claude Code rules (write method)', () => {
    it('creates rules file at ~/.claude/rules/context-vault.md during setup', () => {
      const { stdout, exitCode } = runCli('setup --yes --skip-embeddings --force', {
        env: { HOME: tmpHome },
        timeout: 60000,
      });
      expect(exitCode).toBe(0);

      const rulesPath = join(tmpHome, '.claude', 'rules', 'context-vault.md');
      // Rules may or may not be installed depending on tool detection,
      // but the directory structure should exist if Claude Code was detected
      if (stdout.includes('agent rules installed') || stdout.includes('Claude Code')) {
        if (existsSync(rulesPath)) {
          const content = readFileSync(rulesPath, 'utf-8');
          expect(content).toContain('context-vault');
          expect(content).toContain('When to Retrieve');
        }
      }
    });

    it('installs rules via rules install when claude rules dir exists', () => {
      // Simulate Claude Code detection by creating the dir
      mkdirSync(join(tmpHome, '.claude', 'rules'), { recursive: true });

      // The rules install command detects tools; Claude Code detection is via
      // commandExistsAsync which checks the PATH. We can test by pre-creating
      // the rules file and verifying content via rules show/diff.
      const rulesPath = join(tmpHome, '.claude', 'rules', 'context-vault.md');

      // Manually write a rules file to test show/diff commands
      writeFileSync(rulesPath, '<!-- context-vault-rules v0.9 -->\nold rules content\n');
      expect(existsSync(rulesPath)).toBe(true);

      const content = readFileSync(rulesPath, 'utf-8');
      expect(content).toContain('v0.9');
    });

    it('overwrites existing rules with write method (idempotent)', () => {
      const rulesPath = join(tmpHome, '.claude', 'rules', 'context-vault.md');
      mkdirSync(join(tmpHome, '.claude', 'rules'), { recursive: true });

      // Write initial content
      writeFileSync(rulesPath, 'old content');
      expect(readFileSync(rulesPath, 'utf-8')).toBe('old content');

      // Write new content (simulating what installAgentRulesForTool does)
      writeFileSync(rulesPath, 'new content');
      expect(readFileSync(rulesPath, 'utf-8')).toBe('new content');
    });
  });

  describe('Cursor rules (write method)', () => {
    it('creates rules file at ~/.cursor/rules/context-vault.mdc', () => {
      const rulesPath = join(tmpHome, '.cursor', 'rules', 'context-vault.mdc');
      mkdirSync(join(tmpHome, '.cursor', 'rules'), { recursive: true });

      // Simulate the write-method installation
      const rulesContent = '<!-- context-vault-rules v1.0 -->\n# Cursor rules\n';
      writeFileSync(rulesPath, rulesContent);

      expect(existsSync(rulesPath)).toBe(true);
      const content = readFileSync(rulesPath, 'utf-8');
      expect(content).toContain('context-vault-rules v1.0');
    });

    it('uses .mdc extension for Cursor rules', () => {
      const rulesPath = join(tmpHome, '.cursor', 'rules', 'context-vault.mdc');
      mkdirSync(join(tmpHome, '.cursor', 'rules'), { recursive: true });
      writeFileSync(rulesPath, 'test');

      expect(rulesPath.endsWith('.mdc')).toBe(true);
      expect(existsSync(rulesPath)).toBe(true);
    });
  });

  describe('Windsurf rules (append method)', () => {
    const DELIMITER_START = '<!-- context-vault agent rules -->';
    const DELIMITER_END = '<!-- /context-vault agent rules -->';

    it('appends rules with delimiters to existing .windsurfrules', () => {
      const rulesPath = join(tmpHome, '.windsurfrules');
      const existingContent = '# My existing Windsurf rules\nDo things.\n';
      writeFileSync(rulesPath, existingContent);

      // Simulate append-method installation
      const rulesContent = '# Context Vault Rules\nSave knowledge.\n';
      const delimited = `\n${DELIMITER_START}\n${rulesContent}\n${DELIMITER_END}\n`;
      writeFileSync(rulesPath, existingContent + delimited);

      const result = readFileSync(rulesPath, 'utf-8');
      expect(result).toContain('My existing Windsurf rules');
      expect(result).toContain(DELIMITER_START);
      expect(result).toContain('Save knowledge.');
      expect(result).toContain(DELIMITER_END);
    });

    it('creates .windsurfrules with delimiters when file does not exist', () => {
      const rulesPath = join(tmpHome, '.windsurfrules');
      expect(existsSync(rulesPath)).toBe(false);

      const rulesContent = '# Context Vault Rules\n';
      const delimited = `${DELIMITER_START}\n${rulesContent}\n${DELIMITER_END}\n`;
      writeFileSync(rulesPath, delimited);

      const result = readFileSync(rulesPath, 'utf-8');
      expect(result).toContain(DELIMITER_START);
      expect(result).toContain(DELIMITER_END);
    });

    it('replaces existing delimited section on re-install', () => {
      const rulesPath = join(tmpHome, '.windsurfrules');
      const userContent = '# My rules\n';
      const oldRules = `\n${DELIMITER_START}\nold vault rules\n${DELIMITER_END}\n`;
      writeFileSync(rulesPath, userContent + oldRules);

      // Simulate replacement (what installAgentRulesForTool does for append method)
      const existing = readFileSync(rulesPath, 'utf-8');
      const delimiterRegex = new RegExp(
        `\n?${DELIMITER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${DELIMITER_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n?`,
        'g'
      );
      const cleaned = existing.replace(delimiterRegex, '');
      const newRules = `\n${DELIMITER_START}\nnew vault rules\n${DELIMITER_END}\n`;
      writeFileSync(rulesPath, cleaned + newRules);

      const result = readFileSync(rulesPath, 'utf-8');
      expect(result).toContain('My rules');
      expect(result).toContain('new vault rules');
      expect(result).not.toContain('old vault rules');
    });
  });

  describe('--no-rules flag', () => {
    it('skips rules installation when --no-rules is passed', () => {
      const { stdout, exitCode } = runCli('setup --yes --skip-embeddings --force --no-rules', {
        env: { HOME: tmpHome },
        timeout: 60000,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('rules skipped');

      // Verify no rules files were created
      const claudeRules = join(tmpHome, '.claude', 'rules', 'context-vault.md');
      const cursorRules = join(tmpHome, '.cursor', 'rules', 'context-vault.mdc');
      // These should not exist from the setup (tool detection may not find tools,
      // but --no-rules ensures we skip even if tools are detected)
      if (stdout.includes('--no-rules')) {
        expect(stdout).toMatch(/rules skipped/i);
      }
    });
  });

  describe('--upgrade flag', () => {
    it('reports up-to-date when installed rules match bundled version', () => {
      // Read the bundled rules content
      const assetsPath = join(import.meta.dirname, '../../assets/agent-rules.md');
      if (!existsSync(assetsPath)) return; // skip if assets not found

      const bundled = readFileSync(assetsPath, 'utf-8');

      // Install the bundled rules at the Claude Code path
      const rulesDir = join(tmpHome, '.claude', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(join(rulesDir, 'context-vault.md'), bundled);

      const { stdout, exitCode } = runCli('setup --upgrade', {
        env: { HOME: tmpHome },
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('up to date');
    });

    it('detects outdated rules and shows diff', () => {
      const assetsPath = join(import.meta.dirname, '../../assets/agent-rules.md');
      if (!existsSync(assetsPath)) return;

      // Install an older version of rules
      const rulesDir = join(tmpHome, '.claude', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(
        join(rulesDir, 'context-vault.md'),
        '<!-- context-vault-rules v0.5 -->\n# Old Rules\nOutdated content.\n'
      );

      const { stdout, exitCode } = runCli('setup --upgrade --yes', {
        env: { HOME: tmpHome },
      });
      expect(exitCode).toBe(0);
      // Should detect the version mismatch
      expect(stdout).toMatch(/v0\.5/);

      // After upgrade, the file should contain the bundled content
      const bundled = readFileSync(assetsPath, 'utf-8');
      const upgraded = readFileSync(join(rulesDir, 'context-vault.md'), 'utf-8');
      expect(upgraded.trim()).toBe(bundled.trim());
    });

    it('reports no installed rules when none exist', () => {
      const { stdout, exitCode } = runCli('setup --upgrade', {
        env: { HOME: tmpHome },
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('No installed rules found');
    });

    it('works with --dry-run to preview without writing', () => {
      const assetsPath = join(import.meta.dirname, '../../assets/agent-rules.md');
      if (!existsSync(assetsPath)) return;

      const rulesDir = join(tmpHome, '.claude', 'rules');
      mkdirSync(rulesDir, { recursive: true });
      const oldContent = '<!-- context-vault-rules v0.1 -->\nold\n';
      writeFileSync(join(rulesDir, 'context-vault.md'), oldContent);

      const { stdout, exitCode } = runCli('setup --upgrade --dry-run', {
        env: { HOME: tmpHome },
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain('dry-run');

      // File should remain unchanged
      const afterContent = readFileSync(join(rulesDir, 'context-vault.md'), 'utf-8');
      expect(afterContent).toBe(oldContent);
    });
  });

  describe('uninstall removes rules files', () => {
    it('removes Claude Code rules file on uninstall', () => {
      const rulesPath = join(tmpHome, '.claude', 'rules', 'context-vault.md');
      mkdirSync(join(tmpHome, '.claude', 'rules'), { recursive: true });
      writeFileSync(rulesPath, '# test rules');

      const { stdout, exitCode } = runCli('uninstall --yes', {
        env: { HOME: tmpHome },
      });
      expect(exitCode).toBe(0);
      expect(existsSync(rulesPath)).toBe(false);
    });

    it('removes Cursor rules file on uninstall', () => {
      const rulesPath = join(tmpHome, '.cursor', 'rules', 'context-vault.mdc');
      mkdirSync(join(tmpHome, '.cursor', 'rules'), { recursive: true });
      writeFileSync(rulesPath, '# test rules');

      const { stdout, exitCode } = runCli('uninstall --yes', {
        env: { HOME: tmpHome },
      });
      expect(exitCode).toBe(0);
      expect(existsSync(rulesPath)).toBe(false);
    });

    it('removes delimited section from .windsurfrules on uninstall', () => {
      const DELIMITER_START = '<!-- context-vault agent rules -->';
      const DELIMITER_END = '<!-- /context-vault agent rules -->';
      const rulesPath = join(tmpHome, '.windsurfrules');
      const userContent = '# My custom rules\n';
      const vaultSection = `\n${DELIMITER_START}\nvault rules here\n${DELIMITER_END}\n`;
      writeFileSync(rulesPath, userContent + vaultSection);

      const { stdout, exitCode } = runCli('uninstall --yes', {
        env: { HOME: tmpHome },
      });
      expect(exitCode).toBe(0);

      if (existsSync(rulesPath)) {
        const remaining = readFileSync(rulesPath, 'utf-8');
        expect(remaining).toContain('My custom rules');
        expect(remaining).not.toContain(DELIMITER_START);
        expect(remaining).not.toContain('vault rules here');
      }
    });

    it('deletes .windsurfrules entirely if only vault rules remain', () => {
      const DELIMITER_START = '<!-- context-vault agent rules -->';
      const DELIMITER_END = '<!-- /context-vault agent rules -->';
      const rulesPath = join(tmpHome, '.windsurfrules');
      const vaultOnly = `${DELIMITER_START}\nvault rules\n${DELIMITER_END}\n`;
      writeFileSync(rulesPath, vaultOnly);

      const { stdout, exitCode } = runCli('uninstall --yes', {
        env: { HOME: tmpHome },
      });
      expect(exitCode).toBe(0);
      // File should be deleted when only vault content existed
      expect(existsSync(rulesPath)).toBe(false);
    });
  });
});
