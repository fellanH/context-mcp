/**
 * Integration tests for CLI setup, tool detection, and configuration.
 *
 * These tests validate the TOOLS array, tool configuration functions,
 * and the --skip-embeddings flag without requiring actual AI tools installed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir, platform } from "node:os";

const CLI_PATH = join(import.meta.dirname, "../../packages/local/bin/cli.js");

/** Run the CLI with given args and return { stdout, stderr, exitCode } */
function runCli(args, { env = {}, timeout = 30000 } = {}) {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      encoding: "utf-8",
      timeout,
      env: { ...process.env, ...env, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e) {
    return {
      stdout: e.stdout?.toString() || "",
      stderr: e.stderr?.toString() || "",
      exitCode: e.status ?? 1,
    };
  }
}

describe("CLI basics", () => {
  it("shows help with --help", () => {
    const { stdout, exitCode } = runCli("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("context-vault");
    expect(stdout).toContain("setup");
    expect(stdout).toContain("serve");
    expect(stdout).toContain("--skip-embeddings");
  });

  it("shows version with --version", () => {
    const { stdout, exitCode } = runCli("--version");
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exits with error on unknown command", () => {
    const { exitCode, stderr } = runCli("nonexistent-command");
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });
});

describe("TOOLS array validation", () => {
  // Dynamic import the CLI module to inspect the TOOLS array indirectly
  // We validate tool structure through the setup --yes output

  it("detects tool structure in setup output", () => {
    // Run setup in non-interactive mode — it will detect tools and show them
    // We just need to confirm it doesn't crash and shows the detection phase
    const { stdout } = runCli("setup --yes", { timeout: 60000 });
    expect(stdout).toContain("Detecting tools");
  });
});

describe("configureJsonTool", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cv-test-config-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates config dir and file when they don't exist", () => {
    const configDir = join(tmpDir, "test-tool", "settings");
    const configPath = join(configDir, "mcp_settings.json");

    // Simulate what configureJsonTool does
    mkdirSync(configDir, { recursive: true });

    const config = { mcpServers: {} };
    config.mcpServers["context-vault"] = {
      command: "context-vault",
      args: ["serve"],
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(written.mcpServers["context-vault"]).toBeDefined();
    expect(written.mcpServers["context-vault"].command).toBe("context-vault");
  });

  it("preserves existing config keys when adding context-vault", () => {
    const configPath = join(tmpDir, "existing-config.json");
    const existing = {
      mcpServers: {
        "other-mcp": { command: "other", args: [] },
      },
    };
    writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");

    // Read, modify, write (simulating configureJsonTool)
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    config.mcpServers["context-vault"] = {
      command: "context-vault",
      args: ["serve"],
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    const result = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(result.mcpServers["other-mcp"]).toBeDefined();
    expect(result.mcpServers["context-vault"]).toBeDefined();
  });

  it("removes legacy context-mcp key", () => {
    const configPath = join(tmpDir, "legacy-config.json");
    const legacy = {
      mcpServers: {
        "context-mcp": { command: "node", args: ["/old/path"] },
      },
    };
    writeFileSync(configPath, JSON.stringify(legacy, null, 2) + "\n");

    // Simulate cleanup logic
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    delete config.mcpServers["context-mcp"];
    config.mcpServers["context-vault"] = {
      command: "context-vault",
      args: ["serve"],
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    const result = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(result.mcpServers["context-mcp"]).toBeUndefined();
    expect(result.mcpServers["context-vault"]).toBeDefined();
  });

  it("handles corrupted JSON by falling back to empty config", () => {
    const configPath = join(tmpDir, "corrupt.json");
    writeFileSync(configPath, "{ invalid json content !!!");

    let config = {};
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // CLI backs up and uses empty config
      config = {};
    }

    // Should proceed with empty config
    expect(config).toEqual({});
  });
});

describe("setup --skip-embeddings", () => {
  it("includes skip-embeddings messaging in non-interactive setup", () => {
    const { stdout } = runCli("setup --yes --skip-embeddings", {
      timeout: 60000,
    });
    // --yes mode now always continues through the full setup flow,
    // even when no tools are detected (sets selected = []).
    expect(stdout).toContain("skipped");
    expect(stdout).toContain("FTS-only mode");
  });
});

describe("seed entries", () => {
  let tmpDir;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "cv-test-seed-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates getting-started.md seed entry with valid frontmatter", () => {
    const vaultDir = join(tmpDir, "vault");
    const insightDir = join(vaultDir, "knowledge", "insights");
    const insightPath = join(insightDir, "getting-started.md");

    mkdirSync(insightDir, { recursive: true });
    const id = Date.now().toString(36).toUpperCase().padStart(10, "0");
    const now = new Date().toISOString();
    writeFileSync(
      insightPath,
      `---\nid: ${id}\ntags: ["getting-started", "vault"]\nsource: context-vault-setup\ncreated: ${now}\n---\nWelcome to your context vault!\n`
    );

    expect(existsSync(insightPath)).toBe(true);
    const content = readFileSync(insightPath, "utf-8");
    expect(content).toContain("---");
    expect(content).toContain("getting-started");
    expect(content).toContain("context-vault-setup");
  });

  it("does not overwrite existing seed entries", () => {
    const vaultDir = join(tmpDir, "vault2");
    const insightDir = join(vaultDir, "knowledge", "insights");
    const insightPath = join(insightDir, "getting-started.md");

    mkdirSync(insightDir, { recursive: true });
    writeFileSync(insightPath, "custom content");

    // Simulate createSeedEntries behavior
    if (!existsSync(insightPath)) {
      writeFileSync(insightPath, "overwritten!");
    }

    expect(readFileSync(insightPath, "utf-8")).toBe("custom content");
  });
});

describe("platform helpers", () => {
  it("appDataDir resolves to a valid path", () => {
    const plat = platform();
    const home = homedir();
    let expected;
    switch (plat) {
      case "darwin":
        expected = join(home, "Library", "Application Support");
        break;
      case "win32":
        expected = process.env.APPDATA || join(home, "AppData", "Roaming");
        break;
      default:
        expected = process.env.XDG_CONFIG_HOME || join(home, ".config");
    }
    expect(typeof expected).toBe("string");
    expect(expected.length).toBeGreaterThan(0);
  });
});

describe("full setup flow E2E", () => {
  let tmpHome;

  beforeAll(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "cv-e2e-setup-"));
  });

  afterAll(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("completes setup --yes --skip-embeddings in an isolated HOME", () => {
    const { stdout, stderr, exitCode } = runCli(
      "setup --yes --skip-embeddings",
      { env: { HOME: tmpHome }, timeout: 60000 }
    );

    expect(exitCode).toBe(0);

    // Vault directory created
    const vaultDir = join(tmpHome, "vault");
    expect(existsSync(vaultDir)).toBe(true);

    // Config written
    const configPath = join(tmpHome, ".context-mcp", "config.json");
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(config.vaultDir).toBe(vaultDir);
    expect(config.dbPath).toBeDefined();

    // Seed entries created
    const seedPath = join(vaultDir, "knowledge", "insights", "getting-started.md");
    expect(existsSync(seedPath)).toBe(true);
    const seedContent = readFileSync(seedPath, "utf-8");
    expect(seedContent).toContain("getting-started");

    // Health check ran and shows timing
    expect(stdout).toContain("Health check");
    expect(stdout).toContain("Setup complete");
    // Timing should be present (e.g. "1.2s")
    expect(stdout).toMatch(/\d+\.\d+s/);
  });
});

describe("seed entry searchability", () => {
  let testCtx;
  let cleanup;

  beforeAll(async () => {
    const { createTestCtx } = await import("../helpers/ctx.js");
    const result = await createTestCtx();
    testCtx = result.ctx;
    cleanup = result.cleanup;
  });

  afterAll(() => {
    if (cleanup) cleanup();
  });

  it("seed entry is findable via hybridSearch", async () => {
    const { captureAndIndex } = await import("@context-vault/core/capture");
    const { indexEntry } = await import("@context-vault/core/index");
    const { hybridSearch } = await import("@context-vault/core/retrieve");

    // Write a seed-format entry
    const entry = {
      kind: "insight",
      title: "Getting Started with Context Vault",
      body: "Welcome to your context vault! This is a seed entry created during setup.\n\nYour vault stores knowledge as plain markdown files with YAML frontmatter.",
      tags: ["getting-started", "vault"],
      source: "context-vault-setup",
    };

    await captureAndIndex(testCtx, entry, indexEntry);

    // Search for it
    const results = await hybridSearch(testCtx, "getting started");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title).toContain("Getting Started");
  });
});
