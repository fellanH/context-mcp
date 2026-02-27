/**
 * Tests for config hot-reload (issue #144).
 *
 * Verifies that the Object.defineProperty getter pattern used in the server
 * causes ctx.config to return fresh values when config.json changes on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveConfig } from "@context-vault/core/core/config";

describe("config hot-reload via ctx getter", () => {
  let tmp, configPath, originalArgv;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cv-hot-reload-"));
    configPath = join(tmp, "config.json");
    mkdirSync(join(tmp, "vault-a"), { recursive: true });
    mkdirSync(join(tmp, "vault-b"), { recursive: true });

    originalArgv = [...process.argv];
    process.argv = ["node", "script.js", "--data-dir", tmp];
  });

  afterEach(() => {
    process.argv = originalArgv;
    rmSync(tmp, { recursive: true, force: true });
  });

  it("picks up vaultDir change from config.json without restart", () => {
    const vaultA = join(tmp, "vault-a");
    const vaultB = join(tmp, "vault-b");
    writeFileSync(configPath, JSON.stringify({ vaultDir: vaultA }));

    const ctx = {};
    let lastVaultDir = resolveConfig().vaultDir;
    Object.defineProperty(ctx, "config", {
      get() {
        const fresh = resolveConfig();
        if (fresh.vaultDir !== lastVaultDir) lastVaultDir = fresh.vaultDir;
        return fresh;
      },
      configurable: true,
    });

    expect(ctx.config.vaultDir).toBe(vaultA);

    writeFileSync(configPath, JSON.stringify({ vaultDir: vaultB }));

    expect(ctx.config.vaultDir).toBe(vaultB);
  });

  it("destructured config captures a snapshot (one read per tool call)", () => {
    const vaultA = join(tmp, "vault-a");
    const vaultB = join(tmp, "vault-b");
    writeFileSync(configPath, JSON.stringify({ vaultDir: vaultA }));

    const ctx = {};
    Object.defineProperty(ctx, "config", {
      get: () => resolveConfig(),
      configurable: true,
    });

    const { config } = ctx;
    expect(config.vaultDir).toBe(vaultA);

    writeFileSync(configPath, JSON.stringify({ vaultDir: vaultB }));

    expect(config.vaultDir).toBe(vaultA);
    expect(ctx.config.vaultDir).toBe(vaultB);
  });

  it("resolvedFrom reflects config file source after reload", () => {
    writeFileSync(
      configPath,
      JSON.stringify({ vaultDir: join(tmp, "vault-a") }),
    );

    const ctx = {};
    Object.defineProperty(ctx, "config", {
      get: () => resolveConfig(),
      configurable: true,
    });

    expect(ctx.config.resolvedFrom).toBe("config file");
  });

  it("updates eventDecayDays on config change", () => {
    writeFileSync(configPath, JSON.stringify({ eventDecayDays: 14 }));

    const ctx = {};
    Object.defineProperty(ctx, "config", {
      get: () => resolveConfig(),
      configurable: true,
    });

    expect(ctx.config.eventDecayDays).toBe(14);

    writeFileSync(configPath, JSON.stringify({ eventDecayDays: 7 }));

    expect(ctx.config.eventDecayDays).toBe(7);
  });
});
