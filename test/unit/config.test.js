import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test parseArgs directly and resolveConfig via controlled environments.
// resolveConfig depends on process.argv, process.env, fs, and os — we mock them.

describe("parseArgs", () => {
  let parseArgs;

  beforeEach(async () => {
    ({ parseArgs } = await import("@context-vault/core/core/config"));
  });

  it("returns empty object for no args", () => {
    const result = parseArgs(["node", "script.js"]);
    expect(result).toEqual({});
  });

  it("parses --vault-dir", () => {
    const result = parseArgs(["node", "script.js", "--vault-dir", "/my/vault"]);
    expect(result.vaultDir).toBe("/my/vault");
  });

  it("parses --data-dir", () => {
    const result = parseArgs(["node", "script.js", "--data-dir", "/my/data"]);
    expect(result.dataDir).toBe("/my/data");
  });

  it("parses --db-path", () => {
    const result = parseArgs(["node", "script.js", "--db-path", "/my/db.sqlite"]);
    expect(result.dbPath).toBe("/my/db.sqlite");
  });

  it("parses --dev-dir", () => {
    const result = parseArgs(["node", "script.js", "--dev-dir", "/my/dev"]);
    expect(result.devDir).toBe("/my/dev");
  });

  it("parses --event-decay-days as number", () => {
    const result = parseArgs(["node", "script.js", "--event-decay-days", "14"]);
    expect(result.eventDecayDays).toBe(14);
  });

  it("parses --event-decay-days 0 as number 0", () => {
    const result = parseArgs(["node", "script.js", "--event-decay-days", "0"]);
    expect(result.eventDecayDays).toBe(0);
  });

  it("parses multiple args together", () => {
    const result = parseArgs([
      "node", "script.js",
      "--vault-dir", "/v",
      "--data-dir", "/d",
      "--db-path", "/db",
      "--dev-dir", "/dev",
      "--event-decay-days", "7",
    ]);
    expect(result.vaultDir).toBe("/v");
    expect(result.dataDir).toBe("/d");
    expect(result.dbPath).toBe("/db");
    expect(result.devDir).toBe("/dev");
    expect(result.eventDecayDays).toBe(7);
  });

  it("ignores flags without a following value", () => {
    const result = parseArgs(["node", "script.js", "--vault-dir"]);
    expect(result.vaultDir).toBeUndefined();
  });

  it("ignores unknown flags", () => {
    const result = parseArgs(["node", "script.js", "--unknown", "value"]);
    expect(result).toEqual({});
  });
});

describe("resolveConfig", () => {
  const FAKE_HOME = "/fake/home";
  let resolveConfig;
  let originalEnv;
  let originalArgv;

  // Mocked fs contents — maps path -> file content (string) or undefined
  let mockFiles;

  beforeEach(async () => {
    mockFiles = {};
    originalEnv = { ...process.env };
    originalArgv = [...process.argv];
    process.argv = ["node", "script.js"];

    // Clear all CONTEXT_VAULT_ and CONTEXT_MCP_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("CONTEXT_VAULT_") || key.startsWith("CONTEXT_MCP_")) {
        delete process.env[key];
      }
    }

    // Reset modules first so doMock applies cleanly
    vi.resetModules();

    // Mock os.homedir
    vi.doMock("node:os", () => ({
      homedir: () => FAKE_HOME,
    }));

    // Mock fs
    vi.doMock("node:fs", () => ({
      existsSync: (p) => p in mockFiles,
      readFileSync: (p, _enc) => {
        if (p in mockFiles) return mockFiles[p];
        throw new Error(`ENOENT: no such file or directory, open '${p}'`);
      },
    }));

    // Re-import to pick up fresh mocks
    const mod = await import("@context-vault/core/core/config");
    resolveConfig = mod.resolveConfig;
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // --- Layer 1: Defaults ---

  it("returns convention defaults when nothing is configured", () => {
    const cfg = resolveConfig();
    expect(cfg.vaultDir).toMatch(/vault$/);
    expect(cfg.dataDir).toMatch(/\.context-mcp$/);
    expect(cfg.dbPath).toMatch(/vault\.db$/);
    expect(cfg.devDir).toMatch(/dev$/);
    expect(cfg.eventDecayDays).toBe(30);
    expect(cfg.resolvedFrom).toBe("defaults");
  });

  it("default paths are based on homedir", () => {
    const cfg = resolveConfig();
    expect(cfg.vaultDir).toBe(`${FAKE_HOME}/vault`);
    expect(cfg.dataDir).toBe(`${FAKE_HOME}/.context-mcp`);
    expect(cfg.dbPath).toBe(`${FAKE_HOME}/.context-mcp/vault.db`);
    expect(cfg.devDir).toBe(`${FAKE_HOME}/dev`);
  });

  it("all paths are absolute", () => {
    const cfg = resolveConfig();
    expect(cfg.vaultDir).toMatch(/^\//);
    expect(cfg.dataDir).toMatch(/^\//);
    expect(cfg.dbPath).toMatch(/^\//);
    expect(cfg.devDir).toMatch(/^\//);
  });

  it("sets configPath to dataDir/config.json", () => {
    const cfg = resolveConfig();
    expect(cfg.configPath).toBe(`${FAKE_HOME}/.context-mcp/config.json`);
  });

  // --- Layer 2: Config file ---

  it("config file overrides defaults", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = JSON.stringify({
      vaultDir: "/custom/vault",
      devDir: "/custom/dev",
      eventDecayDays: 14,
    });

    const cfg = resolveConfig();
    expect(cfg.vaultDir).toBe("/custom/vault");
    expect(cfg.devDir).toBe("/custom/dev");
    expect(cfg.eventDecayDays).toBe(14);
    expect(cfg.resolvedFrom).toBe("config file");
  });

  it("config file dbPath override", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = JSON.stringify({
      dbPath: "/custom/my.db",
    });

    const cfg = resolveConfig();
    expect(cfg.dbPath).toBe("/custom/my.db");
  });

  it("config file dataDir also updates dbPath", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = JSON.stringify({
      dataDir: "/custom/data",
    });

    const cfg = resolveConfig();
    expect(cfg.dataDir).toBe("/custom/data");
    expect(cfg.dbPath).toMatch(/\/custom\/data\/vault\.db$/);
  });

  it("config file eventDecayDays: 0 is accepted (not rejected by truthy check)", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = JSON.stringify({
      eventDecayDays: 0,
    });

    const cfg = resolveConfig();
    expect(cfg.eventDecayDays).toBe(0);
  });

  it("partial config file only overrides specified keys", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = JSON.stringify({
      vaultDir: "/only/vault",
    });

    const cfg = resolveConfig();
    expect(cfg.vaultDir).toBe("/only/vault");
    // Other keys should remain at defaults
    expect(cfg.devDir).toBe(`${FAKE_HOME}/dev`);
    expect(cfg.eventDecayDays).toBe(30);
  });

  it("hosted config fields are loaded from config file", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = JSON.stringify({
      hostedUrl: "https://api.example.com",
      apiKey: "sk-test-123",
      userId: "user-abc",
      email: "test@example.com",
      linkedAt: "2026-01-01T00:00:00Z",
    });

    const cfg = resolveConfig();
    expect(cfg.hostedUrl).toBe("https://api.example.com");
    expect(cfg.apiKey).toBe("sk-test-123");
    expect(cfg.userId).toBe("user-abc");
    expect(cfg.email).toBe("test@example.com");
    expect(cfg.linkedAt).toBe("2026-01-01T00:00:00Z");
  });

  it("throws on invalid JSON config file", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = "NOT VALID JSON {{{";

    expect(() => resolveConfig()).toThrow(/Invalid config/);
  });

  it("missing config file is fine (uses defaults)", () => {
    // No files in mockFiles — config file does not exist
    const cfg = resolveConfig();
    expect(cfg.resolvedFrom).toBe("defaults");
  });

  // --- Layer 3: Environment variables ---

  it("CONTEXT_VAULT_* env vars override config file", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = JSON.stringify({
      vaultDir: "/config/vault",
      devDir: "/config/dev",
    });

    process.env.CONTEXT_VAULT_VAULT_DIR = "/env/vault";
    process.env.CONTEXT_VAULT_DEV_DIR = "/env/dev";

    const cfg = resolveConfig();
    expect(cfg.vaultDir).toBe("/env/vault");
    expect(cfg.devDir).toBe("/env/dev");
    expect(cfg.resolvedFrom).toBe("env");
  });

  it("CONTEXT_MCP_* env vars are accepted as fallback", () => {
    process.env.CONTEXT_MCP_VAULT_DIR = "/mcp/vault";
    process.env.CONTEXT_MCP_DEV_DIR = "/mcp/dev";

    const cfg = resolveConfig();
    expect(cfg.vaultDir).toBe("/mcp/vault");
    expect(cfg.devDir).toBe("/mcp/dev");
  });

  it("CONTEXT_VAULT_* takes priority over CONTEXT_MCP_*", () => {
    process.env.CONTEXT_VAULT_VAULT_DIR = "/vault-priority";
    process.env.CONTEXT_MCP_VAULT_DIR = "/mcp-fallback";

    const cfg = resolveConfig();
    expect(cfg.vaultDir).toBe("/vault-priority");
  });

  it("CONTEXT_VAULT_DB_PATH env var overrides dbPath", () => {
    process.env.CONTEXT_VAULT_DB_PATH = "/env/custom.db";

    const cfg = resolveConfig();
    expect(cfg.dbPath).toBe("/env/custom.db");
  });

  it("CONTEXT_VAULT_EVENT_DECAY_DAYS env var is coerced to number", () => {
    process.env.CONTEXT_VAULT_EVENT_DECAY_DAYS = "7";

    const cfg = resolveConfig();
    expect(cfg.eventDecayDays).toBe(7);
    expect(typeof cfg.eventDecayDays).toBe("number");
  });

  it("CONTEXT_VAULT_EVENT_DECAY_DAYS=0 via env is accepted", () => {
    process.env.CONTEXT_VAULT_EVENT_DECAY_DAYS = "0";

    const cfg = resolveConfig();
    expect(cfg.eventDecayDays).toBe(0);
  });

  it("hosted env overrides: CONTEXT_VAULT_API_KEY and CONTEXT_VAULT_HOSTED_URL", () => {
    process.env.CONTEXT_VAULT_API_KEY = "sk-env-key";
    process.env.CONTEXT_VAULT_HOSTED_URL = "https://env.example.com";

    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe("sk-env-key");
    expect(cfg.hostedUrl).toBe("https://env.example.com");
  });

  // --- Layer 4: CLI args ---

  it("CLI args override everything", () => {
    const configPath = `${FAKE_HOME}/.context-mcp/config.json`;
    mockFiles[configPath] = JSON.stringify({
      vaultDir: "/config/vault",
      devDir: "/config/dev",
    });
    process.env.CONTEXT_VAULT_VAULT_DIR = "/env/vault";

    process.argv = [
      "node", "script.js",
      "--vault-dir", "/cli/vault",
      "--dev-dir", "/cli/dev",
    ];

    const cfg = resolveConfig();
    expect(cfg.vaultDir).toBe("/cli/vault");
    expect(cfg.devDir).toBe("/cli/dev");
    expect(cfg.resolvedFrom).toBe("CLI args");
  });

  it("CLI --db-path overrides all other sources", () => {
    process.env.CONTEXT_VAULT_DB_PATH = "/env/db.sqlite";
    process.argv = ["node", "script.js", "--db-path", "/cli/db.sqlite"];

    const cfg = resolveConfig();
    expect(cfg.dbPath).toBe("/cli/db.sqlite");
  });

  it("CLI --event-decay-days 0 overrides everything", () => {
    process.env.CONTEXT_VAULT_EVENT_DECAY_DAYS = "30";
    process.argv = ["node", "script.js", "--event-decay-days", "0"];

    const cfg = resolveConfig();
    expect(cfg.eventDecayDays).toBe(0);
    expect(cfg.resolvedFrom).toBe("CLI args");
  });

  // --- Layer interaction: DATA_DIR env changes configPath ---

  it("CONTEXT_VAULT_DATA_DIR env changes the dataDir and configPath", () => {
    process.env.CONTEXT_VAULT_DATA_DIR = "/env/data";

    const cfg = resolveConfig();
    expect(cfg.dataDir).toBe("/env/data");
    expect(cfg.configPath).toBe("/env/data/config.json");
    expect(cfg.dbPath).toBe("/env/data/vault.db");
  });

  it("CLI --data-dir changes the dataDir and default dbPath", () => {
    process.argv = ["node", "script.js", "--data-dir", "/cli/data"];

    const cfg = resolveConfig();
    expect(cfg.dataDir).toBe("/cli/data");
    // dbPath defaults to dataDir/vault.db when not explicitly set
    expect(cfg.dbPath).toBe("/cli/data/vault.db");
  });

  // --- vaultDirExists ---

  it("vaultDirExists is false when vault dir does not exist", () => {
    const cfg = resolveConfig();
    expect(cfg.vaultDirExists).toBe(false);
  });

  it("vaultDirExists is true when vault dir exists", () => {
    mockFiles[`${FAKE_HOME}/vault`] = "";

    const cfg = resolveConfig();
    expect(cfg.vaultDirExists).toBe(true);
  });
});
