#!/usr/bin/env node

/**
 * context-mcp CLI — Unified entry point
 *
 * Usage:
 *   context-mcp setup              Interactive MCP installer
 *   context-mcp ui [--port 3141]   Launch web dashboard
 *   context-mcp reindex            Rebuild search index
 *   context-mcp status             Show vault diagnostics
 */

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
import { homedir } from "node:os";
import { execSync, fork } from "node:child_process";
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

// ─── ANSI Helpers ────────────────────────────────────────────────────────────

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

// ─── Arg Parsing ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.filter((a) => a.startsWith("--")));
const isNonInteractive = flags.has("--yes") || !process.stdin.isTTY;

function getFlag(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}

// ─── Readline Prompt ─────────────────────────────────────────────────────────

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

// ─── Tool Detection ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    id: "claude-code",
    name: "Claude Code",
    detect: () => {
      try {
        execSync("which claude", { stdio: "pipe" });
        return true;
      } catch {
        return false;
      }
    },
    configType: "cli",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    detect: () =>
      existsSync(join(HOME, "Library", "Application Support", "Claude")),
    configType: "json",
    configPath: join(
      HOME,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json"
    ),
    configKey: "mcpServers",
  },
  {
    id: "cursor",
    name: "Cursor",
    detect: () => existsSync(join(HOME, ".cursor")),
    configType: "json",
    configPath: join(HOME, ".cursor", "mcp.json"),
    configKey: "mcpServers",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    detect: () => existsSync(join(HOME, ".codeium", "windsurf")),
    configType: "json",
    configPath: join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    configKey: "mcpServers",
  },
  {
    id: "cline",
    name: "Cline (VS Code)",
    detect: () =>
      existsSync(
        join(
          HOME,
          "Library",
          "Application Support",
          "Code",
          "User",
          "globalStorage",
          "saoudrizwan.claude-dev",
          "settings"
        )
      ),
    configType: "json",
    configPath: join(
      HOME,
      "Library",
      "Application Support",
      "Code",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json"
    ),
    configKey: "mcpServers",
  },
];

// ─── Help ────────────────────────────────────────────────────────────────────

function showHelp() {
  console.log(`
${bold("context-mcp")} v${VERSION} — Persistent memory for AI agents

${bold("Usage:")}
  context-mcp <command> [options]

${bold("Commands:")}
  ${cyan("setup")}                 Interactive MCP server installer
  ${cyan("serve")}                 Start the MCP server (used by AI clients)
  ${cyan("ui")} [--port 3141]      Launch web dashboard
  ${cyan("reindex")}               Rebuild search index from knowledge files
  ${cyan("status")}                Show vault diagnostics

${bold("Options:")}
  --help                Show this help
  --version             Show version
  --yes                 Non-interactive mode (accept all defaults)
`);
}

// ─── Setup Command ───────────────────────────────────────────────────────────

async function runSetup() {
  // Banner
  console.log();
  console.log(bold("  context-mcp") + dim(` v${VERSION}`));
  console.log(dim("  Persistent memory for AI agents — saves and searches knowledge across sessions"));
  console.log();
  console.log(dim("  Setup will: detect tools, configure MCP, download embeddings, and verify."));
  console.log();

  // Detect tools
  console.log(bold("  Detecting installed tools...\n"));
  const detected = [];
  for (const tool of TOOLS) {
    const found = tool.detect();
    if (found) {
      detected.push(tool);
      console.log(`  ${green("+")} ${tool.name}`);
    } else {
      console.log(`  ${dim("-")} ${dim(tool.name)} ${dim("(not found)")}`);
    }
  }
  console.log();

  if (detected.length === 0) {
    console.log(
      yellow("  No supported tools detected.\n")
    );
    console.log("  To manually configure, add to your tool's MCP config:\n");
    if (isInstalledPackage()) {
      console.log(`  ${dim("{")}
    ${dim('"mcpServers": {')}
      ${dim('"context-mcp": {')}
        ${dim('"command": "context-mcp",')}
        ${dim(`"args": ["serve", "--vault-dir", "/path/to/vault"]`)}
      ${dim("}")}
    ${dim("}")}
  ${dim("}")}\n`);
    } else {
      console.log(`  ${dim("{")}
    ${dim('"mcpServers": {')}
      ${dim('"context-mcp": {')}
        ${dim('"command": "node",')}
        ${dim(`"args": ["${SERVER_PATH}", "--vault-dir", "/path/to/vault"]`)}
      ${dim("}")}
    ${dim("}")}
  ${dim("}")}\n`);
    }
    return;
  }

  // Select tools
  let selected;
  if (isNonInteractive) {
    selected = detected;
  } else {
    console.log(bold("  Which tools should context-mcp connect to?\n"));
    for (let i = 0; i < detected.length; i++) {
      console.log(`    ${i + 1}) ${detected[i].name}`);
    }
    console.log();
    const answer = await prompt(
      `  Select (${dim("1,2,3")} or ${dim('"all"')}):`,
      "all"
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
  const defaultVaultDir = join(HOME, "vault");
  const vaultDir = isNonInteractive
    ? defaultVaultDir
    : await prompt(`\n  Vault directory:`, defaultVaultDir);
  const resolvedVaultDir = resolve(vaultDir);

  // Create vault dir if needed
  if (!existsSync(resolvedVaultDir)) {
    if (isNonInteractive) {
      mkdirSync(resolvedVaultDir, { recursive: true });
      console.log(
        `\n  ${green("+")} Created ${resolvedVaultDir}`
      );
    } else {
      const create = await prompt(
        `\n  ${resolvedVaultDir} doesn't exist. Create it? (Y/n):`,
        "Y"
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
  writeFileSync(configPath, JSON.stringify(vaultConfig, null, 2) + "\n");
  console.log(`\n  ${green("+")} Wrote ${configPath}`);

  // Pre-download embedding model
  console.log(`\n${bold("  Downloading embedding model...")}`);
  console.log(dim("  all-MiniLM-L6-v2 (~22MB, one-time download)\n"));
  try {
    const { embed } = await import("../src/index/embed.js");
    await embed("warmup");
    console.log(`  ${green("+")} Embedding model ready`);
  } catch (e) {
    console.log(`  ${yellow("!")} Model download failed — will retry on first use`);
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
  console.log(`\n${bold("  Configuring tools...\n")}`);
  const results = [];
  const defaultVDir = join(HOME, "vault");
  const customVaultDir = resolvedVaultDir !== resolve(defaultVDir) ? resolvedVaultDir : null;

  for (const tool of selected) {
    try {
      if (tool.configType === "cli") {
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
  const seeded = createSeedEntry(resolvedVaultDir);
  if (seeded) {
    console.log(`\n  ${green("+")} Created starter entry in vault`);
  }

  // Offer to launch UI
  console.log();
  if (!isNonInteractive) {
    const launchUi = await prompt(
      `  Launch web dashboard? (y/N):`,
      "N"
    );
    if (launchUi.toLowerCase() === "y") {
      console.log();
      runUi();
      return;
    }
  }

  // Health check
  const ok = results.filter((r) => r.ok);
  const checks = [
    { label: "Vault directory exists", pass: existsSync(resolvedVaultDir) },
    { label: "Config file written", pass: existsSync(configPath) },
    { label: "At least one tool configured", pass: ok.length > 0 },
  ];
  const passed = checks.filter((c) => c.pass).length;
  console.log(bold(`\n  Health check: ${passed}/${checks.length} passed\n`));
  for (const c of checks) {
    console.log(`  ${c.pass ? green("+") : red("x")} ${c.label}`);
  }

  // First-use guidance
  const toolName = ok.length ? ok[0].tool.name : "your AI tool";
  console.log(bold("\n  What to do next:\n"));
  console.log(`  1. Open ${toolName}`);
  console.log(`  2. Try: ${cyan('"Search my vault for getting started"')}`);
  console.log(`  3. Try: ${cyan('"Save an insight: JavaScript Date objects are mutable"')}`);
  console.log(`\n  Vault:     ${resolvedVaultDir}`);
  console.log(`  Dashboard: ${cyan("context-mcp ui")}`);
  console.log();
}

async function configureClaude(tool, vaultDir) {
  const env = { ...process.env };
  delete env.CLAUDECODE;

  try {
    execSync("claude mcp remove context-mcp -s user", { stdio: "pipe", env });
  } catch {}

  try {
    execSync("claude mcp remove context-vault -s user", { stdio: "pipe", env });
  } catch {}

  if (isInstalledPackage()) {
    const cmdArgs = ["serve"];
    if (vaultDir) cmdArgs.push("--vault-dir", `"${vaultDir}"`);
    execSync(
      `claude mcp add -s user context-mcp -- context-mcp ${cmdArgs.join(" ")}`,
      { stdio: "pipe", env }
    );
  } else {
    const cmdArgs = [`"${SERVER_PATH}"`];
    if (vaultDir) cmdArgs.push("--vault-dir", `"${vaultDir}"`);
    execSync(
      `claude mcp add -s user context-mcp -- node ${cmdArgs.join(" ")}`,
      { stdio: "pipe", env }
    );
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

  delete config[tool.configKey]["context-vault"];

  if (isInstalledPackage()) {
    const serverArgs = ["serve"];
    if (vaultDir) serverArgs.push("--vault-dir", vaultDir);
    config[tool.configKey]["context-mcp"] = {
      command: "context-mcp",
      args: serverArgs,
    };
  } else {
    const serverArgs = [SERVER_PATH];
    if (vaultDir) serverArgs.push("--vault-dir", vaultDir);
    config[tool.configKey]["context-mcp"] = {
      command: "node",
      args: serverArgs,
    };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}

// ─── Seed Entry ─────────────────────────────────────────────────────────────

function createSeedEntry(vaultDir) {
  const seedDir = join(vaultDir, "knowledge", "insights");
  const seedPath = join(seedDir, "getting-started.md");
  if (existsSync(seedPath)) return false;
  mkdirSync(seedDir, { recursive: true });
  const id = Date.now().toString(36).toUpperCase().padStart(10, "0");
  const now = new Date().toISOString();
  const content = `---
id: ${id}
tags: ["getting-started"]
source: context-mcp-setup
created: ${now}
---
Welcome to your context vault! This is a seed entry created during setup.

Your vault stores knowledge as plain markdown files with YAML frontmatter.
AI agents search it using hybrid full-text + semantic search.

Try these commands in your AI tool:
- "Search my vault for getting started"
- "Save an insight: JavaScript Date objects are mutable"
- "Show my vault status"

You can edit or delete this file anytime — it lives at:
${seedPath}
`;
  writeFileSync(seedPath, content);
  return true;
}

// ─── UI Command ──────────────────────────────────────────────────────────────

function runUi() {
  const serveScript = resolve(ROOT, "ui", "serve.js");
  if (!existsSync(serveScript)) {
    console.error(red("Error: ui/serve.js not found."));
    process.exit(1);
  }

  const uiArgs = args.slice(1);
  const child = fork(serveScript, uiArgs, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

// ─── Reindex Command ─────────────────────────────────────────────────────────

async function runReindex() {
  console.log(dim("Loading vault..."));

  const { resolveConfig } = await import("../src/core/config.js");
  const { initDatabase, prepareStatements, insertVec, deleteVec } = await import("../src/index/db.js");
  const { embed } = await import("../src/index/embed.js");
  const { reindex } = await import("../src/index/index.js");

  const config = resolveConfig();
  if (!config.vaultDirExists) {
    console.error(
      red(`Vault directory not found: ${config.vaultDir}`)
    );
    console.error("Run " + cyan("context-mcp setup") + " to configure.");
    process.exit(1);
  }

  const db = initDatabase(config.dbPath);
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
  console.log(green("Reindex complete:"));
  console.log(`  Added:     ${stats.added}`);
  console.log(`  Updated:   ${stats.updated}`);
  console.log(`  Removed:   ${stats.removed}`);
  console.log(`  Unchanged: ${stats.unchanged}`);
}

// ─── Status Command ──────────────────────────────────────────────────────────

async function runStatus() {
  const { resolveConfig } = await import("../src/core/config.js");
  const { initDatabase } = await import("../src/index/db.js");
  const { gatherVaultStatus } = await import("../src/core/status.js");

  const config = resolveConfig();
  const db = initDatabase(config.dbPath);

  const status = gatherVaultStatus({ db, config });

  db.close();

  console.log();
  console.log(bold("  Vault Status"));
  console.log();
  console.log(`  Vault:     ${config.vaultDir} (exists: ${config.vaultDirExists}, ${status.fileCount} files)`);
  console.log(`  Database:  ${config.dbPath} (${status.dbSize})`);
  console.log(`  Dev dir:   ${config.devDir}`);
  console.log(`  Data dir:  ${config.dataDir}`);
  console.log(`  Config:    ${config.configPath} (exists: ${existsSync(config.configPath)})`);
  console.log(`  Resolved:  ${status.resolvedFrom}`);
  console.log(`  Schema:    v5 (categories)`);

  if (status.kindCounts.length) {
    console.log();
    console.log(bold("  Indexed"));
    for (const { kind, c } of status.kindCounts) {
      console.log(`    ${c} ${kind}s`);
    }
  } else {
    console.log(`\n  ${dim("(empty — no entries indexed)")}`);
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
    console.log(`  Run ${cyan("context-mcp reindex")} to update.`);
  }
  console.log();
}

// ─── Serve Command ──────────────────────────────────────────────────────────

async function runServe() {
  await import("../src/server/index.js");
}

// ─── Main Router ─────────────────────────────────────────────────────────────

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
    case "serve":
      await runServe();
      break;
    case "ui":
      runUi();
      break;
    case "import":
    case "export":
      console.log(`Import/export removed. Add .md files to vault/ and run \`context-mcp reindex\`.`);
      break;
    case "reindex":
      await runReindex();
      break;
    case "status":
      await runStatus();
      break;
    default:
      console.error(red(`Unknown command: ${command}`));
      console.error(`Run ${cyan("context-mcp --help")} for usage.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(red(e.message));
  process.exit(1);
});
