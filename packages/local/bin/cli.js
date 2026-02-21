#!/usr/bin/env node

// Node.js version guard — must run before any ESM imports
const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
if (nodeVersion < 20) {
  process.stderr.write(
    `\ncontext-vault requires Node.js >= 20 (you have ${process.versions.node}).\n` +
      `Install a newer version: https://nodejs.org/\n\n`,
  );
  process.exit(1);
}

import { createInterface } from "node:readline";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { execSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const HOME = homedir();

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
const VERSION = pkg.version;
const SERVER_PATH = resolve(ROOT, "src", "server", "index.js");

/** Detect if running as an npm-installed package (global or local) vs local dev clone */
function isInstalledPackage() {
  return ROOT.includes("/node_modules/") || ROOT.includes("\\node_modules\\");
}

/** Detect if running via npx (ephemeral cache — paths won't survive cache eviction) */
function isNpx() {
  return ROOT.includes("/_npx/") || ROOT.includes("\\_npx\\");
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.filter((a) => a.startsWith("--")));
const isNonInteractive = flags.has("--yes") || !process.stdin.isTTY;

function getFlag(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

function prompt(question, defaultVal) {
  if (isNonInteractive) return Promise.resolve(defaultVal || "");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultVal ? ` ${dim(`(${defaultVal})`)}` : "";
  return new Promise((res) => {
    rl.question(`${question}${suffix} `, (answer) => {
      rl.close();
      res(answer.trim() || defaultVal || "");
    });
  });
}

const PLATFORM = platform();

/** Get the platform-specific application data directory */
function appDataDir() {
  switch (PLATFORM) {
    case "win32":
      return process.env.APPDATA || join(HOME, "AppData", "Roaming");
    case "darwin":
      return join(HOME, "Library", "Application Support");
    case "linux":
    default:
      return process.env.XDG_CONFIG_HOME || join(HOME, ".config");
  }
}

/** Get the platform-specific VS Code extensions directory */
function vscodeDataDir() {
  switch (PLATFORM) {
    case "win32":
      return join(appDataDir(), "Code", "User", "globalStorage");
    case "darwin":
      return join(appDataDir(), "Code", "User", "globalStorage");
    case "linux":
    default:
      return join(HOME, ".config", "Code", "User", "globalStorage");
  }
}

function commandExistsAsync(bin) {
  const cmd = PLATFORM === "win32" ? "where" : "which";
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
    id: "claude-code",
    name: "Claude Code",
    detect: () => commandExistsAsync("claude"),
    configType: "cli",
  },
  {
    id: "codex",
    name: "Codex",
    detect: () => commandExistsAsync("codex"),
    configType: "cli",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    detect: () => existsSync(join(appDataDir(), "Claude")),
    configType: "json",
    configPath: join(appDataDir(), "Claude", "claude_desktop_config.json"),
    configKey: "mcpServers",
  },
  {
    id: "cursor",
    name: "Cursor",
    detect: () =>
      anyDirExists(join(HOME, ".cursor"), join(appDataDir(), "Cursor")),
    configType: "json",
    configPath: join(HOME, ".cursor", "mcp.json"),
    configKey: "mcpServers",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    detect: () =>
      anyDirExists(join(HOME, ".codeium", "windsurf"), join(HOME, ".windsurf")),
    configType: "json",
    configPath: join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    configKey: "mcpServers",
  },
  {
    id: "antigravity",
    name: "Antigravity (Gemini CLI)",
    detect: () =>
      anyDirExists(join(HOME, ".gemini", "antigravity"), join(HOME, ".gemini")),
    configType: "json",
    configPath: join(HOME, ".gemini", "antigravity", "mcp_config.json"),
    configKey: "mcpServers",
  },
  {
    id: "cline",
    name: "Cline (VS Code)",
    detect: () =>
      existsSync(join(vscodeDataDir(), "saoudrizwan.claude-dev", "settings")),
    configType: "json",
    configPath: join(
      vscodeDataDir(),
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json",
    ),
    configKey: "mcpServers",
  },
  {
    id: "roo-code",
    name: "Roo Code (VS Code)",
    detect: () =>
      existsSync(
        join(vscodeDataDir(), "rooveterinaryinc.roo-cline", "settings"),
      ),
    configType: "json",
    configPath: join(
      vscodeDataDir(),
      "rooveterinaryinc.roo-cline",
      "settings",
      "cline_mcp_settings.json",
    ),
    configKey: "mcpServers",
  },
];

/** Detect all tools in parallel. Returns { detected: Tool[], results: { tool, found }[] } */
async function detectAllTools() {
  const results = await Promise.all(
    TOOLS.map(async (tool) => {
      const found = await tool.detect();
      return { tool, found };
    }),
  );
  const detected = results.filter((r) => r.found).map((r) => r.tool);
  return { detected, results };
}

/** Print tool detection results in deterministic TOOLS order */
function printDetectionResults(results) {
  for (const { tool, found } of results) {
    if (found) {
      console.log(`  ${green("+")} ${tool.name}`);
    } else {
      console.log(`  ${dim("-")} ${dim(tool.name)} ${dim("(not found)")}`);
    }
  }
}

function showHelp() {
  console.log(`
  ${bold("◇ context-vault")} ${dim(`v${VERSION}`)}
  ${dim("Persistent memory for AI agents")}

${bold("Usage:")}
  context-vault <command> [options]

${bold("Commands:")}
  ${cyan("setup")}                 Interactive MCP server installer
  ${cyan("connect")} --key cv_...  Connect AI tools to hosted vault
  ${cyan("switch")} local|hosted      Switch between local and hosted MCP modes
  ${cyan("serve")}                 Start the MCP server (used by AI clients)
  ${cyan("reindex")}               Rebuild search index from knowledge files
  ${cyan("status")}                Show vault diagnostics
  ${cyan("update")}                Check for and install updates
  ${cyan("uninstall")}             Remove MCP configs and optionally data
  ${cyan("import")} <path>          Import entries from file or directory
  ${cyan("export")}                Export vault to JSON or CSV
  ${cyan("ingest")} <url>          Fetch URL and save as vault entry
  ${cyan("migrate")}               Migrate vault between local and hosted

${bold("Options:")}
  --help                Show this help
  --version             Show version
  --yes                 Non-interactive mode (accept all defaults)
  --skip-embeddings     Skip embedding model download (FTS-only mode)
`);
}

async function runSetup() {
  const setupStart = Date.now();

  // Banner
  console.log();
  console.log(`  ${bold("◇ context-vault")} ${dim(`v${VERSION}`)}`);
  console.log(dim("  Persistent memory for AI agents"));
  console.log();

  // Check for existing installation
  const existingConfig = join(HOME, ".context-mcp", "config.json");
  if (existsSync(existingConfig) && !isNonInteractive) {
    let existingVault = "(unknown)";
    try {
      const cfg = JSON.parse(readFileSync(existingConfig, "utf-8"));
      existingVault = cfg.vaultDir || existingVault;
    } catch {}

    console.log(yellow(`  Existing installation detected`));
    console.log(dim(`  Vault: ${existingVault}`));
    console.log(dim(`  Config: ${existingConfig}`));
    console.log();
    console.log(`    1) Full reconfigure`);
    console.log(`    2) Update tool configs only ${dim("(skip vault setup)")}`);
    console.log(`    3) Cancel`);
    console.log();
    const choice = await prompt("  Select:", "1");

    if (choice === "3") {
      console.log(dim("  Cancelled."));
      return;
    }

    if (choice === "2") {
      // Skip vault setup, just reconfigure tools
      console.log();
      console.log(dim(`  [1/2]`) + bold(" Detecting tools...\n"));
      const { detected, results: detectionResults } = await detectAllTools();
      printDetectionResults(detectionResults);
      console.log();

      if (detected.length === 0) {
        console.log(yellow("  No supported tools detected."));
        return;
      }

      let selected;
      if (detected.length === 1) {
        selected = detected;
        console.log(`  ${dim("→")} Auto-selected ${detected[0].name}\n`);
      } else {
        console.log(bold("  Which tools should context-vault connect to?\n"));
        for (let i = 0; i < detected.length; i++) {
          console.log(`    ${i + 1}) ${detected[i].name}`);
        }
        console.log();
        const answer = await prompt(
          `  Select (${dim("1,2,3")} or ${dim('"all"')}):`,
          "all",
        );
        if (answer === "all" || answer === "") {
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
        const cfg = JSON.parse(readFileSync(existingConfig, "utf-8"));
        const defaultVDir = join(HOME, "vault");
        if (cfg.vaultDir && resolve(cfg.vaultDir) !== resolve(defaultVDir)) {
          customVaultDir = cfg.vaultDir;
        }
      } catch {}

      console.log(`\n  ${dim("[2/2]")}${bold(" Configuring tools...\n")}`);
      for (const tool of selected) {
        try {
          if (tool.configType === "cli" && tool.id === "codex") {
            await configureCodex(tool, customVaultDir);
          } else if (tool.configType === "cli") {
            await configureClaude(tool, customVaultDir);
          } else {
            configureJsonTool(tool, customVaultDir);
          }
          console.log(`  ${green("+")} ${tool.name} — configured`);
        } catch (e) {
          console.log(`  ${red("x")} ${tool.name} — ${e.message}`);
        }
      }

      console.log();
      console.log(green("  ✓ Tool configs updated."));
      console.log();
      return;
    }
    // choice === "1" falls through to full setup below
    console.log();
  }

  // Detect tools
  console.log(dim(`  [1/5]`) + bold(" Detecting tools...\n"));
  const { detected, results: detectionResults } = await detectAllTools();
  printDetectionResults(detectionResults);
  console.log();

  if (detected.length === 0) {
    console.log(yellow("  No supported tools detected.\n"));
    console.log("  To manually configure, add to your tool's MCP config:\n");
    if (isInstalledPackage()) {
      console.log(`  ${dim("{")}
    ${dim('"mcpServers": {')}
      ${dim('"context-vault": {')}
        ${dim('"command": "npx",')}
        ${dim(`"args": ["-y", "context-vault", "serve", "--vault-dir", "/path/to/vault"]`)}
      ${dim("}")}
    ${dim("}")}
  ${dim("}")}\n`);
    } else {
      console.log(`  ${dim("{")}
    ${dim('"mcpServers": {')}
      ${dim('"context-vault": {')}
        ${dim('"command": "node",')}
        ${dim(`"args": ["${SERVER_PATH}", "--vault-dir", "/path/to/vault"]`)}
      ${dim("}")}
    ${dim("}")}
  ${dim("}")}\n`);
    }

    // In non-interactive mode, continue setup without tools (vault, config, etc.)
    if (isNonInteractive) {
      console.log(
        dim("  Continuing setup without tool configuration (--yes mode).\n"),
      );
    } else {
      return;
    }
  }

  // Select tools
  let selected;
  if (isNonInteractive || detected.length === 1) {
    selected = detected;
    if (detected.length === 1) {
      console.log(`  ${dim("→")} Auto-selected ${detected[0].name}\n`);
    }
  } else {
    console.log(bold("  Which tools should context-vault connect to?\n"));
    for (let i = 0; i < detected.length; i++) {
      console.log(`    ${i + 1}) ${detected[i].name}`);
    }
    console.log();
    const answer = await prompt(
      `  Select (${dim("1,2,3")} or ${dim('"all"')}):`,
      "all",
    );
    if (answer === "all" || answer === "") {
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
  console.log(dim(`  [2/5]`) + bold(" Configuring vault...\n"));
  const defaultVaultDir = join(HOME, "vault");
  const vaultDir = isNonInteractive
    ? defaultVaultDir
    : await prompt(`  Vault directory:`, defaultVaultDir);
  const resolvedVaultDir = resolve(vaultDir);

  // Create vault dir if needed
  if (!existsSync(resolvedVaultDir)) {
    if (isNonInteractive) {
      mkdirSync(resolvedVaultDir, { recursive: true });
      console.log(`\n  ${green("+")} Created ${resolvedVaultDir}`);
    } else {
      const create = await prompt(
        `\n  ${resolvedVaultDir} doesn't exist. Create it? (Y/n):`,
        "Y",
      );
      if (create.toLowerCase() !== "n") {
        mkdirSync(resolvedVaultDir, { recursive: true });
        console.log(`  ${green("+")} Created ${resolvedVaultDir}`);
      }
    }
  }

  // Ensure data dir exists for DB storage
  const dataDir = join(HOME, ".context-mcp");
  mkdirSync(dataDir, { recursive: true });

  // Write config.json to data dir (persistent, survives reinstalls)
  const configPath = join(dataDir, "config.json");
  const vaultConfig = {};
  if (existsSync(configPath)) {
    try {
      Object.assign(vaultConfig, JSON.parse(readFileSync(configPath, "utf-8")));
    } catch {}
  }
  vaultConfig.vaultDir = resolvedVaultDir;
  vaultConfig.dataDir = dataDir;
  vaultConfig.dbPath = join(dataDir, "vault.db");
  vaultConfig.devDir = join(HOME, "dev");
  vaultConfig.mode = "local";
  writeFileSync(configPath, JSON.stringify(vaultConfig, null, 2) + "\n");
  console.log(`\n  ${green("+")} Wrote ${configPath}`);

  // Pre-download embedding model with spinner (skip with --skip-embeddings)
  const skipEmbeddings = flags.has("--skip-embeddings");
  if (skipEmbeddings) {
    console.log(
      `\n  ${dim("[3/5]")}${bold(" Embedding model")} ${dim("(skipped)")}`,
    );
    console.log(
      dim(
        "  FTS-only mode — full-text search works, semantic search disabled.",
      ),
    );
    console.log(
      dim("  To enable later: context-vault setup (without --skip-embeddings)"),
    );
  } else {
    console.log(
      `\n  ${dim("[3/5]")}${bold(" Downloading embedding model...")}`,
    );
    console.log(dim("  all-MiniLM-L6-v2 (~22MB, one-time download)\n"));
    {
      const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let frame = 0;
      const start = Date.now();
      const spinner = setInterval(() => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        process.stdout.write(
          `\r  ${spinnerFrames[frame++ % spinnerFrames.length]} Downloading... ${dim(`${elapsed}s`)}`,
        );
      }, 100);

      try {
        const { embed } = await import("@context-vault/core/index/embed");
        await embed("warmup");

        clearInterval(spinner);
        process.stdout.write(
          `\r  ${green("+")} Embedding model ready              \n`,
        );
      } catch (e) {
        clearInterval(spinner);
        const code = e.code || e.cause?.code || "";
        const isNetwork = [
          "ENOTFOUND",
          "ETIMEDOUT",
          "ECONNREFUSED",
          "ECONNRESET",
          "ERR_SOCKET_TIMEOUT",
        ].includes(code);
        process.stdout.write(
          `\r  ${yellow("!")} Model download failed: ${e.message}              \n`,
        );
        if (isNetwork) {
          console.log(dim(`    Check your internet connection and try again.`));
        }
        console.log(
          dim(
            `    Retry: ${isNpx() ? "npx context-vault" : "context-vault"} setup`,
          ),
        );
        console.log(
          dim(`    Semantic search disabled — full-text search still works.`),
        );
      }
    }
  }

  // Clean up legacy project-root config.json if it exists
  const legacyConfigPath = join(ROOT, "config.json");
  if (existsSync(legacyConfigPath)) {
    try {
      unlinkSync(legacyConfigPath);
      console.log(`  ${dim("Removed legacy config at " + legacyConfigPath)}`);
    } catch {}
  }

  // Configure each tool — pass vault dir as arg if non-default
  console.log(`\n  ${dim("[4/5]")}${bold(" Configuring tools...\n")}`);
  const results = [];
  const defaultVDir = join(HOME, "vault");
  const customVaultDir =
    resolvedVaultDir !== resolve(defaultVDir) ? resolvedVaultDir : null;

  for (const tool of selected) {
    try {
      if (tool.configType === "cli" && tool.id === "codex") {
        await configureCodex(tool, customVaultDir);
      } else if (tool.configType === "cli") {
        await configureClaude(tool, customVaultDir);
      } else {
        configureJsonTool(tool, customVaultDir);
      }
      results.push({ tool, ok: true });
      console.log(`  ${green("+")} ${tool.name} — configured`);
    } catch (e) {
      results.push({ tool, ok: false, error: e.message });
      console.log(`  ${red("x")} ${tool.name} — ${e.message}`);
    }
  }

  // Seed entry
  const seeded = createSeedEntries(resolvedVaultDir);
  if (seeded > 0) {
    console.log(
      `\n  ${green("+")} Created ${seeded} starter ${seeded === 1 ? "entry" : "entries"} in vault`,
    );
  }

  // Health check
  console.log(`\n  ${dim("[5/5]")}${bold(" Health check...")}\n`);
  const okResults = results.filter((r) => r.ok);

  // Verify DB is accessible
  let dbAccessible = false;
  try {
    const { initDatabase } = await import("@context-vault/core/index/db");
    const db = await initDatabase(vaultConfig.dbPath);
    db.prepare("SELECT 1").get();
    db.close();
    dbAccessible = true;
  } catch {}

  const checks = [
    { label: "Vault directory exists", pass: existsSync(resolvedVaultDir) },
    { label: "Config file written", pass: existsSync(configPath) },
    { label: "Database accessible", pass: dbAccessible },
    { label: "At least one tool configured", pass: okResults.length > 0 },
  ];
  const passed = checks.filter((c) => c.pass).length;
  for (const c of checks) {
    console.log(`  ${c.pass ? green("✓") : red("✗")} ${c.label}`);
  }

  // Completion box
  const elapsed = ((Date.now() - setupStart) / 1000).toFixed(1);
  const toolName = okResults.length ? okResults[0].tool.name : "your AI tool";
  const boxLines = [
    `  ✓ Setup complete — ${passed}/${checks.length} checks passed (${elapsed}s)`,
    ``,
    `  ${bold("AI Tools")} — open ${toolName} and try:`,
    `  "Search my vault for getting started"`,
    `  "Save an insight about [topic]"`,
    `  "Show my vault status"`,
    ``,
    `  ${bold("CLI Commands:")}`,
    `  ${isNpx() ? "npx context-vault" : "context-vault"} status    Show vault health`,
    `  ${isNpx() ? "npx context-vault" : "context-vault"} update    Check for updates`,
  ];
  const innerWidth = Math.max(...boxLines.map((l) => l.length)) + 2;
  const pad = (s) => s + " ".repeat(Math.max(0, innerWidth - s.length));
  console.log();
  console.log(`  ${dim("┌" + "─".repeat(innerWidth) + "┐")}`);
  for (const line of boxLines) {
    console.log(`  ${dim("│")}${pad(line)}${dim("│")}`);
  }
  console.log(`  ${dim("└" + "─".repeat(innerWidth) + "┘")}`);
  console.log();
}

async function configureClaude(tool, vaultDir) {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  // Clean up old name
  try {
    execSync("claude mcp remove context-mcp -s user", { stdio: "pipe", env });
  } catch {}

  try {
    execSync("claude mcp remove context-vault -s user", { stdio: "pipe", env });
  } catch {}

  try {
    if (isNpx()) {
      const cmdArgs = ["-y", "context-vault", "serve"];
      if (vaultDir) cmdArgs.push("--vault-dir", `"${vaultDir}"`);
      execSync(
        `claude mcp add -s user context-vault -- npx ${cmdArgs.join(" ")}`,
        { stdio: "pipe", env },
      );
    } else if (isInstalledPackage()) {
      const launcherPath = join(HOME, ".context-mcp", "server.mjs");
      const cmdArgs = [`"${launcherPath}"`];
      if (vaultDir) cmdArgs.push("--vault-dir", `"${vaultDir}"`);
      execSync(
        `claude mcp add -s user context-vault -- ${process.execPath} ${cmdArgs.join(" ")}`,
        { stdio: "pipe", env },
      );
    } else {
      const cmdArgs = [`"${SERVER_PATH}"`];
      if (vaultDir) cmdArgs.push("--vault-dir", `"${vaultDir}"`);
      execSync(
        `claude mcp add -s user context-vault -- ${process.execPath} ${cmdArgs.join(" ")}`,
        { stdio: "pipe", env },
      );
    }
  } catch (e) {
    const stderr = e.stderr?.toString().trim();
    throw new Error(stderr || e.message);
  }
}

async function configureCodex(tool, vaultDir) {
  // Clean up old name
  try {
    execSync("codex mcp remove context-mcp", { stdio: "pipe" });
  } catch {}

  try {
    execSync("codex mcp remove context-vault", { stdio: "pipe" });
  } catch {}

  try {
    if (isNpx()) {
      const cmdArgs = ["-y", "context-vault", "serve"];
      if (vaultDir) cmdArgs.push("--vault-dir", `"${vaultDir}"`);
      execSync(`codex mcp add context-vault -- npx ${cmdArgs.join(" ")}`, {
        stdio: "pipe",
      });
    } else if (isInstalledPackage()) {
      const launcherPath = join(HOME, ".context-mcp", "server.mjs");
      const cmdArgs = [`"${launcherPath}"`];
      if (vaultDir) cmdArgs.push("--vault-dir", `"${vaultDir}"`);
      execSync(
        `codex mcp add context-vault -- ${process.execPath} ${cmdArgs.join(" ")}`,
        {
          stdio: "pipe",
        },
      );
    } else {
      const cmdArgs = [`"${SERVER_PATH}"`];
      if (vaultDir) cmdArgs.push("--vault-dir", `"${vaultDir}"`);
      execSync(
        `codex mcp add context-vault -- ${process.execPath} ${cmdArgs.join(" ")}`,
        {
          stdio: "pipe",
        },
      );
    }
  } catch (e) {
    const stderr = e.stderr?.toString().trim();
    throw new Error(stderr || e.message);
  }
}

function configureJsonTool(tool, vaultDir) {
  const configPath = tool.configPath;
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let config = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    try {
      config = JSON.parse(raw);
    } catch {
      const bakPath = configPath + ".bak";
      copyFileSync(configPath, bakPath);
      console.log(`  ${yellow("!")} Backed up corrupted config to ${bakPath}`);
      config = {};
    }
  }

  if (!config[tool.configKey]) {
    config[tool.configKey] = {};
  }

  // Clean up old "context-mcp" key
  delete config[tool.configKey]["context-mcp"];

  if (isNpx()) {
    const serverArgs = vaultDir ? ["--vault-dir", vaultDir] : [];
    config[tool.configKey]["context-vault"] = {
      command: "npx",
      args: ["-y", "context-vault", "serve", ...serverArgs],
    };
  } else if (isInstalledPackage()) {
    const launcherPath = join(HOME, ".context-mcp", "server.mjs");
    const serverArgs = [];
    if (vaultDir) serverArgs.push("--vault-dir", vaultDir);
    config[tool.configKey]["context-vault"] = {
      command: process.execPath,
      args: [launcherPath, ...serverArgs],
    };
  } else {
    const serverArgs = [SERVER_PATH];
    if (vaultDir) serverArgs.push("--vault-dir", vaultDir);
    config[tool.configKey]["context-vault"] = {
      command: process.execPath,
      args: serverArgs,
    };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

function createSeedEntries(vaultDir) {
  let created = 0;

  // Entry 1: Getting started (improved)
  const insightDir = join(vaultDir, "knowledge", "insights");
  const insightPath = join(insightDir, "getting-started.md");
  if (!existsSync(insightPath)) {
    mkdirSync(insightDir, { recursive: true });
    const id1 = Date.now().toString(36).toUpperCase().padStart(10, "0");
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
`,
    );
    created++;
  }

  // Entry 2: Example decision
  const decisionDir = join(vaultDir, "knowledge", "decisions");
  const decisionPath = join(decisionDir, "example-local-first-data.md");
  if (!existsSync(decisionPath)) {
    mkdirSync(decisionDir, { recursive: true });
    const id2 = (Date.now() + 1).toString(36).toUpperCase().padStart(10, "0");
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
`,
    );
    created++;
  }

  return created;
}

async function runConnect() {
  const apiKey = getFlag("--key");
  const hostedUrl = getFlag("--url") || "https://api.context-vault.com";

  if (!apiKey) {
    console.log(`\n  ${bold("context-vault connect")}\n`);
    console.log(`  Connect your AI tools to a hosted Context Vault.\n`);
    console.log(`  Usage:`);
    console.log(`    context-vault connect --key cv_...\n`);
    console.log(`  Options:`);
    console.log(`    --key <key>   API key (required)`);
    console.log(
      `    --url <url>   Hosted server URL (default: https://api.context-vault.com)`,
    );
    console.log();
    return;
  }

  // Validate key format
  if (!apiKey.startsWith("cv_") || apiKey.length < 10) {
    console.error(`\n  ${red("Invalid API key format.")}`);
    console.error(dim(`  Keys start with "cv_" and are 43 characters long.`));
    console.error(dim(`  Get yours at ${hostedUrl}/register\n`));
    process.exit(1);
  }

  console.log();
  console.log(`  ${bold("◇ context-vault")} ${dim("connect")}`);
  console.log();

  // Validate key against server before configuring tools
  console.log(dim("  Verifying API key..."));
  let user;
  try {
    const response = await fetch(`${hostedUrl}/api/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (response.status === 401) {
      console.error(`\n  ${red("Invalid or expired API key.")}`);
      console.error(dim(`  Check your key and try again.`));
      console.error(dim(`  Get a new key at ${hostedUrl}/register\n`));
      process.exit(1);
    }
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }
    user = await response.json();
    console.log(`  ${green("+")} Verified — ${user.email} (${user.tier})\n`);
  } catch (e) {
    if (
      e.code === "ECONNREFUSED" ||
      e.code === "ENOTFOUND" ||
      e.cause?.code === "ECONNREFUSED" ||
      e.cause?.code === "ENOTFOUND"
    ) {
      console.error(`\n  ${red("Cannot reach server.")}`);
      console.error(dim(`  URL: ${hostedUrl}`));
      console.error(
        dim(`  Check your internet connection or try --url <url>\n`),
      );
    } else if (e.message?.includes("Invalid or expired")) {
      // Already handled above
    } else {
      console.error(`\n  ${red(`Verification failed: ${e.message}`)}`);
      console.error(dim(`  Server: ${hostedUrl}`));
      console.error(dim(`  Check your API key and internet connection.\n`));
    }
    process.exit(1);
  }

  // Detect tools
  console.log(dim(`  [1/2]`) + bold(" Detecting tools...\n"));
  const { detected, results: connectDetectionResults } = await detectAllTools();
  printDetectionResults(connectDetectionResults);
  console.log();

  if (detected.length === 0) {
    console.log(yellow("  No supported tools detected."));
    console.log(`\n  Add this to your tool's MCP config manually:\n`);
    console.log(
      dim(
        `  ${JSON.stringify(
          {
            mcpServers: {
              "context-vault": {
                url: `${hostedUrl}/mcp`,
                headers: { Authorization: `Bearer ${apiKey}` },
              },
            },
          },
          null,
          2,
        )
          .split("\n")
          .join("\n  ")}`,
      ),
    );
    console.log();
    return;
  }

  // Select tools
  let selected;
  if (isNonInteractive) {
    selected = detected;
  } else {
    console.log(bold("  Which tools should connect to your hosted vault?\n"));
    for (let i = 0; i < detected.length; i++) {
      console.log(`    ${i + 1}) ${detected[i].name}`);
    }
    console.log();
    const answer = await prompt(
      `  Select (${dim("1,2,3")} or ${dim('"all"')}):`,
      "all",
    );
    if (answer === "all" || answer === "") {
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
  console.log(`\n  ${dim("[2/2]")}${bold(" Configuring tools...\n")}`);
  for (const tool of selected) {
    try {
      if (tool.configType === "cli" && tool.id === "codex") {
        configureCodexHosted(apiKey, hostedUrl);
      } else if (tool.configType === "cli") {
        configureClaudeHosted(apiKey, hostedUrl);
      } else {
        configureJsonToolHosted(tool, apiKey, hostedUrl);
      }
      console.log(`  ${green("+")} ${tool.name} — configured`);
    } catch (e) {
      console.log(`  ${red("x")} ${tool.name} — ${e.message}`);
    }
  }

  // Persist mode in config
  const modeConfigPath = join(HOME, ".context-mcp", "config.json");
  let modeConfig = {};
  if (existsSync(modeConfigPath)) {
    try {
      modeConfig = JSON.parse(readFileSync(modeConfigPath, "utf-8"));
    } catch {}
  }
  modeConfig.mode = "hosted";
  modeConfig.hostedUrl = hostedUrl;
  mkdirSync(join(HOME, ".context-mcp"), { recursive: true });
  writeFileSync(modeConfigPath, JSON.stringify(modeConfig, null, 2) + "\n");

  console.log();
  console.log(
    green("  ✓ Connected! Your AI tools can now access your hosted vault."),
  );
  console.log(dim(`  Endpoint: ${hostedUrl}/mcp`));
  console.log();
}

function configureClaudeHosted(apiKey, hostedUrl) {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  try {
    execSync("claude mcp remove context-mcp -s user", { stdio: "pipe", env });
  } catch {}
  try {
    execSync("claude mcp remove context-vault -s user", { stdio: "pipe", env });
  } catch {}

  try {
    execSync(
      `claude mcp add -s user --transport http context-vault ${hostedUrl}/mcp`,
      { stdio: "pipe", env },
    );
  } catch (e) {
    const stderr = e.stderr?.toString().trim();
    throw new Error(stderr || e.message);
  }
}

function configureCodexHosted(apiKey, hostedUrl) {
  try {
    execSync("codex mcp remove context-mcp", { stdio: "pipe" });
  } catch {}
  try {
    execSync("codex mcp remove context-vault", { stdio: "pipe" });
  } catch {}

  try {
    execSync(`codex mcp add --transport http context-vault ${hostedUrl}/mcp`, {
      stdio: "pipe",
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
    const raw = readFileSync(configPath, "utf-8");
    try {
      config = JSON.parse(raw);
    } catch {
      const bakPath = configPath + ".bak";
      copyFileSync(configPath, bakPath);
      config = {};
    }
  }

  if (!config[tool.configKey]) {
    config[tool.configKey] = {};
  }

  // Clean up old "context-mcp" key
  delete config[tool.configKey]["context-mcp"];

  config[tool.configKey]["context-vault"] = {
    url: `${hostedUrl}/mcp`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

async function runSwitch() {
  const target = args[1];
  if (target !== "local" && target !== "hosted") {
    console.log(`\n  ${bold("context-vault switch")} <local|hosted>\n`);
    console.log(`  Switch between local and hosted MCP modes.\n`);
    console.log(
      `  ${cyan("switch local")}    Use local vault (SQLite + files on this device)`,
    );
    console.log(
      `  ${cyan("switch hosted")}   Use hosted vault (requires API key)\n`,
    );
    console.log(`  Options:`);
    console.log(`    --key <key>   API key for hosted mode (cv_...)`);
    console.log(
      `    --url <url>   Hosted server URL (default: https://api.context-vault.com)\n`,
    );
    return;
  }

  const dataDir = join(HOME, ".context-mcp");
  const configPath = join(dataDir, "config.json");
  let vaultConfig = {};
  if (existsSync(configPath)) {
    try {
      vaultConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {}
  }

  const { detected } = await detectAllTools();

  if (target === "local") {
    const launcherPath = join(dataDir, "server.mjs");
    if (!existsSync(launcherPath)) {
      const serverAbs = resolve(ROOT, "src", "server", "index.js");
      mkdirSync(dataDir, { recursive: true });
      writeFileSync(launcherPath, `import "${serverAbs}";\n`);
    }

    vaultConfig.mode = "local";
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(vaultConfig, null, 2) + "\n");

    console.log();
    console.log(`  ${bold("◇ context-vault")} ${dim("switch → local")}`);
    console.log();

    const defaultVDir = join(HOME, "vault");
    const customVaultDir =
      vaultConfig.vaultDir &&
      resolve(vaultConfig.vaultDir) !== resolve(defaultVDir)
        ? vaultConfig.vaultDir
        : null;

    for (const tool of detected) {
      try {
        if (tool.configType === "cli" && tool.id === "codex") {
          await configureCodex(tool, customVaultDir);
        } else if (tool.configType === "cli") {
          await configureClaude(tool, customVaultDir);
        } else {
          configureJsonTool(tool, customVaultDir);
        }
        console.log(`  ${green("+")} ${tool.name} — switched to local`);
      } catch (e) {
        console.log(`  ${red("x")} ${tool.name} — ${e.message}`);
      }
    }
    console.log();
    console.log(green("  ✓ Switched to local mode."));
    console.log(dim(`  Server: node ${launcherPath}`));
    console.log();
  } else {
    const hostedUrl =
      getFlag("--url") ||
      vaultConfig.hostedUrl ||
      "https://api.context-vault.com";
    const apiKey = getFlag("--key") || vaultConfig.apiKey;

    if (!apiKey) {
      console.error(
        red(`  --key <api_key> required. Get yours at ${hostedUrl}/dashboard`),
      );
      process.exit(1);
    }

    console.log();
    console.log(`  ${bold("◇ context-vault")} ${dim("switch → hosted")}`);
    console.log();
    console.log(dim("  Verifying API key..."));

    try {
      const response = await fetch(`${hostedUrl}/api/me`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const user = await response.json();
      console.log(`  ${green("+")} Verified — ${user.email}\n`);
    } catch (e) {
      console.error(red(`  Verification failed: ${e.message}`));
      process.exit(1);
    }

    vaultConfig.mode = "hosted";
    vaultConfig.hostedUrl = hostedUrl;
    vaultConfig.apiKey = apiKey;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(configPath, JSON.stringify(vaultConfig, null, 2) + "\n");

    for (const tool of detected) {
      try {
        if (tool.configType === "cli" && tool.id === "codex") {
          configureCodexHosted(apiKey, hostedUrl);
        } else if (tool.configType === "cli") {
          configureClaudeHosted(apiKey, hostedUrl);
        } else {
          configureJsonToolHosted(tool, apiKey, hostedUrl);
        }
        console.log(`  ${green("+")} ${tool.name} — switched to hosted`);
      } catch (e) {
        console.log(`  ${red("x")} ${tool.name} — ${e.message}`);
      }
    }
    console.log();
    console.log(green("  ✓ Switched to hosted mode."));
    console.log(dim(`  Endpoint: ${hostedUrl}/mcp`));
    console.log();
  }
}

async function runReindex() {
  console.log(dim("Loading vault..."));

  const { resolveConfig } = await import("@context-vault/core/core/config");
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import("@context-vault/core/index/db");
  const { embed } = await import("@context-vault/core/index/embed");
  const { reindex } = await import("@context-vault/core/index");

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`Vault directory not found: ${config.vaultDir}`));
    console.error("Run " + cyan("context-vault setup") + " to configure.");
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
  console.log(green("✓ Reindex complete"));
  console.log(`  ${green("+")} ${stats.added} added`);
  console.log(`  ${yellow("~")} ${stats.updated} updated`);
  console.log(`  ${red("-")} ${stats.removed} removed`);
  console.log(`  ${dim("·")} ${stats.unchanged} unchanged`);
}

async function runStatus() {
  const { resolveConfig } = await import("@context-vault/core/core/config");
  const { initDatabase } = await import("@context-vault/core/index/db");
  const { gatherVaultStatus } = await import("@context-vault/core/core/status");

  const config = resolveConfig();

  let mode = "local";
  let modeDetail = "";
  const rawConfigPath = join(HOME, ".context-mcp", "config.json");
  if (existsSync(rawConfigPath)) {
    try {
      const raw = JSON.parse(readFileSync(rawConfigPath, "utf-8"));
      mode = raw.mode || "local";
      if (mode === "hosted" && raw.hostedUrl) {
        const email = raw.email ? ` · ${raw.email}` : "";
        modeDetail = ` (${raw.hostedUrl}${email})`;
      } else {
        const launcherPath = join(HOME, ".context-mcp", "server.mjs");
        modeDetail = ` (node ${launcherPath})`;
      }
    } catch {}
  }

  const db = await initDatabase(config.dbPath);

  const status = gatherVaultStatus({ db, config });

  db.close();

  console.log();
  console.log(`  ${bold("◇ context-vault")} ${dim(`v${VERSION}`)}`);
  console.log();
  console.log(`  Mode:      ${mode}${dim(modeDetail)}`);
  console.log(
    `  Vault:     ${config.vaultDir} ${dim(`(${config.vaultDirExists ? status.fileCount + " files" : "missing"})`)}`,
  );
  console.log(`  Database:  ${config.dbPath} ${dim(`(${status.dbSize})`)}`);
  console.log(`  Dev dir:   ${config.devDir}`);
  console.log(`  Data dir:  ${config.dataDir}`);
  console.log(
    `  Config:    ${config.configPath} ${dim(`(${existsSync(config.configPath) ? "exists" : "missing"})`)}`,
  );
  console.log(`  Resolved:  ${status.resolvedFrom}`);
  console.log(`  Schema:    v7 (teams)`);

  if (status.kindCounts.length) {
    const BAR_WIDTH = 20;
    const maxCount = Math.max(...status.kindCounts.map((k) => k.c));
    console.log();
    console.log(bold("  Indexed"));
    for (const { kind, c } of status.kindCounts) {
      const filled = maxCount > 0 ? Math.round((c / maxCount) * BAR_WIDTH) : 0;
      const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
      const countStr = String(c).padStart(4);
      console.log(`  ${countStr} ${kind}s   ${dim(bar)}`);
    }
  } else {
    console.log(`\n  ${dim("(empty — no entries indexed)")}`);
  }

  if (status.embeddingStatus) {
    const { indexed, total, missing } = status.embeddingStatus;
    if (missing > 0) {
      const BAR_WIDTH = 20;
      const filled = total > 0 ? Math.round((indexed / total) * BAR_WIDTH) : 0;
      const bar = "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
      const pct = total > 0 ? Math.round((indexed / total) * 100) : 0;
      console.log();
      console.log(`  Embeddings ${dim(bar)} ${indexed}/${total} (${pct}%)`);
    }
  }

  if (status.subdirs.length) {
    console.log();
    console.log(bold("  Disk Directories"));
    for (const { name, count } of status.subdirs) {
      console.log(`    ${name}/: ${count} files`);
    }
  }

  if (status.stalePaths) {
    console.log();
    console.log(yellow("  Stale paths detected in DB."));
    console.log(`  Run ${cyan("context-vault reindex")} to update.`);
  }
  console.log();
}

async function runUpdate() {
  console.log();
  console.log(`  ${bold("◇ context-vault")} ${dim(`v${VERSION}`)}`);
  console.log();

  let latest;
  try {
    latest = execSync("npm view context-vault version", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    console.error(
      red("  Could not check for updates. Verify your network connection."),
    );
    return;
  }

  if (latest === VERSION) {
    console.log(green("  Already up to date."));
    console.log();
    return;
  }

  console.log(`  Current: ${dim(VERSION)}`);
  console.log(`  Latest:  ${green(latest)}`);
  console.log();

  if (!isNonInteractive) {
    const answer = await prompt(`  Update to v${latest}? (Y/n):`, "Y");
    if (answer.toLowerCase() === "n") {
      console.log(dim("  Cancelled."));
      return;
    }
  }

  console.log(dim("  Installing..."));
  try {
    execSync("npm install -g context-vault@latest", { stdio: "inherit" });
    console.log();
    console.log(green(`  ✓ Updated to v${latest}`));
  } catch {
    console.error(
      red("  Update failed. Try manually: npx -y context-vault@latest setup"),
    );
  }
  console.log();
}

async function runUninstall() {
  console.log();
  console.log(`  ${bold("◇ context-vault")} ${dim("uninstall")}`);
  console.log();

  // Remove from Claude Code (both old and new names)
  try {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    try {
      execSync("claude mcp remove context-mcp -s user", { stdio: "pipe", env });
    } catch {}
    execSync("claude mcp remove context-vault -s user", { stdio: "pipe", env });
    console.log(`  ${green("+")} Removed from Claude Code`);
  } catch {
    console.log(`  ${dim("-")} Claude Code — not configured or not installed`);
  }

  // Remove from Codex (both old and new names)
  try {
    try {
      execSync("codex mcp remove context-mcp", { stdio: "pipe" });
    } catch {}
    execSync("codex mcp remove context-vault", { stdio: "pipe" });
    console.log(`  ${green("+")} Removed from Codex`);
  } catch {
    console.log(`  ${dim("-")} Codex — not configured or not installed`);
  }

  // Remove from JSON-configured tools (both old and new keys)
  for (const tool of TOOLS.filter((t) => t.configType === "json")) {
    if (!existsSync(tool.configPath)) continue;
    try {
      const config = JSON.parse(readFileSync(tool.configPath, "utf-8"));
      const hadOld = !!config[tool.configKey]?.["context-mcp"];
      const hadNew = !!config[tool.configKey]?.["context-vault"];
      if (hadOld || hadNew) {
        delete config[tool.configKey]["context-mcp"];
        delete config[tool.configKey]["context-vault"];
        writeFileSync(tool.configPath, JSON.stringify(config, null, 2) + "\n");
        console.log(`  ${green("+")} Removed from ${tool.name}`);
      }
    } catch {
      console.log(`  ${dim("-")} ${tool.name} — could not update config`);
    }
  }

  // Optionally remove data directory
  const dataDir = join(HOME, ".context-mcp");
  if (existsSync(dataDir)) {
    console.log();
    const answer = isNonInteractive
      ? "n"
      : await prompt(`  Remove data directory (${dataDir})? (y/N):`, "N");
    if (answer.toLowerCase() === "y") {
      const { rmSync } = await import("node:fs");
      rmSync(dataDir, { recursive: true, force: true });
      console.log(`  ${green("+")} Removed ${dataDir}`);
    } else {
      console.log(`  ${dim("Kept")} ${dataDir}`);
    }
  }

  console.log();
  console.log(
    dim("  Vault directory was not touched (your knowledge files are safe)."),
  );
  console.log(`  To fully remove: ${cyan("npm uninstall -g context-vault")}`);
  console.log();
}

async function runMigrate() {
  const direction = args.includes("--to-hosted")
    ? "to-hosted"
    : args.includes("--to-local")
      ? "to-local"
      : null;

  if (!direction) {
    console.log(`\n  ${bold("context-vault migrate")}\n`);
    console.log(`  Usage:`);
    console.log(
      `    context-vault migrate --to-hosted  Upload local vault to hosted service`,
    );
    console.log(
      `    context-vault migrate --to-local   Download hosted vault to local files`,
    );
    console.log(`\n  Options:`);
    console.log(
      `    --url <url>      Hosted server URL (default: https://api.context-vault.com)`,
    );
    console.log(`    --key <key>      API key (cv_...)`);
    console.log();
    return;
  }

  const hostedUrl = getFlag("--url") || "https://api.context-vault.com";
  const apiKey = getFlag("--key");

  if (!apiKey) {
    console.error(red("  Error: --key <api_key> is required for migration."));
    console.error(`  Get your API key at ${cyan(hostedUrl + "/dashboard")}`);
    return;
  }

  const { resolveConfig } = await import("@context-vault/core/core/config");
  const config = resolveConfig();

  if (direction === "to-hosted") {
    const { migrateToHosted } =
      await import("@context-vault/hosted/migration/migrate");
    console.log(`\n  ${bold("Migrating to hosted")}...`);
    console.log(dim(`  Vault: ${config.vaultDir}`));
    console.log(dim(`  Target: ${hostedUrl}\n`));

    const results = await migrateToHosted({
      vaultDir: config.vaultDir,
      hostedUrl,
      apiKey,
      log: (msg) => console.log(`  ${dim(msg)}`),
    });

    console.log(`\n  ${green("+")} ${results.uploaded} entries uploaded`);
    if (results.failed > 0) {
      console.log(`  ${red("-")} ${results.failed} failed`);
      for (const err of results.errors.slice(0, 5)) {
        console.log(`    ${dim(err)}`);
      }
    }
    console.log(dim("\n  Your local vault was not modified (safe backup)."));
  } else {
    const { migrateToLocal } =
      await import("@context-vault/hosted/migration/migrate");
    console.log(`\n  ${bold("Migrating to local")}...`);
    console.log(dim(`  Source: ${hostedUrl}`));
    console.log(dim(`  Target: ${config.vaultDir}\n`));

    const results = await migrateToLocal({
      vaultDir: config.vaultDir,
      hostedUrl,
      apiKey,
      log: (msg) => console.log(`  ${dim(msg)}`),
    });

    console.log(`\n  ${green("+")} ${results.downloaded} entries restored`);
    if (results.failed > 0) {
      console.log(`  ${red("-")} ${results.failed} failed`);
    }
    console.log(
      dim("\n  Run `context-vault reindex` to rebuild the search index."),
    );
  }
  console.log();
}

async function runImport() {
  const target = args[1];
  if (!target) {
    console.log(`\n  ${bold("context-vault import")} <path>\n`);
    console.log(`  Import entries from a file or directory.\n`);
    console.log(`  Supported formats: .md, .csv, .tsv, .json, .txt\n`);
    console.log(`  Options:`);
    console.log(`    --kind <kind>    Default kind (default: insight)`);
    console.log(`    --source <src>   Default source (default: cli-import)`);
    console.log(`    --dry-run        Show parsed entries without importing`);
    console.log();
    return;
  }

  const { resolveConfig } = await import("@context-vault/core/core/config");
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import("@context-vault/core/index/db");
  const { embed } = await import("@context-vault/core/index/embed");
  const { parseFile, parseDirectory } =
    await import("@context-vault/core/capture/importers");
  const { importEntries } =
    await import("@context-vault/core/capture/import-pipeline");
  const { readFileSync, statSync } = await import("node:fs");

  const kind = getFlag("--kind") || undefined;
  const source = getFlag("--source") || "cli-import";
  const dryRun = flags.has("--dry-run");

  const targetPath = resolve(target);
  if (!existsSync(targetPath)) {
    console.error(red(`  Path not found: ${targetPath}`));
    process.exit(1);
  }

  const stat = statSync(targetPath);
  let entries;

  if (stat.isDirectory()) {
    entries = parseDirectory(targetPath, { kind, source });
  } else {
    const content = readFileSync(targetPath, "utf-8");
    entries = parseFile(targetPath, content, { kind, source });
  }

  if (entries.length === 0) {
    console.log(yellow("  No entries found to import."));
    return;
  }

  console.log(`\n  Found ${bold(String(entries.length))} entries to import\n`);

  if (dryRun) {
    for (let i = 0; i < Math.min(entries.length, 20); i++) {
      const e = entries[i];
      console.log(
        `  ${dim(`[${i + 1}]`)} ${e.kind} — ${e.title || e.body.slice(0, 60)}${e.tags?.length ? ` ${dim(`[${e.tags.join(", ")}]`)}` : ""}`,
      );
    }
    if (entries.length > 20) {
      console.log(dim(`  ... and ${entries.length - 20} more`));
    }
    console.log(dim("\n  Dry run — no entries were imported."));
    return;
  }

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`  Vault directory not found: ${config.vaultDir}`));
    console.error(`  Run ${cyan("context-vault setup")} to configure.`);
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

  console.log(`\r  ${green("✓")} Import complete                    `);
  console.log(`    ${green("+")} ${result.imported} imported`);
  if (result.failed > 0) {
    console.log(`    ${red("x")} ${result.failed} failed`);
    for (const err of result.errors.slice(0, 5)) {
      console.log(`      ${dim(err.error)}`);
    }
  }
  console.log();
}

async function runExport() {
  const format = getFlag("--format") || "json";
  const output = getFlag("--output");
  const rawPageSize = getFlag("--page-size");
  const pageSize = rawPageSize
    ? Math.max(1, parseInt(rawPageSize, 10) || 100)
    : null;

  const { resolveConfig } = await import("@context-vault/core/core/config");
  const { initDatabase, prepareStatements } =
    await import("@context-vault/core/index/db");
  const { writeFileSync } = await import("node:fs");

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(red(`  Vault directory not found: ${config.vaultDir}`));
    process.exit(1);
  }

  const db = await initDatabase(config.dbPath);

  const whereClause =
    "WHERE (expires_at IS NULL OR expires_at > datetime('now'))";

  let entries;
  if (pageSize) {
    // Paginated: fetch in chunks to avoid loading everything into memory
    entries = [];
    let offset = 0;
    const stmt = db.prepare(
      `SELECT * FROM vault ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
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
    const rows = db
      .prepare(`SELECT * FROM vault ${whereClause} ORDER BY created_at DESC`)
      .all();
    entries = rows.map(mapExportRow);
  }

  db.close();

  let content;

  if (format === "csv") {
    const headers = [
      "id",
      "kind",
      "category",
      "title",
      "body",
      "tags",
      "source",
      "identity_key",
      "expires_at",
      "created_at",
    ];
    const csvLines = [headers.join(",")];
    for (const e of entries) {
      const row = headers.map((h) => {
        let val = e[h];
        if (Array.isArray(val)) val = val.join(", ");
        if (val == null) val = "";
        val = String(val);
        if (val.includes(",") || val.includes('"') || val.includes("\n")) {
          val = '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
      });
      csvLines.push(row.join(","));
    }
    content = csvLines.join("\n");
  } else {
    content = JSON.stringify(
      { entries, total: entries.length, exported_at: new Date().toISOString() },
      null,
      2,
    );
  }

  if (output) {
    writeFileSync(resolve(output), content);
    console.log(green(`  ✓ Exported ${entries.length} entries to ${output}`));
  } else {
    process.stdout.write(content);
  }
}

function mapExportRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    title: row.title || null,
    body: row.body || null,
    tags: row.tags ? JSON.parse(row.tags) : [],
    meta: row.meta ? JSON.parse(row.meta) : {},
    source: row.source || null,
    identity_key: row.identity_key || null,
    expires_at: row.expires_at || null,
    created_at: row.created_at,
  };
}

async function runIngest() {
  const url = args[1];
  if (!url) {
    console.log(`\n  ${bold("context-vault ingest")} <url>\n`);
    console.log(`  Fetch a URL and save as a vault entry.\n`);
    console.log(`  Options:`);
    console.log(`    --kind <kind>    Entry kind (default: reference)`);
    console.log(`    --tags t1,t2     Comma-separated tags`);
    console.log(`    --dry-run        Show extracted content without saving`);
    console.log();
    return;
  }

  const { ingestUrl } = await import("@context-vault/core/capture/ingest-url");
  const kind = getFlag("--kind") || undefined;
  const tagsStr = getFlag("--tags");
  const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()) : undefined;
  const dryRun = flags.has("--dry-run");

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
    `  ${dim(`kind: ${entry.kind} | source: ${entry.source} | ${entry.body.length} chars`)}`,
  );
  if (entry.tags?.length)
    console.log(`  ${dim(`tags: ${entry.tags.join(", ")}`)}`);

  if (dryRun) {
    console.log(`\n${dim("  Preview (first 500 chars):")}`);
    console.log(dim("  " + entry.body.slice(0, 500).split("\n").join("\n  ")));
    console.log(dim("\n  Dry run — entry was not saved."));
    return;
  }

  const { resolveConfig } = await import("@context-vault/core/core/config");
  const { initDatabase, prepareStatements, insertVec, deleteVec } =
    await import("@context-vault/core/index/db");
  const { embed } = await import("@context-vault/core/index/embed");
  const { captureAndIndex } = await import("@context-vault/core/capture");

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

  const relPath = result.filePath.replace(config.vaultDir + "/", "");
  console.log(`\n  ${green("✓")} Saved → ${relPath}`);
  console.log(`    id: ${result.id}`);
  console.log();
}

async function runServe() {
  await import("../src/server/index.js");
}

async function main() {
  if (flags.has("--version") || command === "version") {
    console.log(VERSION);
    return;
  }

  if (flags.has("--help") || command === "help" || !command) {
    showHelp();
    return;
  }

  switch (command) {
    case "setup":
      await runSetup();
      break;
    case "connect":
      await runConnect();
      break;
    case "switch":
      await runSwitch();
      break;
    case "serve":
      await runServe();
      break;
    case "import":
      await runImport();
      break;
    case "export":
      await runExport();
      break;
    case "ingest":
      await runIngest();
      break;
    case "reindex":
      await runReindex();
      break;
    case "status":
      await runStatus();
      break;
    case "update":
      await runUpdate();
      break;
    case "uninstall":
      await runUninstall();
      break;
    case "migrate":
      await runMigrate();
      break;
    default:
      console.error(red(`Unknown command: ${command}`));
      console.error(`Run ${cyan("context-vault --help")} for usage.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(red(e.message));
  process.exit(1);
});
