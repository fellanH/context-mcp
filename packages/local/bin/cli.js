#!/usr/bin/env node

// Node.js version guard — must run before any ESM imports
const nodeVersion = parseInt(process.versions.node.split('.')[0], 10);
if (nodeVersion < 22) {
  process.stderr.write(
    `\ncontext-vault requires Node.js >= 22 (you have ${process.versions.node}).\n` +
      `Install a newer version: https://nodejs.org/\n\n`
  );
  process.exit(1);
}

import { createInterface } from 'node:readline';
import {
  existsSync,
  statSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { execSync, execFile, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_URL, API_URL, MARKETING_URL } from '@context-vault/core/constants';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');
const HOME = homedir();

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const VERSION = pkg.version;
const SERVER_PATH = resolve(ROOT, 'dist', 'server.js');

/** Detect if running as an npm-installed package (global or local) vs local dev clone */
function isInstalledPackage() {
  if (ROOT.includes('/node_modules/') || ROOT.includes('\\node_modules\\')) return true;
  // Also check if `context-vault` binary on PATH resolves to this package
  try {
    const which = execSync('which context-vault', { encoding: 'utf-8', stdio: 'pipe' }).trim();
    if (which) return true;
  } catch {}
  return false;
}

/** Detect if running via npx (ephemeral cache — paths won't survive cache eviction) */
function isNpx() {
  return ROOT.includes('/_npx/') || ROOT.includes('\\_npx\\');
}

const MARKER_FILE = '.context-vault';

function writeMarkerFile(vaultDir) {
  const markerPath = join(vaultDir, MARKER_FILE);
  if (!existsSync(markerPath)) {
    writeFileSync(
      markerPath,
      JSON.stringify({ version: 1, created: new Date().toISOString() }, null, 2) + '\n'
    );
  }
}

function scanForVaults() {
  const candidates = [
    join(HOME, '.vault'),
    join(HOME, 'vault'),
    join(HOME, 'omni', 'vault'),
    process.cwd(),
  ];

  // Also check existing config
  const configPath = join(HOME, '.context-mcp', 'config.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
      if (cfg.vaultDir && !candidates.includes(cfg.vaultDir)) {
        candidates.unshift(cfg.vaultDir);
      }
    } catch {}
  }

  const found = [];
  for (const dir of candidates) {
    const markerPath = join(dir, MARKER_FILE);
    if (existsSync(markerPath)) {
      let entryCount = 0;
      try {
        const knowledgeDir = join(dir, 'knowledge');
        if (existsSync(knowledgeDir)) {
          const countFiles = (d) => {
            let count = 0;
            for (const entry of readdirSync(d, { withFileTypes: true })) {
              if (entry.isDirectory()) count += countFiles(join(d, entry.name));
              else if (entry.name.endsWith('.md')) count++;
            }
            return count;
          };
          entryCount = countFiles(knowledgeDir);
        }
      } catch {}
      found.push({ path: dir, entryCount });
    }
  }
  return found;
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.filter((a) => a.startsWith('--')));
const isNonInteractive = flags.has('--yes') || !process.stdin.isTTY;

function getFlag(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

function prompt(question, defaultVal) {
  if (isNonInteractive) return Promise.resolve(defaultVal || '');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultVal ? ` ${dim(`(${defaultVal})`)}` : '';
  return new Promise((res) => {
    rl.question(`${question}${suffix} `, (answer) => {
      rl.close();
      res(answer.trim() || defaultVal || '');
    });
  });
}

const PLATFORM = platform();

/** Get the platform-specific application data directory */
function appDataDir() {
  switch (PLATFORM) {
    case 'win32':
      return process.env.APPDATA || join(HOME, 'AppData', 'Roaming');
    case 'darwin':
      return join(HOME, 'Library', 'Application Support');
    case 'linux':
    default:
      return process.env.XDG_CONFIG_HOME || join(HOME, '.config');
  }
}

/** Get the platform-specific VS Code extensions directory */
function vscodeDataDir() {
  switch (PLATFORM) {
    case 'win32':
      return join(appDataDir(), 'Code', 'User', 'globalStorage');
    case 'darwin':
      return join(appDataDir(), 'Code', 'User', 'globalStorage');
    case 'linux':
    default:
      return join(HOME, '.config', 'Code', 'User', 'globalStorage');
  }
}

function commandExistsAsync(bin) {
  const cmd = PLATFORM === 'win32' ? 'where' : 'which';
  return new Promise((resolve) => {
    execFile(cmd, [bin], { timeout: 5000 }, (err) => resolve(!err));
  });
}

/** Check if a directory exists at any of the given paths */
function anyDirExists(...paths) {
  return paths.some((p) => existsSync(p));
}

const TOOLS = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    detect: () => commandExistsAsync('claude'),
    configType: 'cli',
  },
  {
    id: 'codex',
    name: 'Codex',
    detect: () => commandExistsAsync('codex'),
    configType: 'cli',
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    detect: () => existsSync(join(appDataDir(), 'Claude')),
    configType: 'json',
    configPath: join(appDataDir(), 'Claude', 'claude_desktop_config.json'),
    configKey: 'mcpServers',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    detect: () => anyDirExists(join(HOME, '.cursor'), join(appDataDir(), 'Cursor')),
    configType: 'json',
    configPath: join(HOME, '.cursor', 'mcp.json'),
    configKey: 'mcpServers',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    detect: () => anyDirExists(join(HOME, '.codeium', 'windsurf'), join(HOME, '.windsurf')),
    configType: 'json',
    get configPath() {
      return existsSync(join(HOME, '.windsurf'))
        ? join(HOME, '.windsurf', 'mcp.json')
        : join(HOME, '.codeium', 'windsurf', 'mcp_config.json');
    },
    configKey: 'mcpServers',
  },
  {
    id: 'antigravity',
    name: 'Antigravity (Gemini CLI)',
    detect: () => anyDirExists(join(HOME, '.gemini', 'antigravity'), join(HOME, '.gemini')),
    configType: 'json',
    configPath: join(HOME, '.gemini', 'antigravity', 'mcp_config.json'),
    configKey: 'mcpServers',
  },
  {
    id: 'cline',
    name: 'Cline (VS Code)',
    detect: () => existsSync(join(vscodeDataDir(), 'saoudrizwan.claude-dev', 'settings')),
    configType: 'json',
    configPath: join(
      vscodeDataDir(),
      'saoudrizwan.claude-dev',
      'settings',
      'cline_mcp_settings.json'
    ),
    configKey: 'mcpServers',
  },
  {
    id: 'roo-code',
    name: 'Roo Code (VS Code)',
    detect: () => existsSync(join(vscodeDataDir(), 'rooveterinaryinc.roo-cline', 'settings')),
    configType: 'json',
    configPath: join(
      vscodeDataDir(),
      'rooveterinaryinc.roo-cline',
      'settings',
      'cline_mcp_settings.json'
    ),
    configKey: 'mcpServers',
  },
];

/** Detect all tools in parallel. Returns { detected: Tool[], results: { tool, found }[] } */
async function detectAllTools() {
  const results = await Promise.all(
    TOOLS.map(async (tool) => {
      const found = await tool.detect();
      return { tool, found };
    })
  );
  const detected = results.filter((r) => r.found).map((r) => r.tool);
  return { detected, results };
}

/** Print tool detection results in deterministic TOOLS order */
function printDetectionResults(results) {
  for (const { tool, found } of results) {
    if (found) {
      console.log(`  ${green('+')} ${tool.name}`);
    } else {
      console.log(`  ${dim('-')} ${dim(tool.name)} ${dim('(not found)')}`);
    }
  }
}

function showHelp(showAll = false) {
  console.log(`
  ${bold('◇ context-vault')} ${dim(`v${VERSION}`)}
  ${dim('Persistent memory for AI agents')}

${bold('Usage:')}
  context-vault [command] [options]

  ${dim('No command → runs setup (first time) or shows status (existing vault)')}

${bold('Commands:')}
  ${cyan('setup')}                      Interactive MCP server installer
  ${cyan('connect')} --key cv_...       Connect AI tools to hosted vault
  ${cyan('switch')} local|hosted        Switch between local and hosted MCP modes
  ${cyan('serve')}                      Start the MCP server (used by AI clients)
  ${cyan('hooks')} install|uninstall    Install or remove Claude Code memory hook
  ${cyan('claude')} install|uninstall   Alias for hooks install|uninstall
  ${cyan('skills')} install             Install bundled Claude Code skills
  ${cyan('health')}                     Quick health check — vault, DB, entry count
  ${cyan('status')}                     Show vault diagnostics
  ${cyan('doctor')}                     Diagnose and repair common issues
  ${cyan('debug')}                      Generate AI-pasteable debug report
  ${cyan('restart')}                    Stop running MCP server processes (client auto-restarts)
  ${cyan('search')}                     Search vault entries from CLI
  ${cyan('save')}                       Save an entry to the vault from CLI
  ${cyan('import')} <path>              Import entries from file, directory, or .zip archive
  ${cyan('export')}                     Export vault entries (JSON, CSV, or portable ZIP)
  ${cyan('ingest')} <url>               Fetch URL and save as vault entry
  ${cyan('ingest-project')} <path>      Scan project directory and register as project entity
  ${cyan('reindex')}                    Rebuild search index from knowledge files
  ${cyan('migrate-dirs')} [--dry-run]   Rename plural vault dirs to singular (post-2.18.0)
  ${cyan('archive')}                    Archive old ephemeral/event entries (use --dry-run to preview)
  ${cyan('restore')} <id>               Restore an archived entry back into the vault
  ${cyan('prune')}                      Remove expired entries (use --dry-run to preview)
  ${cyan('update')}                     Check for and install updates
  ${cyan('uninstall')}                  Remove MCP configs and optionally data
`);

  if (showAll) {
    console.log(`${bold('Plumbing')} ${dim('(internal — hook implementations and maintenance utilities):')}
  ${cyan('recall')}                     Search vault from a Claude Code hook (reads stdin)
  ${cyan('session-capture')}            Save a session summary entry (reads JSON from stdin)
  ${cyan('session-end')}                Run session-end hook (parse transcript + capture)
  ${cyan('post-tool-call')}             Run post-tool-call hook (log tool usage)
  ${cyan('flush')}                      Check vault health and confirm DB is accessible
  ${cyan('consolidate')}                Find hot tags and cold entries for maintenance
  ${cyan('migrate')}                    Migrate vault between local and hosted
`);
  } else {
    console.log(`  ${dim('Run')} ${dim('context-vault --help --all')} ${dim('to show internal plumbing commands.')}
`);
  }

  console.log(`${bold('Options:')}
  --help                Show this help
  --help --all          Show all commands including internal plumbing
  --version             Show version
  --vault-dir <path>    Set vault directory (setup/serve)
  --yes                 Non-interactive mode (accept all defaults)
  --force               Overwrite existing config without confirmation
  --skip-embeddings     Skip embedding model download (FTS-only mode)
`);
}

async function runSetup() {
  const setupStart = Date.now();

  // Banner
  console.log();
  console.log(`  ${bold('◇ context-vault')} ${dim(`v${VERSION}`)}`);
  console.log(dim('  Persistent memory for AI agents'));
  console.log();

  // Check for existing installation
  const existingConfig = join(HOME, '.context-mcp', 'config.json');
  if (existsSync(existingConfig) && !isNonInteractive) {
    let existingVault = '(unknown)';
    try {
      const cfg = JSON.parse(readFileSync(existingConfig, 'utf-8'));
      existingVault = cfg.vaultDir || existingVault;
    } catch {}

    // Version check against npm registry (5s timeout, fail silently if offline)
    let latestVersion = null;
    try {
      latestVersion = execSync('npm view context-vault version', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim();
    } catch {}

    if (latestVersion === VERSION) {
      console.log(
        green(`  ✓ context-vault v${VERSION} is up to date`) + dim(`  (vault: ${existingVault})`)
      );

      // Check for stale tool configs using hardcoded node paths
      const staleConfigs = findStaleToolConfigs();
      if (staleConfigs.length > 0) {
        console.log();
        console.log(
          yellow(`  ! ${staleConfigs.length} tool config(s) using legacy hardcoded paths`)
        );
        for (const s of staleConfigs) {
          console.log(dim(`    ${s.name}: ${s.command}`));
        }
        console.log();
        const fix = await prompt(`  Auto-fix to use context-vault binary? (Y/n):`, 'Y');
        if (fix.toLowerCase() !== 'n') {
          let customVaultDir = null;
          try {
            const cfg = JSON.parse(readFileSync(existingConfig, 'utf-8'));
            const defaultVDir = join(HOME, 'vault');
            if (cfg.vaultDir && resolve(cfg.vaultDir) !== resolve(defaultVDir)) {
              customVaultDir = cfg.vaultDir;
            }
          } catch {}
          for (const s of staleConfigs) {
            try {
              repairToolConfig(s, customVaultDir);
              console.log(`  ${green('+')} ${s.name} — fixed`);
            } catch (e) {
              console.log(`  ${red('x')} ${s.name} — ${e.message}`);
            }
          }
          console.log();
          console.log(green('  ✓ Tool configs updated.'));
          console.log(dim('  Restart your AI tools to apply the changes.'));
        }
      }

      console.log();
      return;
    }

    console.log(yellow(`  Existing installation detected`));
    console.log(dim(`  Vault: ${existingVault}`));
    if (latestVersion) {
      console.log();
      console.log(`  Current: ${dim(VERSION)}`);
      console.log(`  Latest:  ${green(latestVersion)}`);
      const upgradeCmd = isNpx()
        ? 'npx context-vault@latest setup'
        : 'npm install -g context-vault';
      console.log();
      console.log(dim(`  To upgrade: ${upgradeCmd}`));
    } else {
      console.log(dim(`  Config: ${existingConfig}`));
    }
    console.log();
    console.log(`    1) Full reconfigure`);
    console.log(`    2) Update tool configs only ${dim('(skip vault setup)')}`);
    console.log(`    3) Cancel`);
    console.log();
    const choice = await prompt('  Select:', '1');

    if (choice === '3') {
      console.log(dim('  Cancelled.'));
      return;
    }

    if (choice === '2') {
      // Skip vault setup, just reconfigure tools
      console.log();
      console.log(dim(`  [1/2]`) + bold(' Detecting tools...\n'));
      const { detected, results: detectionResults } = await detectAllTools();
      printDetectionResults(detectionResults);
      console.log();

      if (detected.length === 0) {
        console.log(yellow('  No supported tools detected.'));
        return;
      }

      let selected;
      if (detected.length === 1) {
        selected = detected;
        console.log(`  ${dim('→')} Auto-selected ${detected[0].name}\n`);
      } else {
        console.log(bold('  Which tools should context-vault connect to?\n'));
        for (let i = 0; i < detected.length; i++) {
          console.log(`    ${i + 1}) ${detected[i].name}`);
        }
        console.log();
        const answer = await prompt(`  Select (${dim('1,2,3')} or ${dim('"all"')}):`, 'all');
        if (answer === 'all' || answer === '') {
          selected = detected;
        } else {
          const nums = answer
            .split(/[,\s]+/)
            .map((n) => parseInt(n, 10) - 1)
            .filter((n) => n >= 0 && n < detected.length);
          selected = nums.map((n) => detected[n]);
          if (selected.length === 0) selected = detected;
        }
      }

      // Read vault dir from existing config
      let customVaultDir = null;
      try {
        const cfg = JSON.parse(readFileSync(existingConfig, 'utf-8'));
        const defaultVDir = join(HOME, 'vault');
        if (cfg.vaultDir && resolve(cfg.vaultDir) !== resolve(defaultVDir)) {
          customVaultDir = cfg.vaultDir;
        }
      } catch {}

      console.log(`\n  ${dim('[2/2]')}${bold(' Configuring tools...\n')}`);
      for (const tool of selected) {
        try {
          if (tool.configType === 'cli' && tool.id === 'codex') {
            await configureCodex(tool, customVaultDir);
          } else if (tool.configType === 'cli') {
            await configureClaude(tool, customVaultDir);
          } else {
            configureJsonTool(tool, customVaultDir);
          }
          console.log(`  ${green('+')} ${tool.name} — configured`);
        } catch (e) {
          console.log(`  ${red('x')} ${tool.name} — ${e.message}`);
        }
      }

      console.log();
      console.log(green('  ✓ Tool configs updated.'));
      console.log(dim('  Restart your AI tools to apply the changes.'));
      console.log();
      return;
    }
    // choice === "1" falls through to full setup below
    console.log();
  }

  // Detect tools
  console.log(dim(`  [1/6]`) + bold(' Detecting tools...\n'));
  const { detected, results: detectionResults } = await detectAllTools();
  printDetectionResults(detectionResults);
  console.log();

  if (detected.length === 0) {
    console.log(yellow('  No supported tools detected.\n'));
    console.log("  To manually configure, add to your tool's MCP config:\n");
    if (isInstalledPackage() || isNpx()) {
      console.log(`  ${dim('{')}
    ${dim('"mcpServers": {')}
      ${dim('"context-vault": {')}
        ${dim('"command": "context-vault",')}
        ${dim(`"args": ["serve", "--vault-dir", "/path/to/vault"]`)}
      ${dim('}')}
    ${dim('}')}
  ${dim('}')}\n`);
    } else {
      console.log(`  ${dim('{')}
    ${dim('"mcpServers": {')}
      ${dim('"context-vault": {')}
        ${dim('"command": "node",')}
        ${dim(`"args": ["${SERVER_PATH}", "--vault-dir", "/path/to/vault"]`)}
      ${dim('}')}
    ${dim('}')}
  ${dim('}')}\n`);
    }

    // In non-interactive mode, continue setup without tools (vault, config, etc.)
    if (isNonInteractive) {
      console.log(dim('  Continuing setup without tool configuration (--yes mode).\n'));
    } else {
      return;
    }
  }

  // Select tools
  let selected;
  if (isNonInteractive || detected.length === 1) {
    selected = detected;
    if (detected.length === 1) {
      console.log(`  ${dim('→')} Auto-selected ${detected[0].name}\n`);
    }
  } else {
    console.log(bold('  Which tools should context-vault connect to?\n'));
    for (let i = 0; i < detected.length; i++) {
      console.log(`    ${i + 1}) ${detected[i].name}`);
    }
    console.log();
    const answer = await prompt(`  Select (${dim('1,2,3')} or ${dim('"all"')}):`, 'all');
    if (answer === 'all' || answer === '') {
      selected = detected;
    } else {
      const nums = answer
        .split(/[,\s]+/)
        .map((n) => parseInt(n, 10) - 1)
        .filter((n) => n >= 0 && n < detected.length);
      selected = nums.map((n) => detected[n]);
      if (selected.length === 0) selected = detected;
    }
  }

  // Vault directory (content files)
  console.log(dim(`  [2/6]`) + bold(' Configuring vault...\n'));

  // Scan for existing vaults via marker file
  let defaultVaultDir = getFlag('--vault-dir') || join(HOME, '.vault');

  // Prefer existing config vaultDir over default (prevents accidental overwrite)
  if (!getFlag('--vault-dir')) {
    const existingCfgPath = join(HOME, '.context-mcp', 'config.json');
    if (existsSync(existingCfgPath)) {
      try {
        const cfg = JSON.parse(readFileSync(existingCfgPath, 'utf-8'));
        if (cfg.vaultDir && existsSync(resolve(cfg.vaultDir))) {
          defaultVaultDir = cfg.vaultDir;
        }
      } catch {}
    }
  }

  if (!getFlag('--vault-dir') && !isNonInteractive) {
    const existingVaults = scanForVaults();
    if (existingVaults.length === 1) {
      console.log(
        `  ${green('+')} Found existing vault at ${existingVaults[0].path}` +
          dim(` (${existingVaults[0].entryCount} entries)`)
      );
      const useExisting = await prompt(`  Use this vault? (Y/n):`, 'Y');
      if (useExisting.toLowerCase() !== 'n') {
        defaultVaultDir = existingVaults[0].path;
      }
      console.log();
    } else if (existingVaults.length > 1) {
      console.log(`  Found ${existingVaults.length} existing vaults:\n`);
      for (let i = 0; i < existingVaults.length; i++) {
        console.log(
          `    ${i + 1}) ${existingVaults[i].path} ${dim(`(${existingVaults[i].entryCount} entries)`)}`
        );
      }
      console.log();
      const choice = await prompt(
        `  Which vault to use? (1-${existingVaults.length}, or "new"):`,
        '1'
      );
      if (choice !== 'new') {
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < existingVaults.length) {
          defaultVaultDir = existingVaults[idx].path;
        }
      }
      console.log();
    }
  }

  const vaultDir = isNonInteractive
    ? defaultVaultDir
    : await prompt(`  Vault directory:`, defaultVaultDir);
  let resolvedVaultDir = resolve(vaultDir);

  // Guard: vault dir path must not be an existing file
  if (existsSync(resolvedVaultDir)) {
    if (!statSync(resolvedVaultDir).isDirectory()) {
      console.error(`\n  ${red('Error:')} ${resolvedVaultDir} exists but is not a directory.`);
      console.error(dim(`  Remove or rename the file, then run setup again.\n`));
      process.exit(1);
    }
  } else if (isNonInteractive) {
    mkdirSync(resolvedVaultDir, { recursive: true });
    console.log(`\n  ${green('+')} Created ${resolvedVaultDir}`);
  } else {
    const create = await prompt(`\n  ${resolvedVaultDir} doesn't exist. Create it? (Y/n):`, 'Y');
    if (create.toLowerCase() !== 'n') {
      mkdirSync(resolvedVaultDir, { recursive: true });
      console.log(`  ${green('+')} Created ${resolvedVaultDir}`);
    } else {
      console.log(red('\n  Setup cancelled — vault directory is required.'));
      process.exit(1);
    }
  }

  // Write marker file for vault auto-detection
  writeMarkerFile(resolvedVaultDir);

  // Ensure data dir exists for DB storage
  const dataDir = join(HOME, '.context-mcp');
  mkdirSync(dataDir, { recursive: true });

  // Write config.json to data dir (persistent, survives reinstalls)
  const configPath = join(dataDir, 'config.json');
  const vaultConfig = {};
  if (existsSync(configPath)) {
    try {
      Object.assign(vaultConfig, JSON.parse(readFileSync(configPath, 'utf-8')));
    } catch {}
  }

  const existingVaultDir = vaultConfig.vaultDir;
  if (existingVaultDir && resolve(existingVaultDir) !== resolvedVaultDir && !flags.has('--force')) {
    let entryCount = 0;
    try {
      const knowledgeDir = join(resolve(existingVaultDir), 'knowledge');
      if (existsSync(knowledgeDir)) {
        const countMd = (d) => {
          let n = 0;
          for (const e of readdirSync(d, { withFileTypes: true })) {
            if (e.isDirectory()) n += countMd(join(d, e.name));
            else if (e.name.endsWith('.md')) n++;
          }
          return n;
        };
        entryCount = countMd(knowledgeDir);
      }
    } catch {}

    console.log();
    console.log(
      yellow(`  ⚠ Existing config points to: ${resolve(existingVaultDir)}`) +
        (entryCount > 0 ? dim(` (${entryCount} entries)`) : '')
    );
    console.log(`  Setup would change vaultDir to: ${resolvedVaultDir}`);

    if (isNonInteractive) {
      console.log();
      console.log(red('  Refusing to overwrite vaultDir in non-interactive mode.'));
      console.log(dim('  Use --force to override, or --vault-dir to set explicitly.'));
      process.exit(1);
    }

    console.log();
    const overwrite = await prompt('  Overwrite? (y/N):', 'N');
    if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
      console.log(dim(`  Keeping existing vaultDir: ${resolve(existingVaultDir)}`));
      resolvedVaultDir = resolve(existingVaultDir);
    }
  }

  vaultConfig.vaultDir = resolvedVaultDir;
  vaultConfig.dataDir = dataDir;
  vaultConfig.dbPath = join(dataDir, 'vault.db');
  vaultConfig.devDir = join(HOME, 'dev');
  vaultConfig.mode = 'local';

  // Telemetry opt-in
  console.log(`\n  ${dim('[3/6]')}${bold(' Anonymous error reporting\n')}`);
  console.log(dim('  When enabled, unhandled errors send a minimal event (type, tool name,'));
  console.log(dim('  version, platform) to help diagnose issues. No vault content,'));
  console.log(dim('  file paths, or personal data is ever sent. Off by default.'));
  console.log(dim(`  Full schema: ${MARKETING_URL}/telemetry`));
  console.log();

  let telemetryEnabled = vaultConfig.telemetry === true;
  if (!isNonInteractive) {
    const defaultChoice = telemetryEnabled ? 'Y' : 'n';
    const telemetryAnswer = await prompt(
      `  Enable anonymous error reporting? (y/N):`,
      defaultChoice
    );
    telemetryEnabled =
      telemetryAnswer.toLowerCase() === 'y' || telemetryAnswer.toLowerCase() === 'yes';
  }
  vaultConfig.telemetry = telemetryEnabled;
  console.log(
    `  ${telemetryEnabled ? green('+') : dim('-')} Telemetry: ${telemetryEnabled ? 'enabled' : 'disabled'}`
  );

  writeFileSync(configPath, JSON.stringify(vaultConfig, null, 2) + '\n');
  console.log(`\n  ${green('+')} Wrote ${configPath}`);

  // Pre-download embedding model with spinner (skip with --skip-embeddings)
  const skipEmbeddings = flags.has('--skip-embeddings');
  if (skipEmbeddings) {
    console.log(`\n  ${dim('[4/6]')}${bold(' Embedding model')} ${dim('(skipped)')}`);
    console.log(dim('  FTS-only mode — full-text search works, semantic search disabled.'));
    console.log(dim('  To enable later: context-vault setup (without --skip-embeddings)'));
  } else {
    console.log(`\n  ${dim('[4/6]')}${bold(' Downloading embedding model...')}`);
    console.log(dim('  all-MiniLM-L6-v2 (~22MB, one-time download)'));
    console.log(dim(`  Slow connection? Re-run with --skip-embeddings (enables FTS-only mode)\n`));
    {
      const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let frame = 0;
      const start = Date.now();
      const modelDir = join(homedir(), '.context-mcp', 'models');
      const spinner = setInterval(() => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        let downloadedMB = '?';
        try {
          const files = readdirSync(modelDir, {
            recursive: true,
            withFileTypes: true,
          });
          const totalBytes = files
            .filter((f) => f.isFile())
            .reduce((sum, f) => sum + statSync(join(f.parentPath ?? f.path, f.name)).size, 0);
          downloadedMB = (totalBytes / 1024 / 1024).toFixed(1);
        } catch {}
        process.stdout.write(
          `\r  ${spinnerFrames[frame++ % spinnerFrames.length]} Downloading... ${downloadedMB} MB / ~22 MB  ${dim(`${elapsed}s`)}`
        );
      }, 100);

      try {
        const { embed } = await import('@context-vault/core/embed');
        let timeoutHandle;
        const timeout = new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () =>
              reject(
                Object.assign(new Error('Download timed out after 90s'), {
                  code: 'ETIMEDOUT',
                })
              ),
            90_000
          );
        });
        await Promise.race([embed('warmup'), timeout]);
        clearTimeout(timeoutHandle);

        clearInterval(spinner);
        process.stdout.write(`\r  ${green('+')} Embedding model ready              \n`);
      } catch (e) {
        clearInterval(spinner);
        const code = e.code || e.cause?.code || '';
        const isNetwork = [
          'ENOTFOUND',
          'ETIMEDOUT',
          'ECONNREFUSED',
          'ECONNRESET',
          'ERR_SOCKET_TIMEOUT',
        ].includes(code);
        process.stdout.write(
          `\r  ${yellow('!')} Model download failed: ${e.message}              \n`
        );
        if (isNetwork) {
          console.log(dim(`    Check your internet connection and try again.`));
        }
        console.log(dim(`    Retry: ${isNpx() ? 'npx context-vault' : 'context-vault'} setup`));
        console.log(dim(`    Semantic search disabled — full-text search still works.`));
      }
    }
  }

  // Clean up legacy project-root config.json if it exists
  const legacyConfigPath = join(ROOT, 'config.json');
  if (existsSync(legacyConfigPath)) {
    try {
      unlinkSync(legacyConfigPath);
      console.log(`  ${dim('Removed legacy config at ' + legacyConfigPath)}`);
    } catch {}
  }

  // Configure each tool — pass vault dir as arg if non-default
  console.log(`\n  ${dim('[5/6]')}${bold(' Configuring tools...\n')}`);
  const results = [];
  const defaultVDir = join(HOME, 'vault');
  const customVaultDir = resolvedVaultDir !== resolve(defaultVDir) ? resolvedVaultDir : null;

  for (const tool of selected) {
    try {
      if (tool.configType === 'cli' && tool.id === 'codex') {
        await configureCodex(tool, customVaultDir);
      } else if (tool.configType === 'cli') {
        await configureClaude(tool, customVaultDir);
      } else {
        configureJsonTool(tool, customVaultDir);
      }
      results.push({ tool, ok: true });
      console.log(`  ${green('+')} ${tool.name} — configured`);
    } catch (e) {
      results.push({ tool, ok: false, error: e.message });
      console.log(`  ${red('x')} ${tool.name} — ${e.message}`);
    }
  }

  // Claude Code hooks (opt-in)
  const claudeConfigured = results.some((r) => r.ok && r.tool.id === 'claude-code');
  const hookFlag = flags.has('--hooks');
  if (claudeConfigured) {
    // 1. Recall hook (UserPromptSubmit)
    let installHook = hookFlag;
    if (!hookFlag && !isNonInteractive) {
      console.log();
      console.log(dim('  Claude Code detected — install memory hook?'));
      console.log(dim('  Searches your vault on every prompt and injects relevant entries'));
      console.log(dim("  as additional context alongside Claude's native memory."));
      console.log();
      const answer = await prompt('  Install Claude Code memory hook? (y/N):', 'N');
      installHook = answer.toLowerCase() === 'y';
    }
    if (installHook) {
      try {
        const installed = installClaudeHook();
        if (installed) {
          console.log(`\n  ${green('+')} Memory hook installed`);
        }
      } catch (e) {
        console.log(`\n  ${red('x')} Hook install failed: ${e.message}`);
      }

      // 2. Session capture hook (SessionEnd) — only offer if recall hook was installed
      if (!isNonInteractive) {
        console.log();
        console.log(dim('  Auto-save session summaries when Claude Code exits?'));
        console.log(dim('  Captures files touched, tools used, and decisions made per session.'));
        console.log();
        const captureAnswer = await prompt('  Install session capture hook? (Y/n):', 'Y');
        if (captureAnswer.toLowerCase() !== 'n') {
          try {
            const captureInstalled = installSessionCaptureHook();
            if (captureInstalled) {
              console.log(`  ${green('+')} Session capture hook installed`);
            }
          } catch (e) {
            console.log(`  ${red('x')} Session capture hook failed: ${e.message}`);
          }
        }
      } else if (hookFlag) {
        try {
          installSessionCaptureHook();
        } catch {}
      }

      // 3. Auto-capture hook (PostToolCall) — only offer if recall hook was installed
      if (!isNonInteractive) {
        console.log();
        console.log(dim('  Passively log tool calls for richer session summaries?'));
        console.log(dim('  Records tool names and file paths after each tool call (lightweight).'));
        console.log();
        const autoCaptureAnswer = await prompt('  Install auto-capture hook? (Y/n):', 'Y');
        if (autoCaptureAnswer.toLowerCase() !== 'n') {
          try {
            const acInstalled = installPostToolCallHook();
            if (acInstalled) {
              console.log(`  ${green('+')} Auto-capture hook installed`);
            }
          } catch (e) {
            console.log(`  ${red('x')} Auto-capture hook failed: ${e.message}`);
          }
        }
      } else if (hookFlag) {
        try {
          installPostToolCallHook();
        } catch {}
      }
    } else if (!isNonInteractive && !hookFlag) {
      console.log(dim(`  Skipped — install later: context-vault hooks install`));
    }
  }

  // Claude Code skills (opt-in)
  if (claudeConfigured && !isNonInteractive) {
    console.log();
    console.log(dim('  Install Claude Code skills? (recommended)'));
    console.log(dim('  compile-context — compile vault entries into a project brief'));
    console.log();
    const skillAnswer = await prompt('  Install Claude Code skills? (Y/n):', 'Y');
    const installSkillsFlag = skillAnswer.toLowerCase() !== 'n';
    if (installSkillsFlag) {
      try {
        const names = installSkills();
        if (names.length > 0) {
          for (const name of names) {
            console.log(`\n  ${green('+')} ${name} skill installed`);
          }
        }
      } catch (e) {
        console.log(`\n  ${red('x')} Skills install failed: ${e.message}`);
      }
    } else {
      console.log(dim(`  Skipped — install later: context-vault skills install`));
    }
  }

  // Seed entry
  const seeded = createSeedEntries(resolvedVaultDir);
  if (seeded > 0) {
    console.log(
      `\n  ${green('+')} Created ${seeded} starter ${seeded === 1 ? 'entry' : 'entries'} in vault`
    );
  }

  // Health check
  console.log(`\n  ${dim('[6/6]')}${bold(' Health check...')}\n`);
  const okResults = results.filter((r) => r.ok);

  // Verify DB is accessible
  let dbAccessible = false;
  try {
    const { initDatabase } = await import('@context-vault/core/db');
    const db = await initDatabase(vaultConfig.dbPath);
    db.prepare('SELECT 1').get();
    db.close();
    dbAccessible = true;
  } catch {}

  const checks = [
    { label: 'Vault directory exists', pass: existsSync(resolvedVaultDir) },
    { label: 'Config file written', pass: existsSync(configPath) },
    { label: 'Database accessible', pass: dbAccessible },
    { label: 'At least one tool configured', pass: okResults.length > 0 },
  ];
  const passed = checks.filter((c) => c.pass).length;
  for (const c of checks) {
    console.log(`  ${c.pass ? green('✓') : red('✗')} ${c.label}`);
  }

  // Completion box
  const elapsed = ((Date.now() - setupStart) / 1000).toFixed(1);
  const toolName = okResults.length ? okResults[0].tool.name : 'your AI tool';
  const boxLines = [
    `  ✓ Setup complete — ${passed}/${checks.length} checks passed (${elapsed}s)`,
    ``,
    `  ${bold('Next:')} restart ${toolName} to activate the vault`,
    ``,
    `  ${bold('AI Tools')} — once active, try:`,
    `  "Search my vault for getting started"`,
    `  "Save an insight about [topic]"`,
    `  "Show my vault status"`,
    ``,
    `  ${bold('CLI Commands:')}`,
    `  ${isNpx() ? 'npx context-vault' : 'context-vault'} status    Show vault health`,
    `  ${isNpx() ? 'npx context-vault' : 'context-vault'} update    Check for updates`,
  ];
  const innerWidth = Math.max(...boxLines.map((l) => l.length)) + 2;
  const pad = (s) => s + ' '.repeat(Math.max(0, innerWidth - s.length));
  console.log();
  console.log(`  ${dim('┌' + '─'.repeat(innerWidth) + '┐')}`);
  for (const line of boxLines) {
    console.log(`  ${dim('│')}${pad(line)}${dim('│')}`);
  }
  console.log(`  ${dim('└' + '─'.repeat(innerWidth) + '┘')}`);
  console.log();
}

async function configureClaude(tool, vaultDir) {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  // Clean up old names
  for (const oldName of ['context-mcp', 'context-vault']) {
    try {
      execFileSync('claude', ['mcp', 'remove', oldName, '-s', 'user'], {
        stdio: 'pipe',
        env,
      });
    } catch {}
  }

  try {
    if (isNpx()) {
      const serverArgs = ['-y', 'context-vault', 'serve'];
      if (vaultDir) serverArgs.push('--vault-dir', vaultDir);
      execFileSync(
        'claude',
        [
          'mcp',
          'add',
          '-s',
          'user',
          'context-vault',
          '-e',
          'NODE_OPTIONS=--no-warnings=ExperimentalWarning',
          '--',
          'npx',
          ...serverArgs,
        ],
        { stdio: 'pipe', env }
      );
    } else if (isInstalledPackage()) {
      const serverArgs = ['serve'];
      if (vaultDir) serverArgs.push('--vault-dir', vaultDir);
      execFileSync(
        'claude',
        ['mcp', 'add', '-s', 'user', 'context-vault', '--', 'context-vault', ...serverArgs],
        { stdio: 'pipe', env }
      );
    } else {
      const nodeArgs = [SERVER_PATH];
      if (vaultDir) nodeArgs.push('--vault-dir', vaultDir);
      execFileSync(
        'claude',
        [
          'mcp',
          'add',
          '-s',
          'user',
          'context-vault',
          '-e',
          'NODE_OPTIONS=--no-warnings=ExperimentalWarning',
          '--',
          process.execPath,
          ...nodeArgs,
        ],
        { stdio: 'pipe', env }
      );
    }
  } catch (e) {
    const stderr = e.stderr?.toString().trim();
    throw new Error(stderr || e.message);
  }
}

async function configureCodex(tool, vaultDir) {
  // Clean up old names
  for (const oldName of ['context-mcp', 'context-vault']) {
    try {
      execFileSync('codex', ['mcp', 'remove', oldName], { stdio: 'pipe' });
    } catch {}
  }

  try {
    if (isNpx()) {
      const serverArgs = ['-y', 'context-vault', 'serve'];
      if (vaultDir) serverArgs.push('--vault-dir', vaultDir);
      execFileSync('codex', ['mcp', 'add', 'context-vault', '--', 'npx', ...serverArgs], {
        stdio: 'pipe',
      });
    } else if (isInstalledPackage()) {
      const serverArgs = ['serve'];
      if (vaultDir) serverArgs.push('--vault-dir', vaultDir);
      execFileSync('codex', ['mcp', 'add', 'context-vault', '--', 'context-vault', ...serverArgs], {
        stdio: 'pipe',
      });
    } else {
      const nodeArgs = [SERVER_PATH];
      if (vaultDir) nodeArgs.push('--vault-dir', vaultDir);
      execFileSync('codex', ['mcp', 'add', 'context-vault', '--', process.execPath, ...nodeArgs], {
        stdio: 'pipe',
      });
    }
  } catch (e) {
    const stderr = e.stderr?.toString().trim();
    throw new Error(stderr || e.message);
  }
}

function findStaleToolConfigs() {
  const stale = [];

  // Check Claude Code (~/.claude.json)
  const claudePath = join(HOME, '.claude.json');
  if (existsSync(claudePath)) {
    try {
      const cfg = JSON.parse(readFileSync(claudePath, 'utf-8'));
      const srv = cfg?.mcpServers?.['context-vault'];
      if (srv && srv.command !== 'context-vault' && srv.command !== 'npx') {
        stale.push({
          name: 'Claude Code',
          id: 'claude-code',
          configType: 'cli',
          configPath: claudePath,
          command: [srv.command, ...(srv.args || [])].join(' '),
        });
      }
    } catch {}
  }

  // Check JSON-configured tools
  for (const tool of TOOLS.filter((t) => t.configType === 'json')) {
    const cfgPath = tool.configPath;
    if (!cfgPath || !existsSync(cfgPath)) continue;
    try {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      const srv = cfg?.[tool.configKey]?.['context-vault'];
      if (srv && srv.command !== 'context-vault' && srv.command !== 'npx') {
        stale.push({
          name: tool.name,
          id: tool.id,
          configType: 'json',
          configPath: cfgPath,
          configKey: tool.configKey,
          command: [srv.command, ...(srv.args || [])].join(' '),
        });
      }
    } catch {}
  }

  return stale;
}

function repairToolConfig(staleEntry, vaultDir) {
  const serverArgs = ['serve'];
  if (vaultDir) serverArgs.push('--vault-dir', vaultDir);
  const newConfig = { command: 'context-vault', args: serverArgs };

  if (staleEntry.id === 'claude-code') {
    // Use `claude mcp remove` + `claude mcp add`
    try {
      execFileSync('claude', ['mcp', 'remove', 'context-vault'], {
        stdio: 'pipe',
      });
    } catch {}
    execFileSync('claude', ['mcp', 'add', 'context-vault', '--', 'context-vault', ...serverArgs], {
      stdio: 'pipe',
    });
    return;
  }

  // JSON config tools
  const cfgPath = staleEntry.configPath;
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
  cfg[staleEntry.configKey]['context-vault'] = newConfig;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
}

function configureJsonTool(tool, vaultDir) {
  const configPath = tool.configPath;
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let config = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    try {
      config = JSON.parse(raw);
    } catch {
      const bakPath = configPath + '.bak';
      copyFileSync(configPath, bakPath);
      console.log(`  ${yellow('!')} Backed up corrupted config to ${bakPath}`);
      config = {};
    }
  }

  if (!config[tool.configKey]) {
    config[tool.configKey] = {};
  }

  // Clean up old "context-mcp" key
  delete config[tool.configKey]['context-mcp'];

  if (isNpx()) {
    const serverArgs = vaultDir ? ['--vault-dir', vaultDir] : [];
    config[tool.configKey]['context-vault'] = {
      command: 'npx',
      args: ['-y', 'context-vault', 'serve', ...serverArgs],
      env: { NODE_OPTIONS: '--no-warnings=ExperimentalWarning' },
    };
  } else if (isInstalledPackage()) {
    const serverArgs = ['serve'];
    if (vaultDir) serverArgs.push('--vault-dir', vaultDir);
    config[tool.configKey]['context-vault'] = {
      command: 'context-vault',
      args: serverArgs,
    };
  } else {
    const serverArgs = [SERVER_PATH];
    if (vaultDir) serverArgs.push('--vault-dir', vaultDir);
    config[tool.configKey]['context-vault'] = {
      command: process.execPath,
      args: serverArgs,
      env: { NODE_OPTIONS: '--no-warnings=ExperimentalWarning' },
    };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

function createSeedEntries(vaultDir) {
  let created = 0;

  // Entry 1: Getting started (improved)
  const insightDir = join(vaultDir, 'knowledge', 'insights');
  const insightPath = join(insightDir, 'getting-started.md');
  if (!existsSync(insightPath)) {
    mkdirSync(insightDir, { recursive: true });
    const id1 = Date.now().toString(36).toUpperCase().padStart(10, '0');
    const now = new Date().toISOString();
    writeFileSync(
      insightPath,
      `---
id: ${id1}
tags: ["getting-started", "vault"]
source: context-vault-setup
created: ${now}
---
Welcome to your context vault! This is a seed entry created during setup.

Your vault stores knowledge as plain markdown files with YAML frontmatter.
AI agents search it using hybrid full-text + semantic search.

**Quick start:**
- "Search my vault for getting started" — find this entry
- "Save an insight about [topic]" — add knowledge
- "Show my vault status" — check health
- "List my recent entries" — browse your vault

You can edit or delete this file anytime — it lives at:
${insightPath}
`
    );
    created++;
  }

  // Entry 2: Example decision
  const decisionDir = join(vaultDir, 'knowledge', 'decisions');
  const decisionPath = join(decisionDir, 'example-local-first-data.md');
  if (!existsSync(decisionPath)) {
    mkdirSync(decisionDir, { recursive: true });
    const id2 = (Date.now() + 1).toString(36).toUpperCase().padStart(10, '0');
    const now = new Date().toISOString();
    writeFileSync(
      decisionPath,
      `---
id: ${id2}
tags: ["example", "architecture"]
source: context-vault-setup
created: ${now}
---
Example decision: Use local-first data storage (SQLite + files) over cloud databases.

**Context:** For personal knowledge management, local storage provides better privacy,
offline access, and zero ongoing cost. The vault uses plain markdown files as the
source of truth with a SQLite index for fast search.

**Trade-offs:**
- Pro: Full data ownership, git-versioned, human-editable
- Pro: No cloud dependency, works offline
- Con: No built-in sync across devices (use git or Syncthing)

This is an example entry showing the decision format. Feel free to delete it.
`
    );
    created++;
  }

  return created;
}

async function runConnect() {
  const apiKey = getFlag('--key');
  const hostedUrl = getFlag('--url') || API_URL;

  if (!apiKey) {
    console.log(`\n  ${bold('context-vault connect')}\n`);
    console.log(`  Connect your AI tools to a hosted Context Vault.\n`);
    console.log(`  Usage:`);
    console.log(`    context-vault connect --key cv_...\n`);
    console.log(`  Options:`);
    console.log(`    --key <key>   API key (required)`);
    console.log(`    --url <url>   Hosted server URL (default: ${API_URL})`);
    console.log();
    return;
  }

  // Validate key format
  if (!apiKey.startsWith('cv_') || apiKey.length < 10) {
    console.error(`\n  ${red('Invalid API key format.')}`);
    console.error(dim(`  Keys start with "cv_" and are 43 characters long.`));
    console.error(dim(`  Get yours at ${hostedUrl}/register\n`));
    process.exit(1);
  }

  console.log();
  console.log(`  ${bold('◇ context-vault')} ${dim('connect')}`);
  console.log();

  // Validate key against server before configuring tools
  console.log(dim('  Verifying API key...'));
  let user;
  try {
    const response = await fetch(`${hostedUrl}/api/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.status === 401) {
      console.error(`\n  ${red('Invalid or expired API key.')}`);
      console.error(dim(`  Check your key and try again.`));
      console.error(dim(`  Get a new key at ${hostedUrl}/register\n`));
      process.exit(1);
    }
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }
    user = await response.json();
    console.log(`  ${green('+')} Verified — ${user.email} (${user.tier})\n`);
  } catch (e) {
    if (
      e.code === 'ECONNREFUSED' ||
      e.code === 'ENOTFOUND' ||
      e.cause?.code === 'ECONNREFUSED' ||
      e.cause?.code === 'ENOTFOUND'
    ) {
      console.error(`\n  ${red('Cannot reach server.')}`);
      console.error(dim(`  URL: ${hostedUrl}`));
      console.error(dim(`  Check your internet connection or try --url <url>\n`));
    } else if (e.message?.includes('Invalid or expired')) {
      // Already handled above
    } else {
      console.error(`\n  ${red(`Verification failed: ${e.message}`)}`);
      console.error(dim(`  Server: ${hostedUrl}`));
      console.error(dim(`  Check your API key and internet connection.\n`));
    }
    process.exit(1);
  }

  // Detect tools
  console.log(dim(`  [1/2]`) + bold(' Detecting tools...\n'));
  const { detected, results: connectDetectionResults } = await detectAllTools();
  printDetectionResults(connectDetectionResults);
  console.log();

  if (detected.length === 0) {
    console.log(yellow('  No supported tools detected.'));
    console.log(`\n  Add this to your tool's MCP config manually:\n`);
    console.log(
      dim(
        `  ${JSON.stringify(
          {
            mcpServers: {
              'context-vault': {
                url: `${hostedUrl}/mcp`,
                headers: { Authorization: `Bearer ${apiKey}` },
              },
            },
          },
          null,
          2
        )
          .split('\n')
          .join('\n  ')}`
      )
    );
    console.log();
    return;
  }

  // Select tools
  let selected;
  if (isNonInteractive) {
    selected = detected;
  } else {
    console.log(bold('  Which tools should connect to your hosted vault?\n'));
    for (let i = 0; i < detected.length; i++) {
      console.log(`    ${i + 1}) ${detected[i].name}`);
    }
    console.log();
    const answer = await prompt(`  Select (${dim('1,2,3')} or ${dim('"all"')}):`, 'all');
    if (answer === 'all' || answer === '') {
      selected = detected;
    } else {
      const nums = answer
        .split(/[,\s]+/)
        .map((n) => parseInt(n, 10) - 1)
        .filter((n) => n >= 0 && n < detected.length);
      selected = nums.map((n) => detected[n]);
      if (selected.length === 0) selected = detected;
    }
  }

  // Configure each tool with hosted MCP endpoint
  console.log(`\n  ${dim('[2/2]')}${bold(' Configuring tools...\n')}`);
  for (const tool of selected) {
    try {
      if (tool.configType === 'cli' && tool.id === 'codex') {
        configureCodexHosted(apiKey, hostedUrl);
      } else if (tool.configType === 'cli') {
        configureClaudeHosted(apiKey, hostedUrl);
      } else {
        configureJsonToolHosted(tool, apiKey, hostedUrl);
      }
      console.log(`  ${green('+')} ${tool.name} — configured`);
    } catch (e) {
      console.log(`  ${red('x')} ${tool.name} — ${e.message}`);
    }
  }

  // Persist mode in config
  const modeConfigPath = join(HOME, '.context-mcp', 'config.json');
  let modeConfig = {};
  if (existsSync(modeConfigPath)) {
    try {
      modeConfig = JSON.parse(readFileSync(modeConfigPath, 'utf-8'));
    } catch {}
  }
  modeConfig.mode = 'hosted';
  modeConfig.hostedUrl = hostedUrl;
  mkdirSync(join(HOME, '.context-mcp'), { recursive: true });
  writeFileSync(modeConfigPath, JSON.stringify(modeConfig, null, 2) + '\n');

  console.log();
  console.log(green('  ✓ Connected! Your AI tools can now access your hosted vault.'));
  console.log(dim(`  Endpoint: ${hostedUrl}/mcp`));
  console.log();
}

function configureClaudeHosted(apiKey, hostedUrl) {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  try {
    execSync('claude mcp remove context-mcp -s user', { stdio: 'pipe', env });
  } catch {}
  try {
    execSync('claude mcp remove context-vault -s user', { stdio: 'pipe', env });
  } catch {}

  try {
    execSync(`claude mcp add -s user --transport http context-vault ${hostedUrl}/mcp`, {
      stdio: 'pipe',
      env,
    });
  } catch (e) {
    const stderr = e.stderr?.toString().trim();
    throw new Error(stderr || e.message);
  }
}

function configureCodexHosted(apiKey, hostedUrl) {
  try {
    execSync('codex mcp remove context-mcp', { stdio: 'pipe' });
  } catch {}
  try {
    execSync('codex mcp remove context-vault', { stdio: 'pipe' });
  } catch {}

  try {
    execSync(`codex mcp add --transport http context-vault ${hostedUrl}/mcp`, {
      stdio: 'pipe',
    });
  } catch (e) {
    const stderr = e.stderr?.toString().trim();
    throw new Error(stderr || e.message);
  }
}

function configureJsonToolHosted(tool, apiKey, hostedUrl) {
  const configPath = tool.configPath;
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let config = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf-8');
    try {
      config = JSON.parse(raw);
    } catch {
      const bakPath = configPath + '.bak';
      copyFileSync(configPath, bakPath);
      config = {};
    }
  }

  if (!config[tool.configKey]) {
    config[tool.configKey] = {};
  }

  // Clean up old "context-mcp" key
  delete config[tool.configKey]['context-mcp'];

  config[tool.configKey]['context-vault'] = {
    url: `${hostedUrl}/mcp`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}

async function runSwitch() {
  const target = args[1];
  if (target !== 'local' && target !== 'hosted') {
    console.log(`\n  ${bold('context-vault switch')} <local|hosted>\n`);
    console.log(`  Switch between local and hosted MCP modes.\n`);
    console.log(`  ${cyan('switch local')}    Use local vault (SQLite + files on this device)`);
    console.log(`  ${cyan('switch hosted')}   Use hosted vault (requires API key)\n`);
    console.log(`  Options:`);
    console.log(`    --key <key>   API key for hosted mode (cv_...)`);
    console.log(`    --url <url>   Hosted server URL (default: ${API_URL})\n`);
    return;
  }

  const dataDir = join(HOME, '.context-mcp');
  const configPath = join(dataDir, 'config.json');
  let vaultConfig = {};
  if (existsSync(configPath)) {
    try {
      vaultConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch {}
  }

  const { detected } = await detectAllTools();

  if (target === 'local') {
    vaultConfig.mode = 'local';
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(vaultConfig, null, 2) + '\n');

    console.log();
    console.log(`  ${bold('◇ context-vault')} ${dim('switch → local')}`);
    console.log();

    const defaultVDir = join(HOME, 'vault');
    const customVaultDir =
      vaultConfig.vaultDir && resolve(vaultConfig.vaultDir) !== resolve(defaultVDir)
        ? vaultConfig.vaultDir
        : null;

    for (const tool of detected) {
      try {
        if (tool.configType === 'cli' && tool.id === 'codex') {
          await configureCodex(tool, customVaultDir);
        } else if (tool.configType === 'cli') {
          await configureClaude(tool, customVaultDir);
        } else {
          configureJsonTool(tool, customVaultDir);
        }
        console.log(`  ${green('+')} ${tool.name} — switched to local`);
      } catch (e) {
        console.log(`  ${red('x')} ${tool.name} — ${e.message}`);
      }
    }
    console.log();
    console.log(green('  ✓ Switched to local mode.'));
    console.log(dim(`  Server: context-vault serve`));
    console.log();
  } else {
    const hostedUrl = getFlag('--url') || vaultConfig.hostedUrl || API_URL;
    const apiKey = getFlag('--key') || vaultConfig.apiKey;

    if (!apiKey) {
      console.error(red(`  --key <api_key> required. Get yours at ${hostedUrl}/dashboard`));
      process.exit(1);
    }

    console.log();
    console.log(`  ${bold('◇ context-vault')} ${dim('switch → hosted')}`);
    console.log();
    console.log(dim('  Verifying API key...'));

    try {
      const response = await fetch(`${hostedUrl}/api/me`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const user = await response.json();
      console.log(`  ${green('+')} Verified — ${user.email}\n`);
    } catch (e) {
      console.error(red(`  Verification failed: ${e.message}`));
      process.exit(1);
    }

    vaultConfig.mode = 'hosted';
    vaultConfig.hostedUrl = hostedUrl;
    vaultConfig.apiKey = apiKey;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(vaultConfig, null, 2) + '\n');

    for (const tool of detected) {
      try {
        if (tool.configType === 'cli' && tool.id === 'codex') {
          configureCodexHosted(apiKey, hostedUrl);
        } else if (tool.configType === 'cli') {
          configureClaudeHosted(apiKey, hostedUrl);
        } else {
          configureJsonToolHosted(tool, apiKey, hostedUrl);
        }
        console.log(`  ${green('+')} ${tool.name} — switched to hosted`);
      } catch (e) {
        console.log(`  ${red('x')} ${tool.name} — ${e.message}`);
      }
    }
    console.log();
    console.log(green('  ✓ Switched to hosted mode.'));
    console.log(dim(`  Endpoint: ${hostedUrl}/mcp`));
    console.log();
  }
}

async function runReindex() {
  console.log(dim('Loading vault...'));

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import('@context-vault/core/db');
  const { embed } = await import('@context-vault/core/embed');
  const { reindex } = await import('@context-vault/core/index');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`Vault directory not found: ${config.vaultDir}`));
    console.error('Run ' + cyan('context-vault setup') + ' to configure.');
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);
  const ctx = {
    db,
    config,
    stmts,
    embed,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  const stats = await reindex(ctx, { fullSync: true });

  db.close();
  console.log(green('✓ Reindex complete'));
  console.log(`  ${green('+')} ${stats.added} added`);
  console.log(`  ${yellow('~')} ${stats.updated} updated`);
  console.log(`  ${red('-')} ${stats.removed} removed`);
  console.log(`  ${dim('·')} ${stats.unchanged} unchanged`);
}

async function runMigrateDirs() {
  const dryRun = flags.has('--dry-run');

  // Vault dir: positional arg (skip --flags), or fall back to configured vault
  const positional = args.slice(1).find((a) => !a.startsWith('--'));
  let vaultDir = positional;

  if (!vaultDir) {
    const { resolveConfig } = await import('@context-vault/core/config');
    const config = resolveConfig();
    if (!config.vaultDirExists) {
      console.error(red(`Vault directory not found: ${config.vaultDir}`));
      console.error('Run ' + cyan('context-vault setup') + ' to configure.');
      process.exit(1);
    }
    vaultDir = config.vaultDir;
  }

  if (!existsSync(vaultDir) || !statSync(vaultDir).isDirectory()) {
    console.error(red(`Error: ${vaultDir} is not a directory`));
    process.exit(1);
  }

  const { planMigration, executeMigration } = await import('../dist/migrate-dirs.js');

  const ops = planMigration(vaultDir);

  if (ops.length === 0) {
    console.log(green('✓ No plural directories found — vault is up to date.'));
    return;
  }

  if (dryRun) {
    console.log(dim('Dry run — no files will be moved.\n'));
  }

  for (const op of ops) {
    const fileLabel = `${op.fileCount} ${op.fileCount === 1 ? 'file' : 'files'}`;
    const actionLabel = op.action === 'rename' ? 'RENAME' : 'MERGE';
    const suffix = dryRun ? dim(' [dry-run]') : '';
    console.log(
      `  ${cyan(actionLabel)}: ${op.pluralName}/ → ${op.singularName}/ (${fileLabel})${suffix}`
    );
  }

  if (dryRun) {
    console.log();
    console.log(
      dim(
        `  ${ops.length} ${ops.length === 1 ? 'directory' : 'directories'} would be renamed/merged.`
      )
    );
    console.log(dim('  Remove --dry-run to apply.'));
    return;
  }

  const { renamed, merged, errors } = executeMigration(ops);

  console.log();
  if (renamed > 0) console.log(green(`✓ Renamed: ${renamed}`));
  if (merged > 0) console.log(green(`✓ Merged:  ${merged}`));
  if (errors.length > 0) {
    for (const e of errors) console.log(red(`  ✗ ${e}`));
  }

  if (renamed + merged > 0) {
    console.log();
    console.log(dim('Run `context-vault reindex` to rebuild the search index.'));
  }
}

async function runPrune() {
  const dryRun = flags.has('--dry-run');

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import('@context-vault/core/db');
  const { pruneExpired } = await import('@context-vault/core/index');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`Vault directory not found: ${config.vaultDir}`));
    console.error('Run ' + cyan('context-vault setup') + ' to configure.');
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);

  if (dryRun) {
    const expired = db
      .prepare(
        "SELECT id, kind, title, expires_at FROM vault WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')"
      )
      .all();
    db.close();

    if (expired.length === 0) {
      console.log(green('  No expired entries found.'));
      return;
    }

    console.log(
      `\n  ${bold(String(expired.length))} expired ${expired.length === 1 ? 'entry' : 'entries'} would be removed:\n`
    );
    for (const e of expired) {
      const label = e.title ? `${e.kind}: ${e.title}` : `${e.kind} (${e.id})`;
      console.log(`  ${dim('-')} ${label} ${dim(`(expired ${e.expires_at})`)}`);
    }
    console.log(dim('\n  Dry run — no entries were removed.'));
    return;
  }

  const stmts = prepareStatements(db);
  const ctx = {
    db,
    config,
    stmts,
    embed: async () => null,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  const count = await pruneExpired(ctx);
  db.close();

  if (count === 0) {
    console.log(green('  No expired entries found.'));
  } else {
    console.log(green(`  ✓ Pruned ${count} expired ${count === 1 ? 'entry' : 'entries'}`));
  }
}

async function runArchive() {
  const dryRun = flags.has('--dry-run');

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import('@context-vault/core/db');
  const { findArchiveCandidates, archiveEntries } = await import('../dist/archive.js');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`Vault directory not found: ${config.vaultDir}`));
    console.error('Run ' + cyan('context-vault setup') + ' to configure.');
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);

  if (dryRun) {
    const ctx = {
      db,
      config,
      stmts: prepareStatements(db),
      embed: async () => null,
      insertVec: () => {},
      deleteVec: () => {},
    };
    const candidates = findArchiveCandidates(ctx);
    db.close();

    if (candidates.length === 0) {
      console.log(green('  No entries eligible for archiving.'));
      const lifecycle = config.lifecycle || {};
      console.log(dim('\n  Retention windows:'));
      for (const [tier, rules] of Object.entries(lifecycle)) {
        if (rules?.archiveAfterDays) {
          console.log(dim(`    ${tier}: archive after ${rules.archiveAfterDays} days`));
        }
      }
      return;
    }

    console.log(
      `\n  ${bold(String(candidates.length))} ${candidates.length === 1 ? 'entry' : 'entries'} eligible for archiving:\n`
    );
    for (const e of candidates) {
      const label = e.title ? `${e.kind}: ${e.title}` : `${e.kind} (${e.id})`;
      const age = e.updated_at || e.created_at;
      console.log(`  ${dim('-')} ${label} ${dim(`(tier=${e.tier}, last updated ${age})`)}`);
    }
    console.log(dim('\n  Dry run — no entries were archived.'));
    console.log(dim('  Remove --dry-run to archive.'));
    return;
  }

  const stmts = prepareStatements(db);
  const ctx = {
    db,
    config,
    stmts,
    embed: async () => null,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  const result = await archiveEntries(ctx);
  db.close();

  if (result.count === 0) {
    console.log(green('  No entries eligible for archiving.'));
  } else {
    console.log(
      green(`  ✓ Archived ${result.count} ${result.count === 1 ? 'entry' : 'entries'} to _archive/`)
    );
    console.log(dim(`  Files moved to: ${join(config.vaultDir, '_archive')}`));
    console.log(dim('  Restore with: context-vault restore <id>'));
  }
}

async function runRestore() {
  const entryId = args[1];

  if (!entryId || entryId.startsWith('--')) {
    const { resolveConfig } = await import('@context-vault/core/config');
    const { listArchivedEntries } = await import('../dist/archive.js');

    const config = resolveConfig();

    console.log(`\n  ${bold('context-vault restore')} <id>\n`);
    console.log(`  Restore an archived entry back into the active vault.\n`);

    if (config.vaultDirExists) {
      const entries = listArchivedEntries(config.vaultDir);
      if (entries.length > 0) {
        console.log(`  ${bold('Archived entries')} (${entries.length}):\n`);
        for (const e of entries.slice(0, 20)) {
          const label = e.title ? `${e.kind}: ${e.title.slice(0, 60)}` : `${e.kind} (${e.id})`;
          console.log(`    ${dim(e.id || '?')}  ${label}`);
        }
        if (entries.length > 20) {
          console.log(dim(`\n    ... and ${entries.length - 20} more`));
        }
      } else {
        console.log(dim('  No archived entries found.'));
      }
    }
    console.log();
    return;
  }

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import('@context-vault/core/db');
  const { embed } = await import('@context-vault/core/embed');
  const { restoreEntry } = await import('../dist/archive.js');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`Vault directory not found: ${config.vaultDir}`));
    console.error('Run ' + cyan('context-vault setup') + ' to configure.');
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);
  const ctx = {
    db,
    config,
    stmts,
    embed,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  const result = await restoreEntry(ctx, entryId);
  db.close();

  if (result.restored) {
    console.log(green(`  ✓ Restored ${result.kind} entry: ${result.id}`));
    console.log(dim(`  File: ${result.filePath}`));
  } else {
    console.error(red(`  ✗ ${result.reason}`));
    process.exit(1);
  }
}

async function runStatus() {
  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase } = await import('@context-vault/core/db');
  const { gatherVaultStatus } = await import('../dist/status.js');
  const { errorLogPath, errorLogCount } = await import('../dist/error-log.js');

  const config = resolveConfig();

  let mode = 'local';
  let modeDetail = '';
  const rawConfigPath = join(HOME, '.context-mcp', 'config.json');
  if (existsSync(rawConfigPath)) {
    try {
      const raw = JSON.parse(readFileSync(rawConfigPath, 'utf-8'));
      mode = raw.mode || 'local';
      if (mode === 'hosted' && raw.hostedUrl) {
        const email = raw.email ? ` · ${raw.email}` : '';
        modeDetail = ` (${raw.hostedUrl}${email})`;
      } else {
        modeDetail = ` (context-vault serve)`;
      }
    } catch {}
  }

  let db;
  try {
    db = await initDatabase(config.dbPath);
  } catch (e) {
    console.log();
    console.log(`  ${bold('◇ context-vault')} ${dim(`v${VERSION}`)}`);
    console.log();
    console.log(`  ${red('✘')} Database not accessible: ${e.message}`);
    console.log(dim(`  Run ${cyan('context-vault doctor')} for diagnostics`));
    console.log();
    process.exit(1);
  }

  const status = gatherVaultStatus({ db, config });

  db.close();

  console.log();
  console.log(`  ${bold('◇ context-vault')} ${dim(`v${VERSION}`)}`);
  console.log();
  console.log(`  Mode:      ${mode}${dim(modeDetail)}`);
  console.log(
    `  Vault:     ${config.vaultDir} ${dim(`(${config.vaultDirExists ? status.fileCount + ' files' : 'missing'})`)}`
  );
  console.log(`  Database:  ${config.dbPath} ${dim(`(${status.dbSize})`)}`);
  console.log(`  Dev dir:   ${config.devDir}`);
  console.log(`  Data dir:  ${config.dataDir}`);
  console.log(
    `  Config:    ${config.configPath} ${dim(`(${existsSync(config.configPath) ? 'exists' : 'missing'})`)}`
  );
  console.log(`  Resolved:  ${status.resolvedFrom}`);
  console.log(`  Schema:    v7 (teams)`);

  if (status.kindCounts.length) {
    const BAR_WIDTH = 20;
    const maxCount = Math.max(...status.kindCounts.map((k) => k.c));
    console.log();
    console.log(bold('  Indexed'));
    for (const { kind, c } of status.kindCounts) {
      const filled = maxCount > 0 ? Math.round((c / maxCount) * BAR_WIDTH) : 0;
      const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
      const countStr = String(c).padStart(4);
      console.log(`    ${dim(bar)} ${countStr} ${kind}s`);
    }
  } else {
    console.log(`\n  ${dim('(empty — no entries indexed)')}`);
  }

  if (status.embeddingStatus) {
    const { indexed, total, missing } = status.embeddingStatus;
    if (missing > 0) {
      const BAR_WIDTH = 20;
      const filled = total > 0 ? Math.round((indexed / total) * BAR_WIDTH) : 0;
      const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
      const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;
      console.log();
      console.log(`  Embeddings ${dim(bar)} ${indexed}/${total} (${pct}%)`);
    }
  }

  if (status.subdirs.length) {
    console.log();
    console.log(bold('  Disk Directories'));
    for (const { name, count } of status.subdirs) {
      console.log(`    ${name}/: ${count} files`);
    }
  }

  if (status.archivedCount > 0) {
    console.log();
    console.log(
      dim(
        `  ${status.archivedCount} archived ${status.archivedCount === 1 ? 'entry' : 'entries'} in _archive/ (excluded from search)`
      )
    );
  }

  if (status.stalePaths) {
    console.log();
    console.log(yellow('  Stale paths detected in DB.'));
    console.log(`  Run ${cyan('context-vault reindex')} to update.`);
  }

  const logCount = errorLogCount(config.dataDir);
  if (logCount > 0) {
    const logPath = errorLogPath(config.dataDir);
    console.log();
    console.log(
      yellow(
        `  ${logCount} startup error${logCount === 1 ? '' : 's'} logged — run ${cyan('context-vault doctor')} for details`
      )
    );
    console.log(`  ${dim(logPath)}`);
  }
  console.log();
}

async function runUpdate() {
  console.log();
  console.log(`  ${bold('◇ context-vault')} ${dim(`v${VERSION}`)}`);
  console.log();

  let latest;
  try {
    latest = execSync('npm view context-vault version', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    console.error(red('  Could not check for updates. Verify your network connection.'));
    return;
  }

  if (latest === VERSION) {
    console.log(green('  Already up to date.'));
    console.log();
    return;
  }

  console.log(`  Current: ${dim(VERSION)}`);
  console.log(`  Latest:  ${green(latest)}`);
  console.log();

  if (!isNonInteractive) {
    const answer = await prompt(`  Update to v${latest}? (Y/n):`, 'Y');
    if (answer.toLowerCase() === 'n') {
      console.log(dim('  Cancelled.'));
      return;
    }
  }

  console.log(dim('  Installing...'));
  try {
    execSync('npm install -g context-vault@latest', { stdio: 'inherit' });
    console.log();
    console.log(green(`  ✓ Updated to v${latest}`));
  } catch {
    console.error(red('  Update failed. Try manually: npx -y context-vault@latest setup'));
  }
  console.log();
}

async function runUninstall() {
  console.log();
  console.log(`  ${bold('◇ context-vault')} ${dim('uninstall')}`);
  console.log();

  // Remove from Claude Code (both old and new names)
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    try {
      execSync('claude mcp remove context-mcp -s user', { stdio: 'pipe', env });
    } catch {}
    execSync('claude mcp remove context-vault -s user', { stdio: 'pipe', env });
    console.log(`  ${green('+')} Removed from Claude Code`);
  } catch {
    console.log(`  ${dim('-')} Claude Code — not configured or not installed`);
  }

  // Remove from Codex (both old and new names)
  try {
    try {
      execSync('codex mcp remove context-mcp', { stdio: 'pipe' });
    } catch {}
    execSync('codex mcp remove context-vault', { stdio: 'pipe' });
    console.log(`  ${green('+')} Removed from Codex`);
  } catch {
    console.log(`  ${dim('-')} Codex — not configured or not installed`);
  }

  // Remove from JSON-configured tools (both old and new keys)
  for (const tool of TOOLS.filter((t) => t.configType === 'json')) {
    if (!existsSync(tool.configPath)) continue;
    try {
      const config = JSON.parse(readFileSync(tool.configPath, 'utf-8'));
      const hadOld = !!config[tool.configKey]?.['context-mcp'];
      const hadNew = !!config[tool.configKey]?.['context-vault'];
      if (hadOld || hadNew) {
        delete config[tool.configKey]['context-mcp'];
        delete config[tool.configKey]['context-vault'];
        writeFileSync(tool.configPath, JSON.stringify(config, null, 2) + '\n');
        console.log(`  ${green('+')} Removed from ${tool.name}`);
      }
    } catch {
      console.log(`  ${dim('-')} ${tool.name} — could not update config`);
    }
  }

  // Remove Claude Code hooks
  const recallRemoved = removeClaudeHook();
  const captureRemoved = removeSessionCaptureHook();
  const flushRemoved = removeSessionEndHook();
  const autoCaptureRemoved = removePostToolCallHook();
  if (recallRemoved || captureRemoved || flushRemoved || autoCaptureRemoved) {
    console.log(`  ${green('+')} Removed Claude Code hooks`);
  } else {
    console.log(`  ${dim('-')} No Claude Code hooks to remove`);
  }

  // Remove installed skills
  const skillsDir = join(HOME, '.claude', 'skills', 'compile-context');
  if (existsSync(skillsDir)) {
    const { rmSync } = await import('node:fs');
    rmSync(skillsDir, { recursive: true, force: true });
    console.log(`  ${green('+')} Removed installed skills`);
  }

  // Optionally remove data directory
  const dataDir = join(HOME, '.context-mcp');
  if (existsSync(dataDir)) {
    console.log();
    const answer = isNonInteractive
      ? 'n'
      : await prompt(`  Remove data directory (${dataDir})? (y/N):`, 'N');
    if (answer.toLowerCase() === 'y') {
      const { rmSync } = await import('node:fs');
      rmSync(dataDir, { recursive: true, force: true });
      console.log(`  ${green('+')} Removed ${dataDir}`);
    } else {
      console.log(`  ${dim('Kept')} ${dataDir}`);
    }
  }

  console.log();
  console.log(dim('  Vault directory was not touched (your knowledge files are safe).'));
  console.log(`  To fully remove: ${cyan('npm uninstall -g context-vault')}`);
  console.log();
}

async function runMigrate() {
  const direction = args.includes('--to-hosted')
    ? 'to-hosted'
    : args.includes('--to-local')
      ? 'to-local'
      : null;

  if (!direction) {
    console.log(`\n  ${bold('context-vault migrate')}\n`);
    console.log(`  Usage:`);
    console.log(`    context-vault migrate --to-hosted  Upload local vault to hosted service`);
    console.log(`    context-vault migrate --to-local   Download hosted vault to local files`);
    console.log(`\n  Options:`);
    console.log(`    --url <url>      Hosted server URL (default: ${API_URL})`);
    console.log(`    --key <key>      API key (cv_...)`);
    console.log();
    return;
  }

  const hostedUrl = getFlag('--url') || API_URL;
  const apiKey = getFlag('--key');

  if (!apiKey) {
    console.error(red('  Error: --key <api_key> is required for migration.'));
    console.error(`  Get your API key at ${cyan(hostedUrl + '/dashboard')}`);
    return;
  }

  const { resolveConfig } = await import('@context-vault/core/config');
  const config = resolveConfig();

  if (direction === 'to-hosted') {
    const { migrateToHosted } = await import('@context-vault/hosted/migration/migrate');
    console.log(`\n  ${bold('Migrating to hosted')}...`);
    console.log(dim(`  Vault: ${config.vaultDir}`));
    console.log(dim(`  Target: ${hostedUrl}\n`));

    const results = await migrateToHosted({
      vaultDir: config.vaultDir,
      hostedUrl,
      apiKey,
      log: (msg) => console.log(`  ${dim(msg)}`),
    });

    console.log(`\n  ${green('+')} ${results.uploaded} entries uploaded`);
    if (results.failed > 0) {
      console.log(`  ${red('-')} ${results.failed} failed`);
      for (const err of results.errors.slice(0, 5)) {
        console.log(`    ${dim(err)}`);
      }
    }
    console.log(dim('\n  Your local vault was not modified (safe backup).'));
  } else {
    const { migrateToLocal } = await import('@context-vault/hosted/migration/migrate');
    console.log(`\n  ${bold('Migrating to local')}...`);
    console.log(dim(`  Source: ${hostedUrl}`));
    console.log(dim(`  Target: ${config.vaultDir}\n`));

    const results = await migrateToLocal({
      vaultDir: config.vaultDir,
      hostedUrl,
      apiKey,
      log: (msg) => console.log(`  ${dim(msg)}`),
    });

    console.log(`\n  ${green('+')} ${results.downloaded} entries restored`);
    if (results.failed > 0) {
      console.log(`  ${red('-')} ${results.failed} failed`);
    }
    console.log(dim('\n  Run `context-vault reindex` to rebuild the search index.'));
  }
  console.log();
}

async function runImport() {
  const target = args[1];
  if (!target) {
    console.log(`\n  ${bold('context-vault import')} <path>\n`);
    console.log(`  Import entries from a file, directory, or portable archive.\n`);
    console.log(`  Supported formats: .md, .csv, .tsv, .json, .txt, .zip\n`);
    console.log(`  Options:`);
    console.log(`    --kind <kind>    Default kind (default: insight)`);
    console.log(`    --source <src>   Default source (default: cli-import)`);
    console.log(`    --dry-run        Show parsed entries without importing`);
    console.log(`    --vault <path>   Target vault directory (default: configured vault)`);
    console.log();
    return;
  }

  const dryRun = flags.has('--dry-run');
  const targetPath = resolve(target);

  if (!existsSync(targetPath)) {
    console.error(red(`  Path not found: ${targetPath}`));
    process.exit(1);
  }

  if (targetPath.endsWith('.zip')) {
    return runImportZip(targetPath, dryRun);
  }

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import('@context-vault/core/db');
  const { embed } = await import('@context-vault/core/embed');
  const { parseFile, parseDirectory } = await import('@context-vault/core/capture/importers');
  const { importEntries } = await import('@context-vault/core/capture/import-pipeline');
  const { readFileSync, statSync } = await import('node:fs');

  const kind = getFlag('--kind') || undefined;
  const source = getFlag('--source') || 'cli-import';

  const stat = statSync(targetPath);
  let entries;

  if (stat.isDirectory()) {
    entries = parseDirectory(targetPath, { kind, source });
  } else {
    const content = readFileSync(targetPath, 'utf-8');
    entries = parseFile(targetPath, content, { kind, source });
  }

  if (entries.length === 0) {
    console.log(yellow('  No entries found to import.'));
    return;
  }

  console.log(`\n  Found ${bold(String(entries.length))} entries to import\n`);

  if (dryRun) {
    for (let i = 0; i < Math.min(entries.length, 20); i++) {
      const e = entries[i];
      console.log(
        `  ${dim(`[${i + 1}]`)} ${e.kind} — ${e.title || e.body.slice(0, 60)}${e.tags?.length ? ` ${dim(`[${e.tags.join(', ')}]`)}` : ''}`
      );
    }
    if (entries.length > 20) {
      console.log(dim(`  ... and ${entries.length - 20} more`));
    }
    console.log(dim('\n  Dry run — no entries were imported.'));
    return;
  }

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`  Vault directory not found: ${config.vaultDir}`));
    console.error(`  Run ${cyan('context-vault setup')} to configure.`);
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);
  const ctx = {
    db,
    config,
    stmts,
    embed,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  const result = await importEntries(ctx, entries, {
    source,
    onProgress: (current, total) => {
      process.stdout.write(`\r  Importing... ${current}/${total}`);
    },
  });

  db.close();

  console.log(`\r  ${green('✓')} Import complete                    `);
  console.log(`    ${green('+')} ${result.imported} imported`);
  if (result.failed > 0) {
    console.log(`    ${red('x')} ${result.failed} failed`);
    for (const err of result.errors.slice(0, 5)) {
      console.log(`      ${dim(err.error)}`);
    }
  }
  console.log();
}

async function runImportZip(zipPath, dryRun) {
  const AdmZip = (await import('adm-zip')).default;
  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import('@context-vault/core/db');
  const { embed } = await import('@context-vault/core/embed');
  const { indexEntry } = await import('@context-vault/core/index');
  const { parseFrontmatter } = await import('@context-vault/core/frontmatter');
  const { categoryDirFor } = await import('@context-vault/core/categories');
  const { mkdirSync, writeFileSync, existsSync: existsFn } = await import('node:fs');
  const { join: joinPath, basename: baseName } = await import('node:path');

  let zip;
  try {
    zip = new AdmZip(zipPath);
  } catch (e) {
    console.error(red(`\n  Failed to open archive: ${e.message}\n`));
    process.exit(1);
  }

  const manifestEntry = zip.getEntry('manifest.json');
  if (!manifestEntry) {
    console.error(red('\n  Invalid archive: missing manifest.json\n'));
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(zip.readAsText('manifest.json'));
  } catch {
    console.error(red('\n  Invalid archive: corrupt manifest.json\n'));
    process.exit(1);
  }

  const indexEntry_ = zip.getEntry('index.json');
  if (!indexEntry_) {
    console.error(red('\n  Invalid archive: missing index.json\n'));
    process.exit(1);
  }

  let index;
  try {
    index = JSON.parse(zip.readAsText('index.json'));
  } catch {
    console.error(red('\n  Invalid archive: corrupt index.json\n'));
    process.exit(1);
  }

  const entries = index.entries || [];
  if (entries.length === 0) {
    console.log(yellow('\n  Archive contains no entries.\n'));
    return;
  }

  console.log(`\n  ${bold('◇ context-vault import')} ${dim(baseName(zipPath))}`);
  console.log(
    dim(
      `  Archive: v${manifest.version} · ${manifest.entry_count} entries · ${manifest.context_vault_version || '?'}`
    )
  );

  const kindCounts = {};
  for (const e of entries) {
    kindCounts[e.kind] = (kindCounts[e.kind] || 0) + 1;
  }
  console.log();
  for (const [k, count] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}: ${count}`);
  }

  const vaultDirOverride = getFlag('--vault');
  const config = (await import('@context-vault/core/config')).resolveConfig();
  const targetVaultDir = vaultDirOverride ? resolve(vaultDirOverride) : config.vaultDir;

  if (!existsFn(targetVaultDir)) {
    console.error(red(`\n  Vault directory not found: ${targetVaultDir}`));
    console.error(`  Run ${cyan('context-vault setup')} to configure.`);
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);
  const ctx = {
    db,
    config: { ...config, vaultDir: targetVaultDir },
    stmts,
    embed,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  const existingIds = new Set();
  const allIds = db.prepare('SELECT id FROM vault').all();
  for (const row of allIds) existingIds.add(row.id);

  let imported = 0;
  let skippedDuplicate = 0;
  let skippedMissing = 0;
  let failed = 0;
  const errors = [];

  if (dryRun) {
    for (let i = 0; i < Math.min(entries.length, 25); i++) {
      const e = entries[i];
      const isDuplicate = existingIds.has(e.id);
      const tagStr = e.tags?.length ? ` ${dim(`[${e.tags.join(', ')}]`)}` : '';
      const statusIcon = isDuplicate ? yellow('~') : green('+');
      const statusText = isDuplicate ? dim(' (duplicate, would skip)') : '';
      console.log(
        `\n  ${statusIcon} ${dim(`[${i + 1}]`)} ${e.kind} — ${e.title || e.id}${tagStr}${statusText}`
      );
    }
    if (entries.length > 25) {
      console.log(dim(`\n  ... and ${entries.length - 25} more`));
    }
    const wouldSkip = entries.filter((e) => existingIds.has(e.id)).length;
    console.log(
      `\n  ${dim(`Would import ${entries.length - wouldSkip}, skip ${wouldSkip} duplicates.`)}`
    );
    console.log(dim('  Dry run — no entries were imported.\n'));
    db.close();
    return;
  }

  for (let i = 0; i < entries.length; i++) {
    const entryMeta = entries[i];
    process.stdout.write(`\r  Importing... ${i + 1}/${entries.length}`);

    if (existingIds.has(entryMeta.id)) {
      skippedDuplicate++;
      continue;
    }

    const zipEntry = zip.getEntry(entryMeta.file);
    if (!zipEntry) {
      skippedMissing++;
      continue;
    }

    const mdContent = zip.readAsText(entryMeta.file);
    const { meta: fmMeta, body: rawBody } = parseFrontmatter(mdContent);

    const kind = entryMeta.kind || fmMeta.kind || 'insight';
    const categoryDir = categoryDirFor(kind);
    const targetDir = joinPath(targetVaultDir, categoryDir, kind);

    try {
      mkdirSync(targetDir, { recursive: true });

      const fileName = baseName(entryMeta.file);
      const filePath = joinPath(targetDir, fileName);
      writeFileSync(filePath, mdContent);

      const id = fmMeta.id || entryMeta.id;
      const tags = Array.isArray(fmMeta.tags) ? fmMeta.tags : entryMeta.tags || [];
      const title = fmMeta.title || entryMeta.title || null;
      const source = fmMeta.source || entryMeta.source || 'archive-import';
      const identity_key = fmMeta.identity_key || entryMeta.identity_key || null;
      const expires_at = fmMeta.expires_at || entryMeta.expires_at || null;
      const createdAt = fmMeta.created || entryMeta.created_at || new Date().toISOString();

      await indexEntry(ctx, {
        id,
        kind,
        category: entryMeta.category || undefined,
        title,
        body: rawBody,
        meta: null,
        tags,
        source,
        filePath,
        createdAt,
        identity_key,
        expires_at,
      });

      imported++;
    } catch (e) {
      failed++;
      errors.push({ id: entryMeta.id, error: e.message });
    }
  }

  db.close();

  console.log(`\r  ${green('✓')} Import complete                    `);
  console.log(`    ${green('+')} ${imported} imported`);
  if (skippedDuplicate > 0) {
    console.log(`    ${dim('~')} ${skippedDuplicate} skipped (already exist)`);
  }
  if (skippedMissing > 0) {
    console.log(`    ${yellow('!')} ${skippedMissing} skipped (file missing in archive)`);
  }
  if (failed > 0) {
    console.log(`    ${red('x')} ${failed} failed`);
    for (const e of errors.slice(0, 5)) {
      console.log(`      ${dim(e.error)}`);
    }
  }
  console.log();
}

async function runExport() {
  const format = getFlag('--format') || 'json';
  const output = getFlag('--output') || getFlag('-o');
  const rawPageSize = getFlag('--page-size');
  const pageSize = rawPageSize ? Math.max(1, parseInt(rawPageSize, 10) || 100) : null;

  if (format === 'zip') {
    return runExportZip();
  }

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements } = await import('@context-vault/core/db');
  const { writeFileSync } = await import('node:fs');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`  Vault directory not found: ${config.vaultDir}`));
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);

  const whereClause = "WHERE (expires_at IS NULL OR expires_at > datetime('now'))";

  let entries;
  if (pageSize) {
    entries = [];
    let offset = 0;
    const stmt = db.prepare(
      `SELECT * FROM vault ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    );
    while (true) {
      const rows = stmt.all(pageSize, offset);
      if (rows.length === 0) break;
      for (const row of rows) {
        entries.push(mapExportRow(row));
      }
      offset += rows.length;
      if (rows.length < pageSize) break;
    }
  } else {
    const rows = db.prepare(`SELECT * FROM vault ${whereClause} ORDER BY created_at DESC`).all();
    entries = rows.map(mapExportRow);
  }

  db.close();

  let content;

  if (format === 'csv') {
    const headers = [
      'id',
      'kind',
      'category',
      'title',
      'body',
      'tags',
      'source',
      'identity_key',
      'expires_at',
      'created_at',
    ];
    const csvLines = [headers.join(',')];
    for (const e of entries) {
      const row = headers.map((h) => {
        let val = e[h];
        if (Array.isArray(val)) val = val.join(', ');
        if (val == null) val = '';
        val = String(val);
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      });
      csvLines.push(row.join(','));
    }
    content = csvLines.join('\n');
  } else {
    content = JSON.stringify(
      { entries, total: entries.length, exported_at: new Date().toISOString() },
      null,
      2
    );
  }

  if (output) {
    writeFileSync(resolve(output), content);
    console.log(green(`  ✓ Exported ${entries.length} entries to ${output}`));
  } else {
    process.stdout.write(content);
  }
}

async function runExportZip() {
  const output = getFlag('--output') || getFlag('-o');
  const dryRun = flags.has('--dry-run');
  const tagsRaw = getFlag('--tags');
  const kindRaw = getFlag('--kind');
  const since = getFlag('--since');
  const until = getFlag('--until');
  const exportAll = flags.has('--all');

  const tagsFilter = tagsRaw
    ? tagsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
    : null;
  const kindFilter = kindRaw
    ? kindRaw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : null;

  if (!exportAll && !tagsFilter && !kindFilter && !since && !until) {
    console.log(`\n  ${bold('context-vault export --format zip')} [options]\n`);
    console.log(`  Export vault entries as a portable ZIP archive.\n`);
    console.log(`  ${bold('Filters (at least one required, or use --all):')}`);
    console.log(`    --tags <t1,t2>       Filter by tags (comma-separated)`);
    console.log(`    --kind <k1,k2>       Filter by kind (comma-separated)`);
    console.log(`    --since <YYYY-MM-DD> Entries created on or after date`);
    console.log(`    --until <YYYY-MM-DD> Entries created on or before date`);
    console.log(`    --all                Export all entries\n`);
    console.log(`  ${bold('Options:')}`);
    console.log(`    --output, -o <path>  Output file path`);
    console.log(`    --dry-run            Show what would be exported\n`);
    console.log(`  ${bold('Examples:')}`);
    console.log(`    context-vault export --tags stormfors --format zip -o stormfors.zip`);
    console.log(`    context-vault export --kind decision,pattern --format zip`);
    console.log(`    context-vault export --since 2026-01-01 --until 2026-02-28 --format zip`);
    console.log(`    context-vault export --all --format zip --dry-run\n`);
    return;
  }

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase } = await import('@context-vault/core/db');
  const { readFileSync: readFs, existsSync: existsFn } = await import('node:fs');
  const { basename } = await import('node:path');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`  Vault directory not found: ${config.vaultDir}`));
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);

  const conditions = ["(expires_at IS NULL OR expires_at > datetime('now'))"];
  const params = [];

  if (tagsFilter) {
    const tagClauses = tagsFilter.map(
      () => 'EXISTS (SELECT 1 FROM json_each(vault.tags) WHERE json_each.value = ?)'
    );
    conditions.push(`(${tagClauses.join(' OR ')})`);
    params.push(...tagsFilter);
  }

  if (kindFilter) {
    const placeholders = kindFilter.map(() => '?').join(', ');
    conditions.push(`kind IN (${placeholders})`);
    params.push(...kindFilter);
  }

  if (since) {
    conditions.push('created_at >= ?');
    params.push(since.includes('T') ? since : `${since}T00:00:00.000Z`);
  }

  if (until) {
    conditions.push('created_at <= ?');
    params.push(until.includes('T') ? until : `${until}T23:59:59.999Z`);
  }

  const sql = `SELECT * FROM vault WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`;
  const rows = db.prepare(sql).all(...params);
  db.close();

  if (rows.length === 0) {
    console.log(yellow('\n  No entries match the given filters.\n'));
    return;
  }

  const kindCounts = {};
  for (const row of rows) {
    kindCounts[row.kind] = (kindCounts[row.kind] || 0) + 1;
  }

  console.log(`\n  ${bold(String(rows.length))} entries match filters:\n`);
  for (const [k, count] of Object.entries(kindCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k}: ${count}`);
  }

  const earliest = rows[rows.length - 1]?.created_at;
  const latest = rows[0]?.created_at;
  console.log(
    dim(`\n  Date range: ${earliest?.slice(0, 10) || '?'} → ${latest?.slice(0, 10) || '?'}`)
  );

  if (dryRun) {
    console.log();
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const r = rows[i];
      const tags = safeJsonParse(r.tags, []);
      const tagStr = tags.length ? ` ${dim(`[${tags.join(', ')}]`)}` : '';
      console.log(
        `  ${dim(`[${i + 1}]`)} ${r.kind} — ${r.title || (r.body || '').slice(0, 60)}${tagStr}`
      );
    }
    if (rows.length > 25) {
      console.log(dim(`  ... and ${rows.length - 25} more`));
    }
    console.log(dim('\n  Dry run — no archive created.\n'));
    return;
  }

  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip();

  const indexEntries = [];
  let filesSkipped = 0;

  for (const row of rows) {
    const entryPath = `entries/${row.kind}/${basename(row.file_path || `${row.id}.md`)}`;

    let fileContent = null;
    if (row.file_path && existsFn(row.file_path)) {
      fileContent = readFs(row.file_path);
    }

    if (!fileContent) {
      filesSkipped++;
      continue;
    }

    zip.addFile(entryPath, fileContent);

    indexEntries.push({
      id: row.id,
      kind: row.kind,
      category: row.category,
      title: row.title || null,
      tags: safeJsonParse(row.tags, []),
      source: row.source || null,
      identity_key: row.identity_key || null,
      expires_at: row.expires_at || null,
      created_at: row.created_at,
      file: entryPath,
    });
  }

  const manifest = {
    version: 1,
    created_at: new Date().toISOString(),
    context_vault_version: VERSION,
    entry_count: indexEntries.length,
    date_range: { earliest, latest },
    filters: {
      tags: tagsFilter || null,
      kind: kindFilter || null,
      since: since || null,
      until: until || null,
      all: exportAll || false,
    },
  };

  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
  zip.addFile('index.json', Buffer.from(JSON.stringify({ entries: indexEntries }, null, 2)));

  const today = new Date().toISOString().slice(0, 10);
  const defaultName = tagsFilter
    ? `vault-${tagsFilter[0]}-${today}.zip`
    : `vault-export-${today}.zip`;
  const outputPath = resolve(output || defaultName);

  zip.writeZip(outputPath);

  console.log(`\n  ${green('✓')} Exported ${indexEntries.length} entries to ${outputPath}`);
  if (filesSkipped > 0) {
    console.log(yellow(`  ⚠ ${filesSkipped} entries skipped (file not found on disk)`));
  }
  console.log();
}

function safeJsonParse(str, fallback) {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function mapExportRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title || null,
    body: row.body || null,
    tags: safeJsonParse(row.tags, []),
    meta: safeJsonParse(row.meta, {}),
    source: row.source || null,
    identity_key: row.identity_key || null,
    expires_at: row.expires_at || null,
    created_at: row.created_at,
  };
}

async function runIngest() {
  const url = args[1];
  if (!url) {
    console.log(`\n  ${bold('context-vault ingest')} <url>\n`);
    console.log(`  Fetch a URL and save as a vault entry.\n`);
    console.log(`  Options:`);
    console.log(`    --kind <kind>    Entry kind (default: reference)`);
    console.log(`    --tags t1,t2     Comma-separated tags`);
    console.log(`    --dry-run        Show extracted content without saving`);
    console.log();
    return;
  }

  const { ingestUrl } = await import('@context-vault/core/capture/ingest-url');
  const kind = getFlag('--kind') || undefined;
  const tagsStr = getFlag('--tags');
  const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()) : undefined;
  const dryRun = flags.has('--dry-run');

  console.log(dim(`  Fetching ${url}...`));

  let entry;
  try {
    entry = await ingestUrl(url, { kind, tags });
  } catch (e) {
    console.error(red(`  Failed: ${e.message}`));
    process.exit(1);
  }

  console.log(`\n  ${bold(entry.title)}`);
  console.log(
    `  ${dim(`kind: ${entry.kind} | source: ${entry.source} | ${entry.body.length} chars`)}`
  );
  if (entry.tags?.length) console.log(`  ${dim(`tags: ${entry.tags.join(', ')}`)}`);

  if (dryRun) {
    console.log(`\n${dim('  Preview (first 500 chars):')}`);
    console.log(dim('  ' + entry.body.slice(0, 500).split('\n').join('\n  ')));
    console.log(dim('\n  Dry run — entry was not saved.'));
    return;
  }

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import('@context-vault/core/db');
  const { embed } = await import('@context-vault/core/embed');
  const { captureAndIndex } = await import('@context-vault/core/capture');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`\n  Vault directory not found: ${config.vaultDir}`));
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);
  const ctx = {
    db,
    config,
    stmts,
    embed,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  const result = await captureAndIndex(ctx, entry);
  db.close();

  const relPath = result.filePath.replace(config.vaultDir + '/', '');
  console.log(`\n  ${green('✓')} Saved → ${relPath}`);
  console.log(`    id: ${result.id}`);
  console.log();
}

async function runIngestProject() {
  const rawPath = args[1];
  if (!rawPath) {
    console.log(`\n  ${bold('context-vault ingest-project')} <path>\n`);
    console.log(`  Scan a local project directory and register it as a project entity.\n`);
    console.log(`  Options:`);
    console.log(`    --tags t1,t2     Comma-separated additional tags`);
    console.log(`    --pillar <name>  Parent pillar/domain name (creates a bucket:<name> tag)`);
    console.log();
    return;
  }

  // Resolve path (handle ~, relative)
  let projectPath = rawPath;
  if (projectPath.startsWith('~')) {
    projectPath = join(HOME, projectPath.slice(1));
  } else if (!projectPath.startsWith('/')) {
    projectPath = resolve(process.cwd(), projectPath);
  }

  if (!existsSync(projectPath)) {
    console.error(red(`\n  Directory not found: ${projectPath}`));
    process.exit(1);
  }

  const tagsStr = getFlag('--tags');
  const tags = tagsStr ? tagsStr.split(',').map((t) => t.trim()) : undefined;
  const pillar = getFlag('--pillar') || undefined;

  console.log(dim(`  Scanning ${projectPath}...`));

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import('@context-vault/core/db');
  const { embed } = await import('@context-vault/core/embed');
  const { captureAndIndex } = await import('@context-vault/core/capture');
  const { existsSync: fsExists, readFileSync: fsRead } = await import('node:fs');
  const { join: pathJoin, basename: pathBasename } = await import('node:path');
  const { execSync: childExec } = await import('node:child_process');

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`\n  Vault directory not found: ${config.vaultDir}`));
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);
  const stmts = prepareStatements(db);
  const ctx = {
    db,
    config,
    stmts,
    embed,
    insertVec: (r, e) => insertVec(stmts, r, e),
    deleteVec: (r) => deleteVec(stmts, r),
  };

  function safeExecLocal(cmd, cwd) {
    try {
      return childExec(cmd, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      return null;
    }
  }

  // Read package.json
  let pkgJson = null;
  const pkgPath = pathJoin(projectPath, 'package.json');
  if (fsExists(pkgPath)) {
    try {
      pkgJson = JSON.parse(fsRead(pkgPath, 'utf-8'));
    } catch {
      pkgJson = null;
    }
  }

  // Project name
  let projectName = pathBasename(projectPath);
  if (pkgJson?.name) projectName = pkgJson.name.replace(/^@[^/]+\//, '');

  const identityKey = projectName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Description
  let description = pkgJson?.description || null;
  if (!description) {
    const readmeRaw = (() => {
      try {
        return fsRead(pathJoin(projectPath, 'README.md'), 'utf-8');
      } catch {
        try {
          return fsRead(pathJoin(projectPath, 'readme.md'), 'utf-8');
        } catch {
          return null;
        }
      }
    })();
    if (readmeRaw) {
      for (const line of readmeRaw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        description = t.slice(0, 200);
        break;
      }
    }
  }

  // Tech stack
  const techStack = [];
  if (
    fsExists(pathJoin(projectPath, 'pyproject.toml')) ||
    fsExists(pathJoin(projectPath, 'setup.py'))
  )
    techStack.push('python');
  if (fsExists(pathJoin(projectPath, 'Cargo.toml'))) techStack.push('rust');
  if (fsExists(pathJoin(projectPath, 'go.mod'))) techStack.push('go');
  if (pkgJson) {
    techStack.push('javascript');
    const allDeps = {
      ...(pkgJson.dependencies || {}),
      ...(pkgJson.devDependencies || {}),
    };
    if (allDeps.typescript || fsExists(pathJoin(projectPath, 'tsconfig.json')))
      techStack.push('typescript');
    if (allDeps.react || allDeps['react-dom']) techStack.push('react');
    if (allDeps.next) techStack.push('nextjs');
    if (allDeps.vue) techStack.push('vue');
    if (allDeps.svelte) techStack.push('svelte');
    if (allDeps.express) techStack.push('express');
    if (allDeps.fastify) techStack.push('fastify');
    if (allDeps.hono) techStack.push('hono');
    if (allDeps.vite) techStack.push('vite');
    if (allDeps.electron) techStack.push('electron');
    if (allDeps.tauri || allDeps['@tauri-apps/api']) techStack.push('tauri');
  }

  const isGitRepo = fsExists(pathJoin(projectPath, '.git'));
  const repoUrl = isGitRepo ? safeExecLocal('git remote get-url origin', projectPath) : null;
  const lastCommit = isGitRepo ? safeExecLocal('git log -1 --format=%ci', projectPath) : null;
  const hasClaudeMd = fsExists(pathJoin(projectPath, 'CLAUDE.md'));

  const bucketTag = `bucket:${identityKey}`;
  const autoTags = [bucketTag];
  if (pillar) autoTags.push(`bucket:${pillar}`);
  const allTags = [...new Set([...autoTags, ...(tags || [])])];

  const bodyLines = [`## ${projectName}`];
  if (description) bodyLines.push('', description);
  bodyLines.push('', '### Metadata');
  bodyLines.push(`- **Path**: \`${projectPath}\``);
  if (repoUrl) bodyLines.push(`- **Repo**: ${repoUrl}`);
  if (techStack.length) bodyLines.push(`- **Stack**: ${techStack.join(', ')}`);
  if (lastCommit) bodyLines.push(`- **Last commit**: ${lastCommit}`);
  bodyLines.push(`- **CLAUDE.md**: ${hasClaudeMd ? 'yes' : 'no'}`);
  const body = bodyLines.join('\n');

  const meta = {
    path: projectPath,
    ...(repoUrl ? { repo_url: repoUrl } : {}),
    ...(techStack.length ? { tech_stack: techStack } : {}),
    has_claude_md: hasClaudeMd,
  };

  const projectResult = await captureAndIndex(ctx, {
    kind: 'project',
    title: projectName,
    body,
    tags: allTags,
    identity_key: identityKey,
    meta,
  });

  const bucketExists = db
    .prepare("SELECT 1 FROM vault WHERE kind = 'bucket' AND identity_key = ? LIMIT 1")
    .get(bucketTag);

  let bucketResult = null;
  if (!bucketExists) {
    bucketResult = await captureAndIndex(ctx, {
      kind: 'bucket',
      title: projectName,
      body: `Bucket for project: ${projectName}`,
      tags: allTags,
      identity_key: bucketTag,
      meta: { project_path: projectPath },
    });
  }

  db.close();

  const relPath = projectResult.filePath.replace(config.vaultDir + '/', '');
  console.log(`\n  ${green('✓')} Project → ${relPath}`);
  console.log(`    id: ${projectResult.id}`);
  console.log(`    tags: ${allTags.join(', ')}`);
  if (techStack.length) console.log(`    stack: ${techStack.join(', ')}`);
  if (repoUrl) console.log(`    repo: ${repoUrl}`);
  if (bucketResult) {
    const bRelPath = bucketResult.filePath.replace(config.vaultDir + '/', '');
    console.log(`\n  ${green('✓')} Bucket → ${bRelPath}`);
    console.log(`    id: ${bucketResult.id}`);
  } else {
    console.log(`\n    ${dim(`(bucket '${bucketTag}' already exists — skipped)`)}`);
  }
  console.log();
}

async function runRecall() {
  let query;

  if (!process.stdin.isTTY) {
    const raw = await new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', (chunk) => (data += chunk));
      process.stdin.on('end', () => resolve(data));
    });
    try {
      const payload = JSON.parse(raw);
      query = payload.prompt || payload.query || '';
    } catch {
      query = args[1] || raw.trim();
    }
  } else {
    query = args.slice(1).join(' ');
  }

  if (!query?.trim()) return;

  let db;
  try {
    const { resolveConfig } = await import('@context-vault/core/config');
    const config = resolveConfig();

    if (!config.vaultDirExists) return;

    const { initDatabase, prepareStatements } = await import('@context-vault/core/db');
    const { embed } = await import('@context-vault/core/embed');
    const { hybridSearch } = await import('@context-vault/core/search');

    db = await initDatabase(config.dbPath);
    const stmts = prepareStatements(db);
    const ctx = { db, config, stmts, embed };

    const { categoryFor } = await import('@context-vault/core/categories');
    const recall = config.recall;

    const results = await hybridSearch(ctx, query, {
      limit: recall.maxResults,
    });
    if (!results.length) return;

    const entries = [];
    let totalChars = 0;

    for (const r of results) {
      if (r.score != null && r.score < recall.minRelevanceScore) continue;
      const kind = r.kind || 'knowledge';
      if (recall.excludeKinds.includes(kind)) continue;
      if (recall.excludeCategories.includes(categoryFor(kind))) continue;
      if (r.tier === 'ephemeral') continue;
      const entryTags = r.tags ? JSON.parse(r.tags) : [];
      const tagsAttr = entryTags.length ? ` tags="${entryTags.join(',')}"` : '';
      const body = r.body?.slice(0, recall.bodyTruncateChars) ?? '';
      const entry = `<entry kind="${kind}"${tagsAttr}>\n${body}\n</entry>`;
      if (totalChars + entry.length > recall.maxOutputBytes) break;
      entries.push(entry);
      totalChars += entry.length;
    }

    if (!entries.length) return;

    const block = `<context-vault>\n${entries.join('\n')}\n</context-vault>\n`;
    process.stdout.write(block);
  } catch {
    // fail silently — never interrupt the user's workflow
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function runFlush() {
  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase } = await import('@context-vault/core/db');

  let db;
  try {
    const config = resolveConfig();
    db = await initDatabase(config.dbPath);

    const { c: entryCount } = db.prepare('SELECT COUNT(*) as c FROM vault').get();

    const lastSaveRow = db
      .prepare('SELECT MAX(COALESCE(updated_at, created_at)) as ts FROM vault')
      .get();
    const lastSave = lastSaveRow?.ts ?? 'n/a';

    console.log(
      `context-vault ok — ${entryCount} ${entryCount === 1 ? 'entry' : 'entries'}, last save: ${lastSave}`
    );
  } catch (e) {
    console.error(red(`context-vault flush failed: ${e.message}`));
    process.exit(1);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function runSessionCapture() {
  let db;
  try {
    const raw = await new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', (chunk) => (data += chunk));
      process.stdin.on('end', () => resolve(data));
    });
    if (!raw.trim()) return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const { kind, title, body, tags, source } = payload;
    if (!kind || !body) return;
    const { resolveConfig } = await import('@context-vault/core/config');
    const config = resolveConfig();
    if (!config.vaultDirExists) return;
    const { initDatabase, prepareStatements, insertVec, deleteVec } =
      await import('@context-vault/core/db');
    const { embed } = await import('@context-vault/core/embed');
    const { captureAndIndex } = await import('@context-vault/core/capture');
    db = await initDatabase(config.dbPath);
    const stmts = prepareStatements(db);
    const ctx = {
      db,
      config,
      stmts,
      embed,
      insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
      deleteVec: (rowid) => deleteVec(stmts, rowid),
    };
    const entry = await captureAndIndex(ctx, {
      kind,
      title: title || 'Session summary',
      body,
      tags: tags || ['session', 'auto-captured'],
      source: source || 'session-end-hook',
    });
    console.log(`context-vault session captured — id: ${entry.id}`);
  } catch {
    // fail silently — never block session end
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function runSessionEnd() {
  let db;
  try {
    const raw = await new Promise((resolve) => {
      let data = '';
      process.stdin.on('data', (chunk) => (data += chunk));
      process.stdin.on('end', () => resolve(data));
    });
    if (!raw.trim()) return;
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return;
    }
    const { session_id, transcript_path, cwd } = input ?? {};
    if (!transcript_path || !cwd) return;

    // Read transcript (JSONL)
    let turns = [];
    try {
      const transcriptRaw = readFileSync(transcript_path, 'utf-8');
      for (const line of transcriptRaw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          turns.push(JSON.parse(trimmed));
        } catch {}
      }
    } catch {
      return;
    }

    const extractText = (turn) => {
      if (typeof turn.content === 'string') return turn.content;
      if (Array.isArray(turn.content))
        return turn.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join(' ');
      return '';
    };

    const userTurns = turns.filter((t) => t.role === 'user');
    if (userTurns.length === 0) return;

    // Tool use blocks
    const allToolUse = [];
    for (const turn of turns) {
      if (!Array.isArray(turn.content)) continue;
      for (const block of turn.content) {
        if (block.type === 'tool_use') allToolUse.push(block);
      }
    }

    // Files modified
    const seenFiles = new Set();
    const filesModified = [];
    for (const block of allToolUse) {
      if (block.name === 'Write' || block.name === 'Edit') {
        const path = block.input?.file_path ?? block.input?.path ?? null;
        if (path && !seenFiles.has(path)) {
          seenFiles.add(path);
          filesModified.push(path);
        }
      }
    }

    // Commands run
    const commandsRun = [];
    for (const block of allToolUse) {
      if (block.name === 'Bash') {
        const cmd = block.input?.command ?? block.input?.cmd ?? null;
        if (cmd) commandsRun.push(cmd.slice(0, 100));
      }
    }

    // Tool counts
    const toolCounts = {};
    for (const block of allToolUse) {
      const name = block.name ?? 'unknown';
      toolCounts[name] = (toolCounts[name] ?? 0) + 1;
    }
    const toolSummary = Object.entries(toolCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name}: ${count}`)
      .join(', ');

    // Duration
    let durationStr = null;
    const timestampedTurns = turns.filter((t) => t.timestamp != null);
    if (timestampedTurns.length >= 2) {
      const diffMs =
        new Date(timestampedTurns[timestampedTurns.length - 1].timestamp) -
        new Date(timestampedTurns[0].timestamp);
      if (!isNaN(diffMs) && diffMs >= 0) {
        const totalSec = Math.round(diffMs / 1000);
        const hours = Math.floor(totalSec / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;
        durationStr =
          hours > 0
            ? `${hours}h ${minutes}m`
            : minutes > 0
              ? `${minutes}m ${seconds}s`
              : `${seconds}s`;
      }
    }

    const message_count = userTurns.length;
    const project = cwd.split('/').pop() || 'unknown';
    const first_prompt = extractText(userTurns[0]).slice(0, 200);
    const last_prompt =
      message_count > 1 ? extractText(userTurns[message_count - 1]).slice(0, 200) : first_prompt;

    // Build body
    const durationPart = durationStr ? `, ~${durationStr}` : '';
    const bodyLines = [
      `Session in ${project} (${message_count} exchange${message_count !== 1 ? 's' : ''}${durationPart}).`,
      '',
      '## What was done',
      `Opened with: ${first_prompt}`,
      '',
      `Closed with: ${last_prompt}`,
    ];
    const limitedFiles = filesModified.slice(0, 20);
    if (limitedFiles.length > 0) {
      bodyLines.push('', '## Files modified');
      for (const f of limitedFiles) bodyLines.push(`- ${f}`);
      if (filesModified.length > 20) bodyLines.push(`- ... and ${filesModified.length - 20} more`);
    }
    const limitedCmds = commandsRun.slice(0, 10);
    if (limitedCmds.length > 0) {
      bodyLines.push('', '## Key commands');
      for (const c of limitedCmds) bodyLines.push(`- ${c}`);
      if (commandsRun.length > 10) bodyLines.push(`- ... and ${commandsRun.length - 10} more`);
    }
    if (toolSummary) bodyLines.push('', '## Tools used', toolSummary);
    const body = bodyLines.join('\n');

    // Save via core APIs
    const { resolveConfig } = await import('@context-vault/core/config');
    const config = resolveConfig();
    if (!config.vaultDirExists) return;
    const { initDatabase, prepareStatements, insertVec, deleteVec } =
      await import('@context-vault/core/db');
    const { captureAndIndex } = await import('@context-vault/core/capture');
    db = await initDatabase(config.dbPath);
    const stmts = prepareStatements(db);
    const ctx = {
      db,
      config,
      stmts,
      embed: async () => null,
      insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
      deleteVec: (rowid) => deleteVec(stmts, rowid),
    };
    const entry = await captureAndIndex(ctx, {
      kind: 'session',
      title: `Session — ${project} ${new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      body,
      tags: ['session-end', 'session-summary', project],
      source: 'claude-code',
      meta: { session_id: session_id ?? null, cwd, message_count },
    });
    console.log(`context-vault session captured — id: ${entry.id}`);
  } catch {
    // fail silently — never block session end
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function runPostToolCall() {
  // Removed in v3 — post-tool-call hooks are no longer supported
}

async function runSave() {
  const kind = getFlag('--kind');
  const title = getFlag('--title');
  const tags = getFlag('--tags');
  const source = getFlag('--source') || 'cli';
  const tier = getFlag('--tier');
  const filePath = getFlag('--file');
  const bodyFlag = getFlag('--body');
  const identityKey = getFlag('--identity-key');
  const metaRaw = getFlag('--meta');

  if (!kind) {
    console.error(red('Error: --kind is required'));
    process.exit(1);
  }
  if (!title) {
    console.error(red('Error: --title is required'));
    process.exit(1);
  }

  let meta;
  if (metaRaw) {
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      console.error(red('Error: --meta must be valid JSON'));
      process.exit(1);
    }
  }

  let body;
  if (bodyFlag) {
    body = bodyFlag;
  } else if (filePath) {
    body = readFileSync(resolve(filePath), 'utf-8');
  } else if (!process.stdin.isTTY) {
    body = await new Promise((res) => {
      let data = '';
      process.stdin.on('data', (chunk) => (data += chunk));
      process.stdin.on('end', () => res(data));
    });
  }

  if (!body?.trim()) {
    console.error(red('Error: no content provided (use --body, --file, or pipe stdin)'));
    process.exit(1);
  }

  let db;
  try {
    const { resolveConfig } = await import('@context-vault/core/config');
    const config = resolveConfig();
    if (!config.vaultDirExists) {
      console.error(red('Error: vault not initialised — run `context-vault setup` first'));
      process.exit(1);
    }
    const { initDatabase, prepareStatements, insertVec, deleteVec } =
      await import('@context-vault/core/db');
    const { embed } = await import('@context-vault/core/embed');
    const { captureAndIndex } = await import('@context-vault/core/capture');
    db = await initDatabase(config.dbPath);
    const stmts = prepareStatements(db);
    const ctx = {
      db,
      config,
      stmts,
      embed,
      insertVec: (rowid, embedding) => insertVec(stmts, rowid, embedding),
      deleteVec: (rowid) => deleteVec(stmts, rowid),
    };
    const parsedTags = tags
      ? tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const entry = await captureAndIndex(ctx, {
      kind,
      title,
      body: body.trim(),
      tags: parsedTags,
      source,
      ...(tier ? { tier } : {}),
      ...(identityKey ? { identity_key: identityKey } : {}),
      ...(meta !== undefined ? { meta } : {}),
    });
    console.log(`${green('✓')} Saved ${kind} — id: ${entry.id}`);
  } catch (e) {
    console.error(`${red('x')} Failed to save: ${e.message}`);
    process.exit(1);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

async function runSearch() {
  const kind = getFlag('--kind');
  const tagsStr = getFlag('--tags');
  const limit = parseInt(getFlag('--limit') || '10', 10);
  const sort = getFlag('--sort') || 'relevance';
  const format = getFlag('--format') || 'plain';
  const showFull = flags.has('--full');
  const scopeArg = getFlag('--scope'); // "hot" | "events" | "all"

  const valuedFlags = new Set(['--kind', '--tags', '--limit', '--sort', '--format', '--scope']);

  const queryParts = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (valuedFlags.has(args[i])) i++;
      continue;
    }
    queryParts.push(args[i]);
  }
  const query = queryParts.join(' ');

  if (!query && sort === 'relevance' && !kind && !tagsStr) {
    console.error(red('Error: provide a search query or use --kind/--tags to browse'));
    process.exit(1);
  }

  let db;
  try {
    const { resolveConfig } = await import('@context-vault/core/config');
    const config = resolveConfig();
    if (!config.vaultDirExists) {
      console.error(red('No vault found. Run: context-vault setup'));
      process.exit(1);
    }

    const { initDatabase, prepareStatements } = await import('@context-vault/core/db');
    const { embed } = await import('@context-vault/core/embed');
    const { hybridSearch } = await import('@context-vault/core/search');

    db = await initDatabase(config.dbPath);
    const stmts = prepareStatements(db);
    const ctx = { db, config, stmts, embed };

    let results;

    // Resolve scope → category/exclude filter
    const validScopes = new Set(['hot', 'events', 'all']);
    const resolvedScope = validScopes.has(scopeArg) ? scopeArg : 'hot';
    const scopeCategoryFilter = resolvedScope === 'events' ? 'event' : null;
    const scopeExcludeEvents = resolvedScope === 'hot';

    if (query) {
      results = await hybridSearch(ctx, query, {
        limit: limit * 2,
        categoryFilter: scopeCategoryFilter,
        excludeEvents: scopeExcludeEvents,
      });

      if (kind) {
        results = results.filter((r) => r.kind === kind);
      }
    } else {
      let sql =
        'SELECT id, kind, category, title, body, tags, created_at, updated_at FROM vault WHERE superseded_by IS NULL';
      const params = [];
      if (kind) {
        sql += ' AND kind = ?';
        params.push(kind);
      }
      if (scopeCategoryFilter) {
        sql += ' AND category = ?';
        params.push(scopeCategoryFilter);
      }
      sql += ' ORDER BY COALESCE(updated_at, created_at) DESC LIMIT ?';
      params.push(limit);
      results = db.prepare(sql).all(...params);
    }

    if (tagsStr) {
      const filterTags = tagsStr.split(',').map((t) => t.trim().toLowerCase());
      results = results.filter((r) => {
        const entryTags = r.tags ? JSON.parse(r.tags).map((t) => t.toLowerCase()) : [];
        return filterTags.some((ft) => entryTags.includes(ft));
      });
    }

    results = results.slice(0, limit);

    if (results.length === 0) {
      console.log(dim('No results found.'));
      return;
    }

    if (format === 'json') {
      const output = results.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        tags: r.tags ? JSON.parse(r.tags) : [],
        score: r.score ?? null,
        created_at: r.created_at,
        updated_at: r.updated_at,
        body: showFull ? r.body : r.body?.slice(0, 200) || '',
      }));
      console.log(JSON.stringify(output, null, 2));
    } else if (format === 'table') {
      const header = `${'ID'.padEnd(28)} ${'Kind'.padEnd(12)} ${'Title'.padEnd(40)} ${'Score'.padEnd(6)}`;
      console.log(bold(header));
      console.log('-'.repeat(header.length));
      for (const r of results) {
        const score = r.score != null ? r.score.toFixed(2) : '—';
        const title = (r.title || '').slice(0, 38).padEnd(40);
        console.log(
          `${(r.id || '').slice(0, 26).padEnd(28)} ${(r.kind || '').padEnd(12)} ${title} ${score}`
        );
      }
      console.log(dim(`\n${results.length} result${results.length !== 1 ? 's' : ''}`));
    } else {
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const entryTags = r.tags ? JSON.parse(r.tags) : [];
        const score = r.score != null ? ` (${r.score.toFixed(2)})` : '';
        console.log(`${bold(`${i + 1}. ${r.title || '(untitled)'}`)}${dim(score)}`);
        console.log(
          `   ${dim(`${r.kind || 'knowledge'} · ${entryTags.join(', ') || 'no tags'} · ${r.id || ''}`)}`
        );
        if (showFull) {
          console.log(`   ${r.body || ''}`);
        } else {
          const preview = (r.body || '').slice(0, 150).replace(/\n/g, ' ');
          if (preview) console.log(`   ${dim(preview + (r.body?.length > 150 ? '...' : ''))}`);
        }
        if (i < results.length - 1) console.log();
      }
      console.log(dim(`\n${results.length} result${results.length !== 1 ? 's' : ''}`));
    }
  } catch (e) {
    console.error(red(`Search failed: ${e.message}`));
    process.exit(1);
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

/**
 * Copies all skills from the bundled assets/skills/ directory into ~/.claude/skills/.
 * Returns an array of installed skill names.
 */
function installSkills() {
  const assetsSkillsDir = join(ROOT, 'assets', 'skills');
  const targetDir = join(HOME, '.claude', 'skills');

  if (!existsSync(assetsSkillsDir)) return [];

  const skillNames = readdirSync(assetsSkillsDir).filter((name) => {
    try {
      return statSync(join(assetsSkillsDir, name)).isDirectory();
    } catch {
      return false;
    }
  });

  const installed = [];
  for (const skillName of skillNames) {
    const srcDir = join(assetsSkillsDir, skillName);
    const destDir = join(targetDir, skillName);
    mkdirSync(destDir, { recursive: true });
    const files = readdirSync(srcDir);
    for (const file of files) {
      copyFileSync(join(srcDir, file), join(destDir, file));
    }
    installed.push(skillName);
  }
  return installed;
}

/** Returns the path to Claude Code's global settings.json */
function claudeSettingsPath() {
  return join(HOME, '.claude', 'settings.json');
}

/**
 * Writes a UserPromptSubmit hook entry for context-vault recall to ~/.claude/settings.json.
 * Returns true if installed, false if already present.
 */
function installClaudeHook() {
  const settingsPath = claudeSettingsPath();
  let settings = {};

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf-8');
    try {
      settings = JSON.parse(raw);
    } catch {
      const bak = settingsPath + '.bak';
      copyFileSync(settingsPath, bak);
      console.log(yellow(`  Backed up corrupted settings to ${bak}`));
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];

  const alreadyInstalled = settings.hooks.UserPromptSubmit.some((h) =>
    h.hooks?.some((hh) => hh.command?.includes('context-vault recall'))
  );
  if (alreadyInstalled) return false;

  settings.hooks.UserPromptSubmit.push({
    hooks: [
      {
        type: 'command',
        command: 'context-vault recall',
        timeout: 10,
      },
    ],
  });

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

/**
 * Writes a SessionEnd hook entry for context-vault flush to ~/.claude/settings.json.
 * Returns true if installed, false if already present.
 */
function installSessionEndHook() {
  const settingsPath = claudeSettingsPath();
  let settings = {};

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf-8');
    try {
      settings = JSON.parse(raw);
    } catch {
      const bak = settingsPath + '.bak';
      copyFileSync(settingsPath, bak);
      console.log(yellow(`  Backed up corrupted settings to ${bak}`));
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionEnd) settings.hooks.SessionEnd = [];

  const alreadyInstalled = settings.hooks.SessionEnd.some((h) =>
    h.hooks?.some((hh) => hh.command?.includes('context-vault flush'))
  );
  if (alreadyInstalled) return false;

  settings.hooks.SessionEnd.push({
    hooks: [
      {
        type: 'command',
        command: 'npx context-vault flush',
        timeout: 10,
      },
    ],
  });

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

/**
 * Removes the context-vault flush SessionEnd hook from ~/.claude/settings.json.
 * Returns true if removed, false if not found.
 */
function removeSessionEndHook() {
  const settingsPath = claudeSettingsPath();
  if (!existsSync(settingsPath)) return false;

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    return false;
  }

  if (!settings.hooks?.SessionEnd) return false;

  const before = settings.hooks.SessionEnd.length;
  settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
    (h) => !h.hooks?.some((hh) => hh.command?.includes('context-vault flush'))
  );

  if (settings.hooks.SessionEnd.length === before) return false;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

/**
 * Removes the context-vault recall hook from ~/.claude/settings.json.
 * Returns true if removed, false if not found.
 */
function removeClaudeHook() {
  const settingsPath = claudeSettingsPath();
  if (!existsSync(settingsPath)) return false;

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    return false;
  }

  if (!settings.hooks?.UserPromptSubmit) return false;

  const before = settings.hooks.UserPromptSubmit.length;
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
    (h) => !h.hooks?.some((hh) => hh.command?.includes('context-vault recall'))
  );

  if (settings.hooks.UserPromptSubmit.length === before) return false;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

/**
 * Writes a SessionEnd hook entry for session capture to ~/.claude/settings.json.
 * Returns true if installed, false if already present.
 */
function installSessionCaptureHook() {
  const settingsPath = claudeSettingsPath();
  let settings = {};

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf-8');
    try {
      settings = JSON.parse(raw);
    } catch {
      const bak = settingsPath + '.bak';
      copyFileSync(settingsPath, bak);
      console.log(yellow(`  Backed up corrupted settings to ${bak}`));
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.SessionEnd) settings.hooks.SessionEnd = [];

  const newCommand = 'context-vault session-end';

  // Check if already installed with new CLI-based command
  const alreadyInstalled = settings.hooks.SessionEnd.some((h) =>
    h.hooks?.some((hh) => hh.command?.includes(newCommand))
  );
  if (alreadyInstalled) return false;

  // Migrate: remove stale absolute-path hooks (node <path>/session-end.mjs)
  const hadStale = settings.hooks.SessionEnd.some((h) =>
    h.hooks?.some((hh) => hh.command?.includes('session-end.mjs'))
  );
  if (hadStale) {
    settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
      (h) => !h.hooks?.some((hh) => hh.command?.includes('session-end.mjs'))
    );
  }

  settings.hooks.SessionEnd.push({
    hooks: [
      {
        type: 'command',
        command: newCommand,
        timeout: 30,
      },
    ],
  });

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

/**
 * Removes the session capture SessionEnd hook from ~/.claude/settings.json.
 * Returns true if removed, false if not found.
 */
function removeSessionCaptureHook() {
  const settingsPath = claudeSettingsPath();
  if (!existsSync(settingsPath)) return false;

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    return false;
  }

  if (!settings.hooks?.SessionEnd) return false;

  const before = settings.hooks.SessionEnd.length;
  settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
    (h) =>
      !h.hooks?.some(
        (hh) =>
          hh.command?.includes('session-end.mjs') ||
          hh.command?.includes('context-vault session-end')
      )
  );

  if (settings.hooks.SessionEnd.length === before) return false;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

/**
 * Writes a PostToolCall hook entry for passive auto-capture to ~/.claude/settings.json.
 * Returns true if installed, false if already present.
 */
function installPostToolCallHook() {
  const settingsPath = claudeSettingsPath();
  let settings = {};

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, 'utf-8');
    try {
      settings = JSON.parse(raw);
    } catch {
      const bak = settingsPath + '.bak';
      copyFileSync(settingsPath, bak);
      console.log(yellow(`  Backed up corrupted settings to ${bak}`));
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PostToolCall) settings.hooks.PostToolCall = [];

  const newCommand = 'context-vault post-tool-call';

  // Check if already installed with new CLI-based command
  const alreadyInstalled = settings.hooks.PostToolCall.some((h) =>
    h.hooks?.some((hh) => hh.command?.includes(newCommand))
  );
  if (alreadyInstalled) return false;

  // Migrate: remove stale absolute-path hooks (node <path>/post-tool-call.mjs)
  const hadStale = settings.hooks.PostToolCall.some((h) =>
    h.hooks?.some((hh) => hh.command?.includes('post-tool-call.mjs'))
  );
  if (hadStale) {
    settings.hooks.PostToolCall = settings.hooks.PostToolCall.filter(
      (h) => !h.hooks?.some((hh) => hh.command?.includes('post-tool-call.mjs'))
    );
  }

  settings.hooks.PostToolCall.push({
    hooks: [
      {
        type: 'command',
        command: newCommand,
        timeout: 5,
      },
    ],
  });

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

/**
 * Removes the PostToolCall auto-capture hook from ~/.claude/settings.json.
 * Returns true if removed, false if not found.
 */
function removePostToolCallHook() {
  const settingsPath = claudeSettingsPath();
  if (!existsSync(settingsPath)) return false;

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch {
    return false;
  }

  if (!settings.hooks?.PostToolCall) return false;

  const before = settings.hooks.PostToolCall.length;
  settings.hooks.PostToolCall = settings.hooks.PostToolCall.filter(
    (h) =>
      !h.hooks?.some(
        (hh) =>
          hh.command?.includes('post-tool-call.mjs') ||
          hh.command?.includes('context-vault post-tool-call')
      )
  );

  if (settings.hooks.PostToolCall.length === before) return false;

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  return true;
}

async function runSkills() {
  const sub = args[1];

  if (sub === 'install') {
    console.log();
    try {
      const names = installSkills();
      if (names.length === 0) {
        console.log(`  ${yellow('!')} No bundled skills found.\n`);
      } else {
        for (const name of names) {
          console.log(`  ${green('+')} ${name} — installed to ~/.claude/skills/${name}/`);
        }
        console.log();
        console.log(dim('  Skills are active immediately in Claude Code.'));
        console.log(dim(`  Trigger with: /${names.join(', /')}`));
      }
    } catch (e) {
      console.error(`  ${red('x')} Skills install failed: ${e.message}\n`);
      process.exit(1);
    }
    console.log();
  } else {
    console.log(`
  ${bold('context-vault skills')} <install>

  Manage bundled Claude Code skills.

${bold('Commands:')}
  ${cyan('skills install')}   Copy bundled skills into ~/.claude/skills/

${bold('Bundled skills:')}
  ${cyan('compile-context')}  Compile vault entries into a project brief using create_snapshot
`);
  }
}

async function runHooksInstall() {
  try {
    const installed = installClaudeHook();
    if (installed) {
      console.log(
        `\n  ${green('✓')} Hook installed. Context vault will inject relevant entries on every prompt.\n`
      );
      console.log(dim('  On every prompt, context-vault searches your vault for relevant entries'));
      console.log(
        dim('  and injects them as a <context-vault> block before Claude sees your message.')
      );
      console.log(dim(`\n  To remove: ${cyan('context-vault hooks uninstall')}`));
    } else {
      console.log(`\n  ${yellow('!')} Hook already installed.\n`);
    }
  } catch (e) {
    console.error(`\n  ${red('x')} Failed to install hook: ${e.message}\n`);
    process.exit(1);
  }
  console.log();

  const installCapture =
    flags.has('--session-capture') ||
    (await prompt(
      '  Install SessionEnd capture hook? (auto-saves session summaries to vault) (Y/n):',
      'Y'
    ));
  const shouldInstallCapture =
    installCapture === true ||
    (typeof installCapture === 'string' && !installCapture.toLowerCase().startsWith('n'));

  if (shouldInstallCapture) {
    try {
      const captureInstalled = installSessionCaptureHook();
      if (captureInstalled) {
        console.log(`\n  ${green('✓')} SessionEnd capture hook installed.\n`);
        console.log(dim('  At the end of each session, context-vault will save a session summary'));
        console.log(dim('  including files touched, tools used, and searches performed.'));
        console.log(dim(`\n  To remove: ${cyan('context-vault hooks uninstall')}`));
      } else {
        console.log(`\n  ${yellow('!')} SessionEnd capture hook already installed.\n`);
      }
    } catch (e) {
      console.error(`\n  ${red('x')} Failed to install session capture hook: ${e.message}\n`);
      process.exit(1);
    }
    console.log();
  }

  const installFlush =
    flags.has('--flush') ||
    (await prompt(
      '  Install SessionEnd flush hook? (saves vault health summary at session end) (y/N):',
      'n'
    ));
  const shouldInstallFlush =
    installFlush === true ||
    (typeof installFlush === 'string' && installFlush.toLowerCase().startsWith('y'));

  if (shouldInstallFlush) {
    try {
      const flushInstalled = installSessionEndHook();
      if (flushInstalled) {
        console.log(`\n  ${green('✓')} SessionEnd flush hook installed.\n`);
        console.log(
          dim('  At the end of each session, context-vault flush confirms the vault is healthy.')
        );
      } else {
        console.log(`\n  ${yellow('!')} SessionEnd flush hook already installed.\n`);
      }
    } catch (e) {
      console.error(`\n  ${red('x')} Failed to install session flush hook: ${e.message}\n`);
      process.exit(1);
    }
    console.log();
  }

  const installAutoCapture =
    flags.has('--auto-capture') ||
    (await prompt(
      '  Install PostToolCall auto-capture hook? (passively logs tool calls for richer session summaries) (Y/n):',
      'Y'
    ));
  const shouldInstallAutoCapture =
    installAutoCapture === true ||
    (typeof installAutoCapture === 'string' && !installAutoCapture.toLowerCase().startsWith('n'));

  if (shouldInstallAutoCapture) {
    try {
      const autoCaptureInstalled = installPostToolCallHook();
      if (autoCaptureInstalled) {
        console.log(`\n  ${green('✓')} PostToolCall auto-capture hook installed.\n`);
        console.log(
          dim('  After every tool call, context-vault logs the tool name and file paths.')
        );
        console.log(dim('  Session summaries will use this log as the primary data source.'));
        console.log(dim(`\n  To remove: ${cyan('context-vault hooks uninstall')}`));
      } else {
        console.log(`\n  ${yellow('!')} PostToolCall auto-capture hook already installed.\n`);
      }
    } catch (e) {
      console.error(`\n  ${red('x')} Failed to install auto-capture hook: ${e.message}\n`);
      process.exit(1);
    }
    console.log();
  }
}

async function runHooksUninstall() {
  try {
    const removed = removeClaudeHook();
    if (removed) {
      console.log(`\n  ${green('✓')} Claude Code memory hook removed.\n`);
    } else {
      console.log(`\n  ${yellow('!')} Hook not found — nothing to remove.\n`);
    }
  } catch (e) {
    console.error(`\n  ${red('x')} Failed to remove hook: ${e.message}\n`);
    process.exit(1);
  }

  try {
    const captureRemoved = removeSessionCaptureHook();
    if (captureRemoved) {
      console.log(`\n  ${green('✓')} SessionEnd capture hook removed.\n`);
    }
  } catch (e) {
    console.error(`\n  ${red('x')} Failed to remove session capture hook: ${e.message}\n`);
  }

  try {
    const flushRemoved = removeSessionEndHook();
    if (flushRemoved) {
      console.log(`\n  ${green('✓')} SessionEnd flush hook removed.\n`);
    }
  } catch (e) {
    console.error(`\n  ${red('x')} Failed to remove session flush hook: ${e.message}\n`);
  }

  try {
    const autoCaptureRemoved = removePostToolCallHook();
    if (autoCaptureRemoved) {
      console.log(`\n  ${green('✓')} PostToolCall auto-capture hook removed.\n`);
    }
  } catch (e) {
    console.error(`\n  ${red('x')} Failed to remove auto-capture hook: ${e.message}\n`);
  }
}

async function runHooks() {
  const sub = args[1];

  if (sub === 'install') {
    await runHooksInstall();
  } else if (sub === 'remove' || sub === 'uninstall') {
    await runHooksUninstall();
  } else {
    console.log(`
  ${bold('context-vault hooks')} <install|uninstall>

  Manage the Claude Code memory hook integration.
  When installed, context-vault automatically searches your vault on every user
  prompt and injects relevant entries as a <context-vault> XML block.

${bold('Commands:')}
  ${cyan('hooks install')}     Write UserPromptSubmit hook to ~/.claude/settings.json
                    Also prompts to install SessionEnd capture and flush hooks
  ${cyan('hooks uninstall')}   Remove the recall hook, SessionEnd capture hook, and flush hook
`);
  }
}

async function runClaude() {
  const sub = args[1];

  if (sub === 'install') {
    await runHooksInstall();
  } else if (sub === 'uninstall' || sub === 'remove') {
    await runHooksUninstall();
  } else {
    console.log(`
  ${bold('context-vault claude')} <install|uninstall>

  Manage the Claude Code memory hook integration.
  Alias for ${cyan('context-vault hooks install|uninstall')}.

${bold('Commands:')}
  ${cyan('claude install')}     Write UserPromptSubmit hook to ~/.claude/settings.json
  ${cyan('claude uninstall')}   Remove the recall hook and SessionEnd flush hook
`);
  }
}

async function runDoctor() {
  const { resolveConfig } = await import('@context-vault/core/config');
  const { errorLogPath, errorLogCount } = await import('../dist/error-log.js');

  console.log();
  console.log(`  ${bold('◇ context-vault doctor')} ${dim(`v${VERSION}`)}`);
  console.log();

  let allOk = true;

  // ── Node.js version ──────────────────────────────────────────────────────
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 20) {
    console.log(`  ${red('✘')} Node.js ${process.versions.node} — requires >= 20`);
    console.log(`    ${dim('Fix: install a newer Node.js from https://nodejs.org/')}`);
    allOk = false;
  } else {
    console.log(`  ${green('✓')} Node.js ${process.versions.node} ${dim(`(${process.execPath})`)}`);
  }

  // ── Config ───────────────────────────────────────────────────────────────
  let config;
  try {
    config = resolveConfig();
    const configExists = existsSync(config.configPath);
    console.log(
      `  ${green('✓')} Config ${dim(`(${configExists ? 'exists' : 'using defaults'}: ${config.configPath})`)}`
    );
  } catch (e) {
    console.log(`  ${red('✘')} Config parse error: ${e.message}`);
    console.log(`    ${dim(`Fix: delete or repair ${join(HOME, '.context-mcp', 'config.json')}`)}`);
    allOk = false;
  }

  if (config) {
    // ── Data dir ───────────────────────────────────────────────────────────
    if (existsSync(config.dataDir)) {
      console.log(`  ${green('✓')} Data dir ${dim(config.dataDir)}`);
    } else {
      console.log(`  ${yellow('!')} Data dir missing — will be created on next start`);
      console.log(`    ${dim(`mkdir -p "${config.dataDir}"`)}`);
    }

    // ── Vault dir ─────────────────────────────────────────────────────────
    if (existsSync(config.vaultDir)) {
      try {
        const probe = join(config.vaultDir, '.write-probe');
        writeFileSync(probe, '');
        unlinkSync(probe);
        console.log(`  ${green('✓')} Vault dir ${dim(config.vaultDir)}`);
      } catch {
        console.log(`  ${red('✘')} Vault dir not writable: ${config.vaultDir}`);
        console.log(`    ${dim(`Fix: chmod u+w "${config.vaultDir}"`)}`);
        allOk = false;
      }
    } else {
      console.log(`  ${yellow('!')} Vault dir missing — will be created on next start`);
      console.log(`    ${dim(`mkdir -p "${config.vaultDir}"`)}`);
    }

    // ── Database ──────────────────────────────────────────────────────────
    let db;
    if (existsSync(config.dbPath)) {
      try {
        const { initDatabase } = await import('@context-vault/core/db');
        db = await initDatabase(config.dbPath);
        const schemaRow = db.prepare('PRAGMA user_version').get();
        const schemaVersion = schemaRow?.user_version ?? 'unknown';
        console.log(
          `  ${green('✓')} Database ${dim(`${config.dbPath} (schema v${schemaVersion})`)}`
        );
      } catch (e) {
        console.log(`  ${red('✘')} Database error: ${e.message}`);
        console.log(
          `    ${dim(`Fix: rm "${config.dbPath}" and restart (will rebuild from vault files)`)}`
        );
        allOk = false;
      }
    } else {
      console.log(`  ${yellow('!')} Database missing — will be created on next start`);
    }

    // ── Embedding model ──────────────────────────────────────────────────
    try {
      const { embed } = await import('@context-vault/core/embed');
      const vec = await embed('doctor check');
      if (vec && vec.length > 0) {
        console.log(`  ${green('✓')} Embedding model ${dim(`(${vec.length} dimensions)`)}`);
      } else {
        console.log(
          `  ${yellow('!')} Embedding model unavailable — semantic search disabled (FTS-only)`
        );
        console.log(`    ${dim('Fix: run context-vault setup to download the model')}`);
      }
    } catch {
      console.log(
        `  ${yellow('!')} Embedding model unavailable — semantic search disabled (FTS-only)`
      );
      console.log(`    ${dim('Fix: run context-vault setup to download the model')}`);
    }

    // ── DB/filesystem consistency ─────────────────────────────────────────
    if (db && existsSync(config.vaultDir)) {
      try {
        const totalRow = db.prepare('SELECT COUNT(*) as c FROM vault').get();
        const total = totalRow?.c ?? 0;
        if (total > 0) {
          const sampleRows = db.prepare('SELECT file_path FROM vault LIMIT 50').all();
          let staleCount = 0;
          for (const row of sampleRows) {
            if (row.file_path && !existsSync(row.file_path)) {
              staleCount++;
            }
          }
          if (staleCount > 0) {
            const pct = Math.round((staleCount / sampleRows.length) * 100);
            console.log(
              `  ${yellow('!')} ${staleCount}/${sampleRows.length} sampled DB entries point to missing files (${pct}%)`
            );
            console.log(`    ${dim('Fix: run context-vault reindex to rebuild from vault files')}`);
            allOk = false;
          } else {
            console.log(
              `  ${green('✓')} DB/filesystem consistency ${dim(`(${total} entries, sample OK)`)}`
            );
          }
        }
      } catch {
        // non-critical — skip silently
      }
    }

    // ── Auto-captured feedback entries ─────────────────────────────────────
    if (db) {
      try {
        const feedbackRow = db
          .prepare(
            `SELECT COUNT(*) as c FROM vault WHERE kind = 'feedback' AND tags LIKE '%"auto-captured"%'`
          )
          .get();
        const feedbackCount = feedbackRow?.c ?? 0;
        if (feedbackCount > 0) {
          const recentRows = db
            .prepare(
              `SELECT title, created_at FROM vault WHERE kind = 'feedback' AND tags LIKE '%"auto-captured"%' ORDER BY created_at DESC LIMIT 3`
            )
            .all();
          console.log(
            `  ${yellow('!')} ${feedbackCount} auto-captured error${feedbackCount === 1 ? '' : 's'} in vault`
          );
          for (const row of recentRows) {
            console.log(`    ${dim(`${row.created_at} — ${row.title}`)}`);
          }
          console.log(
            `    ${dim('Review: context-vault search --kind feedback --tag auto-captured')}`
          );
        }
      } catch {
        // non-critical — skip silently
      }
    }

    // Close DB if opened
    try {
      db?.close();
    } catch {}

    // ── CLI binary ──────────────────────────────────────────────────────
    try {
      const binVersion = execSync('context-vault --version', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      console.log(`  ${green('✓')} CLI binary ${dim(`(${binVersion})`)}`);
    } catch {
      console.log(`  ${red('✘')} CLI binary not found in PATH`);
      console.log(`    ${dim('Fix: npm install -g context-vault')}`);
      allOk = false;
    }

    // Clean up legacy launcher if it exists
    const legacyLauncher = join(HOME, '.context-mcp', 'server.mjs');
    if (existsSync(legacyLauncher)) {
      try {
        unlinkSync(legacyLauncher);
        console.log(`  ${green('✓')} Removed legacy launcher ${dim(legacyLauncher)}`);
      } catch {}
    }

    // ── Error log ─────────────────────────────────────────────────────────
    const logPath = errorLogPath(config.dataDir);
    const logCount = errorLogCount(config.dataDir);
    if (logCount > 0) {
      console.log();
      console.log(
        `  ${yellow('!')} Error log has ${logCount} entr${logCount === 1 ? 'y' : 'ies'}: ${dim(logPath)}`
      );
      try {
        const lines = readFileSync(logPath, 'utf-8')
          .split('\n')
          .filter((l) => l.trim());
        const last = JSON.parse(lines[lines.length - 1]);
        console.log(`    Last error: ${red(last.message)}`);
        console.log(`    Phase: ${dim(last.phase || 'unknown')}  Time: ${dim(last.timestamp)}`);
      } catch {}
      console.log(`    ${dim(`To clear: rm "${logPath}"`)}`);
      allOk = false;
    } else {
      console.log(`  ${green('✓')} No startup errors logged`);
    }
  }

  // ── MCP tool configs ──────────────────────────────────────────────────────
  console.log();
  console.log(bold('  Tool Configurations'));
  let anyToolConfigured = false;

  const isStaleCmd = (cmd) => cmd !== 'context-vault' && cmd !== 'npx';

  // Check Claude Code
  const claudeConfigPath = join(HOME, '.claude.json');
  if (existsSync(claudeConfigPath)) {
    try {
      const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, 'utf-8'));
      const servers = claudeConfig?.mcpServers || {};
      if (servers['context-vault']) {
        const srv = servers['context-vault'];
        const cmd = [srv.command, ...(srv.args || [])].join(' ');
        if (isStaleCmd(srv.command)) {
          console.log(`  ${yellow('!')} Claude Code: ${dim(cmd)}`);
          console.log(`    ${dim('Fix: run context-vault setup to update')}`);
          allOk = false;
        } else {
          console.log(`  ${green('+')} Claude Code: ${dim(cmd)}`);
        }
        anyToolConfigured = true;
      } else {
        console.log(`  ${dim('-')} Claude Code: not configured`);
      }
    } catch {
      console.log(`  ${yellow('!')} Claude Code: could not read ~/.claude.json`);
    }
  } else {
    console.log(`  ${dim('-')} Claude Code: ~/.claude.json not found`);
  }

  // Check all JSON-configured tools
  for (const tool of TOOLS.filter((t) => t.configType === 'json')) {
    const cfgPath = tool.configPath;
    if (!cfgPath || !existsSync(cfgPath)) {
      continue; // tool not installed — skip silently
    }
    try {
      const toolConfig = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      const servers = toolConfig?.[tool.configKey] || {};
      if (servers['context-vault']) {
        const srv = servers['context-vault'];
        const cmd = [srv.command, ...(srv.args || [])].join(' ');
        if (isStaleCmd(srv.command)) {
          console.log(`  ${yellow('!')} ${tool.name}: ${dim(cmd)}`);
          console.log(`    ${dim('Fix: run context-vault setup to update')}`);
          allOk = false;
        } else {
          console.log(`  ${green('+')} ${tool.name}: ${dim(cmd)}`);
        }
        anyToolConfigured = true;
      } else if (servers['context-mcp']) {
        console.log(`  ${yellow('!')} ${tool.name}: using old name "context-mcp"`);
        console.log(`    ${dim('Fix: run context-vault setup to update')}`);
        anyToolConfigured = true;
      }
    } catch {
      // config exists but unreadable — skip
    }
  }

  // Check Codex
  try {
    const codexCheck = execSync('codex mcp list 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });
    if (codexCheck.includes('context-vault')) {
      console.log(`  ${green('+')} Codex: ${dim('configured')}`);
      anyToolConfigured = true;
    }
  } catch {
    // codex not installed or not configured — skip
  }

  if (!anyToolConfigured) {
    console.log(`  ${yellow('!')} No AI tools have context-vault configured`);
    console.log(`    ${dim('Fix: run context-vault setup')}`);
    allOk = false;
  }

  // ── Claude Code hooks ──────────────────────────────────────────────────────
  console.log();
  console.log(bold('  Claude Code Hooks'));
  const settingsPath = claudeSettingsPath();
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      const hooks = settings.hooks || {};
      let hookCount = 0;
      let staleHookCount = 0;

      // Check recall hook
      const recallHooks = (hooks.UserPromptSubmit || []).filter((h) =>
        h.hooks?.some((hh) => hh.command?.includes('context-vault recall'))
      );
      if (recallHooks.length > 0) {
        console.log(`  ${green('+')} Recall hook (UserPromptSubmit)`);
        hookCount++;
      }

      // Check session-end hooks
      const sessionHooks = (hooks.SessionEnd || []).filter((h) =>
        h.hooks?.some(
          (hh) =>
            hh.command?.includes('session-end.mjs') ||
            hh.command?.includes('context-vault session-end')
        )
      );
      if (sessionHooks.length > 0) {
        // Check if using stale absolute path
        const hasStale = sessionHooks.some((h) =>
          h.hooks?.some(
            (hh) =>
              hh.command?.includes('session-end.mjs') &&
              !hh.command?.includes('context-vault session-end')
          )
        );
        if (hasStale) {
          const cmd = sessionHooks[0]?.hooks?.[0]?.command || '';
          const pathMatch = cmd.match(/node\s+(.+session-end\.mjs)/);
          const hookPath = pathMatch ? pathMatch[1] : '';
          const pathExists = hookPath && existsSync(hookPath);
          if (!pathExists) {
            console.log(
              `  ${red('✘')} Session capture hook: stale path ${dim(hookPath || '(unknown)')}`
            );
            console.log(`    ${dim('Fix: run context-vault hooks install to update')}`);
            staleHookCount++;
            allOk = false;
          } else {
            console.log(`  ${yellow('!')} Session capture hook: uses absolute path (fragile)`);
            console.log(
              `    ${dim('Fix: run context-vault hooks install to update to CLI command')}`
            );
          }
        } else {
          console.log(`  ${green('+')} Session capture hook (SessionEnd)`);
        }
        hookCount++;
      }

      // Check flush hook
      const flushHooks = (hooks.SessionEnd || []).filter((h) =>
        h.hooks?.some((hh) => hh.command?.includes('context-vault flush'))
      );
      if (flushHooks.length > 0) {
        console.log(`  ${green('+')} Flush hook (SessionEnd)`);
        hookCount++;
      }

      // Check post-tool-call hooks
      const ptcHooks = (hooks.PostToolCall || []).filter((h) =>
        h.hooks?.some(
          (hh) =>
            hh.command?.includes('post-tool-call.mjs') ||
            hh.command?.includes('context-vault post-tool-call')
        )
      );
      if (ptcHooks.length > 0) {
        const hasStale = ptcHooks.some((h) =>
          h.hooks?.some(
            (hh) =>
              hh.command?.includes('post-tool-call.mjs') &&
              !hh.command?.includes('context-vault post-tool-call')
          )
        );
        if (hasStale) {
          const cmd = ptcHooks[0]?.hooks?.[0]?.command || '';
          const pathMatch = cmd.match(/node\s+(.+post-tool-call\.mjs)/);
          const hookPath = pathMatch ? pathMatch[1] : '';
          const pathExists = hookPath && existsSync(hookPath);
          if (!pathExists) {
            console.log(
              `  ${red('✘')} Auto-capture hook: stale path ${dim(hookPath || '(unknown)')}`
            );
            console.log(`    ${dim('Fix: run context-vault hooks install to update')}`);
            staleHookCount++;
            allOk = false;
          } else {
            console.log(`  ${yellow('!')} Auto-capture hook: uses absolute path (fragile)`);
            console.log(
              `    ${dim('Fix: run context-vault hooks install to update to CLI command')}`
            );
          }
        } else {
          console.log(`  ${green('+')} Auto-capture hook (PostToolCall)`);
        }
        hookCount++;
      }

      if (hookCount === 0) {
        console.log(`  ${dim('-')} No context-vault hooks installed`);
        console.log(`    ${dim('Optional: run context-vault hooks install')}`);
      }
    } catch {
      console.log(`  ${yellow('!')} Could not read ${settingsPath}`);
    }
  } else {
    console.log(`  ${dim('-')} No Claude Code settings found`);
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log();
  if (allOk) {
    console.log(
      `  ${green('All checks passed.')} If the MCP server still fails, try restarting your AI tool.`
    );
  } else {
    console.log(
      `  ${yellow('Some issues found.')} Address the items marked with ${red('✘')} above.`
    );
  }
  console.log();
}

async function runHealth() {
  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase, testConnection } = await import('@context-vault/core/db');

  let config;
  let healthy = true;
  const lines = [];

  try {
    config = resolveConfig();
  } catch (e) {
    console.log(red(`context-vault health — FAILED`));
    console.log(`  config: ${red(`cannot resolve (${e.message})`)}`);
    console.log(`  status: ${red('unhealthy')}`);
    process.exit(1);
  }

  const vaultOk = existsSync(config.vaultDir);
  const dbExists = existsSync(config.dbPath);

  lines.push(`  vault: ${config.vaultDir} ${vaultOk ? green('(exists)') : red('(missing!)')}`);

  if (!vaultOk) healthy = false;

  let db;
  let entryCount = null;
  let lastSave = null;
  let dbOk = false;

  if (dbExists) {
    try {
      db = await initDatabase(config.dbPath);
      dbOk = testConnection(db);
      if (dbOk) {
        const row = db.prepare('SELECT COUNT(*) as c FROM vault').get();
        entryCount = row.c;
        const lastRow = db
          .prepare('SELECT MAX(COALESCE(updated_at, created_at)) as ts FROM vault')
          .get();
        lastSave = lastRow?.ts ?? null;
      }
    } catch {
      dbOk = false;
    } finally {
      try {
        db?.close();
      } catch {}
    }
  }

  if (dbOk) {
    lines.push(
      `  database: ${config.dbPath} ${green(`(${entryCount} ${entryCount === 1 ? 'entry' : 'entries'})`)}`
    );
    lines.push(`  last save: ${lastSave ?? dim('n/a')}`);
  } else {
    healthy = false;
    lines.push(`  database: ${config.dbPath} ${red(dbExists ? '(cannot connect)' : '(missing!)')}`);
  }

  if (healthy) {
    console.log(green(`context-vault health — OK`));
  } else {
    console.log(red(`context-vault health — FAILED`));
  }

  for (const line of lines) {
    console.log(line);
  }

  console.log(`  status: ${healthy ? green('healthy') : red('unhealthy')}`);

  if (!healthy) process.exit(1);
}

async function runRestart() {
  const force = flags.has('--force');

  console.log();
  console.log(`  ${bold('◇ context-vault restart')}`);
  console.log();

  let psOutput;
  try {
    psOutput = execSync('ps aux', { encoding: 'utf-8', timeout: 5000 });
  } catch (e) {
    console.error(red(`  Failed to list processes: ${e.message}`));
    process.exit(1);
  }

  const currentPid = process.pid;
  const lines = psOutput.split('\n');

  const serverPids = [];
  for (const line of lines) {
    const match = line.match(/^\S+\s+(\d+)\s/);
    if (!match) continue;
    const pid = parseInt(match[1], 10);
    if (pid === currentPid) continue;
    if (
      /context-vault.*(serve|stdio|server\/index)/.test(line) ||
      /server\/index\.js.*context-vault/.test(line)
    ) {
      serverPids.push(pid);
    }
  }

  if (serverPids.length === 0) {
    console.log(dim('  No running context-vault MCP server processes found.'));
    console.log(dim('  The MCP client will start the server automatically on the next tool call.'));
    console.log();
    return;
  }

  console.log(
    `  Found ${serverPids.length} server process${serverPids.length === 1 ? '' : 'es'}: ${dim(serverPids.join(', '))}`
  );
  console.log();

  const signal = force ? 'SIGKILL' : 'SIGTERM';
  const killed = [];
  const failed = [];

  for (const pid of serverPids) {
    try {
      process.kill(pid, signal);
      killed.push(pid);
      console.log(`  ${green('✓')} Sent ${signal} to PID ${pid}`);
    } catch (e) {
      if (e.code === 'ESRCH') {
        console.log(`  ${dim('-')} PID ${pid} already gone`);
      } else {
        failed.push(pid);
        console.log(`  ${red('✘')} Failed to signal PID ${pid}: ${e.message}`);
      }
    }
  }

  if (!force && killed.length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    for (const pid of killed) {
      try {
        process.kill(pid, 0);
        console.log(`  ${yellow('!')} PID ${pid} still running — sending SIGKILL`);
        try {
          process.kill(pid, 'SIGKILL');
        } catch {}
      } catch {
        // process is gone — expected
      }
    }
  }

  console.log();

  if (failed.length > 0) {
    console.log(
      red(
        `  Could not stop ${failed.length} process${failed.length === 1 ? '' : 'es'}. Try --force.`
      )
    );
    process.exit(1);
  } else {
    console.log(
      green('  Server stopped.') +
        dim(' The MCP client will restart it automatically on the next tool call.')
    );
  }

  console.log();
}

async function runConsolidate() {
  const dryRun = flags.has('--dry-run');
  const tagArg = getFlag('--tag');

  const { resolveConfig } = await import('@context-vault/core/config');
  const { initDatabase } = await import('@context-vault/core/db');
  const { findHotTags, findColdEntries } = await import('../dist/consolidation.js');

  const config = resolveConfig();

  if (!config.vaultDirExists) {
    console.error(red('  No vault found. Run: context-vault setup'));
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);

  const { tagThreshold = 10, maxAgeDays = 7 } = config.consolidation ?? {};

  let hotTags;
  if (tagArg) {
    const rows = db
      .prepare(
        `SELECT COUNT(*) as c FROM vault
         WHERE superseded_by IS NULL
           AND tags LIKE ?`
      )
      .get(`%"${tagArg}"%`);
    const count = rows?.c ?? 0;
    const lastBrief = db
      .prepare(
        `SELECT created_at FROM vault
         WHERE kind = 'brief'
           AND tags LIKE ?
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(`%"${tagArg}"%`);
    let lastSnapshotAge = null;
    if (lastBrief) {
      const ms = Date.now() - new Date(lastBrief.created_at).getTime();
      lastSnapshotAge = Math.floor(ms / (1000 * 60 * 60 * 24));
    }
    hotTags = [{ tag: tagArg, entryCount: count, lastSnapshotAge }];
  } else {
    hotTags = findHotTags(db, { tagThreshold, maxSnapshotAgeDays: maxAgeDays });
  }

  const coldIds = findColdEntries(db, { maxAgeDays: 90, maxHitCount: 0 });

  db.close();

  console.log();
  console.log(`  ${bold('◇ context-vault consolidate')}`);
  console.log();

  if (hotTags.length === 0 && !tagArg) {
    console.log(
      dim(
        `  No hot tags found. (threshold: ${tagThreshold} entries, snapshot age: ${maxAgeDays} days)`
      )
    );
  } else {
    console.log(bold('  Hot tags') + dim(` (>= ${tagThreshold} entries, no recent snapshot)`));
    console.log();

    for (const { tag, entryCount, lastSnapshotAge } of hotTags) {
      const ageStr =
        lastSnapshotAge !== null
          ? dim(` last snapshot ${lastSnapshotAge}d ago`)
          : dim(' no snapshot yet');
      console.log(`  ${cyan(tag)}  ${entryCount} entries${ageStr}`);
      if (!dryRun) {
        console.log(
          dim(
            `    → Run: context-vault search --tags ${tag} --limit 5  (or use create_snapshot MCP tool)`
          )
        );
      }
    }

    if (dryRun) {
      console.log();
      console.log(dim('  Dry run — no snapshots created. Remove --dry-run to see actions.'));
    } else {
      console.log();
      console.log(
        dim(
          `  To consolidate a tag, use the ${cyan('create_snapshot')} MCP tool from your AI client:`
        )
      );
      console.log(dim(`  e.g. "Create a snapshot for the '${hotTags[0]?.tag ?? '<tag>'}' topic"`));
    }
  }

  if (coldIds.length > 0) {
    console.log();
    console.log(bold('  Cold entries') + dim(` (>= 90 days old, never accessed, not superseded)`));
    console.log();
    console.log(`  ${coldIds.length} cold ${coldIds.length === 1 ? 'entry' : 'entries'} found`);
    if (!dryRun) {
      console.log(dim('  These entries have never been accessed and are older than 90 days.'));
      console.log(dim(`  To archive: run context-vault archive (or --dry-run to preview).`));
    }
  }

  console.log();
}

async function runDebug() {
  const { resolveConfig } = await import('@context-vault/core/config');
  const { errorLogPath, errorLogCount } = await import('../dist/error-log.js');

  let config;
  try {
    config = resolveConfig();
  } catch {
    config = null;
  }

  const dataDir = config?.dataDir || join(HOME, '.context-mcp');
  const vaultDir = config?.vaultDir || join(HOME, 'vault');
  const dbPath = config?.dbPath || join(dataDir, 'vault.db');
  const configPath = config?.configPath || join(dataDir, 'config.json');

  const vaultExists = existsSync(vaultDir);
  let vaultWritable = false;
  if (vaultExists) {
    try {
      const probe = join(vaultDir, '.write-probe');
      writeFileSync(probe, '');
      unlinkSync(probe);
      vaultWritable = true;
    } catch {}
  }

  let dbAccessible = false;
  let dbEntryCount = 'n/a';
  try {
    const { initDatabase } = await import('@context-vault/core/db');
    const db = await initDatabase(dbPath);
    dbEntryCount = db.prepare('SELECT COUNT(*) as c FROM vault').get().c;
    db.close();
    dbAccessible = true;
  } catch {}

  const logCount = errorLogCount(dataDir);
  const logPath = errorLogPath(dataDir);
  let lastLogLines = [];
  if (logCount > 0) {
    try {
      const lines = readFileSync(logPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim());
      lastLogLines = lines.slice(-5);
    } catch {}
  }

  const lines = [
    '```',
    `context-vault debug report`,
    `Generated: ${new Date().toISOString()}`,
    ``,
    `Node.js:    ${process.versions.node} (${process.execPath})`,
    `Platform:   ${process.platform} ${process.arch}`,
    `cv version: ${VERSION}`,
    ``,
    `Config:     ${configPath} (${existsSync(configPath) ? 'found' : 'missing'})`,
    `Vault dir:  ${vaultDir} (${vaultExists ? 'exists' : 'missing'}${vaultExists ? `, writable: ${vaultWritable}` : ''})`,
    `DB path:    ${dbPath} (${existsSync(dbPath) ? 'exists' : 'missing'})`,
    `DB access:  ${dbAccessible ? `ok (${dbEntryCount} entries)` : 'failed'}`,
    ``,
    `Error log:  ${logPath} (${logCount} entries)`,
  ];

  if (lastLogLines.length) {
    lines.push(``, `Last 5 error log entries:`);
    for (const l of lastLogLines) lines.push(`  ${l}`);
  }

  lines.push('```');
  lines.push(``, `Paste the above into Claude Code or your AI assistant to diagnose issues.`);

  console.log(lines.join('\n'));
}

async function runServe() {
  await import('../dist/server.js');
}

async function main() {
  if (flags.has('--version') || command === 'version') {
    console.log(VERSION);
    return;
  }

  if (flags.has('--help') || command === 'help') {
    showHelp(flags.has('--all'));
    return;
  }

  if (!command) {
    const configExists = existsSync(join(HOME, '.context-mcp', 'config.json'));
    if (configExists) {
      await runStatus();
    } else {
      await runSetup();
    }
    return;
  }

  switch (command) {
    case 'setup':
      await runSetup();
      break;
    case 'connect':
      await runConnect();
      break;
    case 'switch':
      await runSwitch();
      break;
    case 'serve':
      await runServe();
      break;
    case 'hooks':
      await runHooks();
      break;
    case 'claude':
      await runClaude();
      break;
    case 'skills':
      await runSkills();
      break;
    case 'flush':
      await runFlush();
      break;
    case 'recall':
      await runRecall();
      break;
    case 'session-capture':
      await runSessionCapture();
      break;
    case 'session-end':
      await runSessionEnd();
      break;
    case 'post-tool-call':
      await runPostToolCall();
      break;
    case 'save':
      await runSave();
      break;
    case 'search':
      await runSearch();
      break;
    case 'import':
      await runImport();
      break;
    case 'export':
      await runExport();
      break;
    case 'ingest':
      await runIngest();
      break;
    case 'ingest-project':
      await runIngestProject();
      break;
    case 'reindex':
      await runReindex();
      break;
    case 'migrate-dirs':
      await runMigrateDirs();
      break;
    case 'archive':
      await runArchive();
      break;
    case 'restore':
      await runRestore();
      break;
    case 'prune':
      await runPrune();
      break;
    case 'status':
      await runStatus();
      break;
    case 'update':
      await runUpdate();
      break;
    case 'uninstall':
      await runUninstall();
      break;
    case 'migrate':
      await runMigrate();
      break;
    case 'doctor':
      await runDoctor();
      break;
    case 'health':
      await runHealth();
      break;
    case 'restart':
      await runRestart();
      break;
    case 'consolidate':
      await runConsolidate();
      break;
    case 'debug':
      await runDebug();
      break;
    default:
      console.error(red(`Unknown command: ${command}`));
      console.error(`Run ${cyan('context-vault --help')} for usage.`);
      process.exit(1);
  }
}

main().catch((e) => {
  const dataDir = join(HOME, '.context-mcp');
  const logPath = join(dataDir, 'error.log');
  console.error(red(`Error: ${e.message}`));
  console.error(dim(`Error log: ${logPath}`));
  console.error(dim(`Run: context-vault doctor`));
  console.error(
    dim(`Debug with AI: "context-vault exited with: ${e.message} — how do I fix this?"`)
  );
  process.exit(1);
});
