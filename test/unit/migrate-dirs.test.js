/**
 * Unit tests for migrate-dirs: planMigration + executeMigration.
 *
 * Uses real tmpdir so we test actual filesystem behavior
 * without any database or embedding setup.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  PLURAL_TO_SINGULAR,
  planMigration,
  executeMigration,
} from "@context-vault/core/core/migrate-dirs";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeVault() {
  const tmp = mkdtempSync(join(tmpdir(), "cv-migrate-test-"));
  mkdirSync(join(tmp, "knowledge"), { recursive: true });
  mkdirSync(join(tmp, "entities"), { recursive: true });
  mkdirSync(join(tmp, "events"), { recursive: true });
  return tmp;
}

function writeMd(vaultDir, ...parts) {
  const filePath = join(vaultDir, ...parts);
  mkdirSync(join(vaultDir, ...parts.slice(0, -1)), { recursive: true });
  writeFileSync(
    filePath,
    `---\nid: test-${Math.random().toString(36).slice(2)}\ntags: []\nsource: test\ncreated: 2026-01-01T00:00:00Z\n---\nTest content\n`,
  );
  return filePath;
}

// ─── PLURAL_TO_SINGULAR map ──────────────────────────────────────────────────

describe("PLURAL_TO_SINGULAR", () => {
  it("maps known plural dir names to singular", () => {
    expect(PLURAL_TO_SINGULAR["insights"]).toBe("insight");
    expect(PLURAL_TO_SINGULAR["decisions"]).toBe("decision");
    expect(PLURAL_TO_SINGULAR["sessions"]).toBe("session");
    expect(PLURAL_TO_SINGULAR["logs"]).toBe("log");
    expect(PLURAL_TO_SINGULAR["contacts"]).toBe("contact");
  });

  it("covers irregular plurals", () => {
    expect(PLURAL_TO_SINGULAR["analyses"]).toBe("analysis");
    expect(PLURAL_TO_SINGULAR["statuses"]).toBe("status");
    expect(PLURAL_TO_SINGULAR["companies"]).toBe("company");
    expect(PLURAL_TO_SINGULAR["discoveries"]).toBe("discovery");
  });

  it("covers hyphenated plurals", () => {
    expect(PLURAL_TO_SINGULAR["session-summaries"]).toBe("session-summary");
    expect(PLURAL_TO_SINGULAR["session-reviews"]).toBe("session-review");
    expect(PLURAL_TO_SINGULAR["user-prompts"]).toBe("user-prompt");
  });

  it("has no duplicate values (no two plural forms map to the same singular)", () => {
    const values = Object.values(PLURAL_TO_SINGULAR);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });
});

// ─── planMigration ──────────────────────────────────────────────────────────

describe("planMigration", () => {
  let vaultDir;

  beforeEach(() => {
    vaultDir = makeVault();
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
  });

  it("returns empty array when vault has no plural dirs", () => {
    writeMd(vaultDir, "knowledge", "insight", "entry.md");
    expect(planMigration(vaultDir)).toEqual([]);
  });

  it("detects a single plural dir as a rename op", () => {
    writeMd(vaultDir, "knowledge", "insights", "entry.md");
    const ops = planMigration(vaultDir);
    expect(ops).toHaveLength(1);
    expect(ops[0].action).toBe("rename");
    expect(ops[0].pluralName).toBe("insights");
    expect(ops[0].singularName).toBe("insight");
    expect(ops[0].fileCount).toBe(1);
    expect(ops[0].pluralDir).toContain("knowledge/insights");
    expect(ops[0].singularDir).toContain("knowledge/insight");
  });

  it("detects merge op when both plural and singular dirs exist", () => {
    writeMd(vaultDir, "knowledge", "decisions", "old-decision.md");
    writeMd(vaultDir, "knowledge", "decision", "new-decision.md");

    const ops = planMigration(vaultDir);
    expect(ops).toHaveLength(1);
    expect(ops[0].action).toBe("merge");
    expect(ops[0].pluralName).toBe("decisions");
    expect(ops[0].singularName).toBe("decision");
    expect(ops[0].fileCount).toBe(1);
  });

  it("counts files correctly for multi-file plural dir", () => {
    writeMd(vaultDir, "knowledge", "insights", "a.md");
    writeMd(vaultDir, "knowledge", "insights", "b.md");
    writeMd(vaultDir, "knowledge", "insights", "c.md");

    const ops = planMigration(vaultDir);
    expect(ops[0].fileCount).toBe(3);
  });

  it("counts files in nested subdirectories", () => {
    writeMd(vaultDir, "knowledge", "decisions", "direct.md");
    writeMd(vaultDir, "knowledge", "decisions", "subproject", "nested.md");

    const ops = planMigration(vaultDir);
    expect(ops[0].fileCount).toBe(2);
  });

  it("ignores dirs that are already singular", () => {
    writeMd(vaultDir, "knowledge", "insight", "entry.md");
    writeMd(vaultDir, "knowledge", "decision", "entry.md");
    expect(planMigration(vaultDir)).toHaveLength(0);
  });

  it("ignores unknown dir names not in PLURAL_TO_SINGULAR", () => {
    writeMd(vaultDir, "knowledge", "custom-kind", "entry.md");
    expect(planMigration(vaultDir)).toHaveLength(0);
  });

  it("detects plural dirs in entities/ category", () => {
    writeMd(vaultDir, "entities", "contacts", "alice.md");
    const ops = planMigration(vaultDir);
    expect(ops).toHaveLength(1);
    expect(ops[0].pluralName).toBe("contacts");
    expect(ops[0].singularName).toBe("contact");
  });

  it("detects plural dirs in events/ category", () => {
    writeMd(vaultDir, "events", "sessions", "sess1.md");
    const ops = planMigration(vaultDir);
    expect(ops).toHaveLength(1);
    expect(ops[0].pluralName).toBe("sessions");
    expect(ops[0].singularName).toBe("session");
  });

  it("detects multiple plural dirs across categories in one pass", () => {
    writeMd(vaultDir, "knowledge", "insights", "i.md");
    writeMd(vaultDir, "entities", "contacts", "c.md");
    writeMd(vaultDir, "events", "sessions", "s.md");

    const ops = planMigration(vaultDir);
    expect(ops).toHaveLength(3);
    const pluralNames = ops.map((o) => o.pluralName).sort();
    expect(pluralNames).toEqual(["contacts", "insights", "sessions"]);
  });

  it("returns empty array when vault dir does not exist", () => {
    expect(planMigration("/does/not/exist/vault")).toEqual([]);
  });

  it("returns empty array when category dirs are missing", () => {
    const empty = mkdtempSync(join(tmpdir(), "cv-empty-vault-"));
    try {
      expect(planMigration(empty)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

// ─── executeMigration ────────────────────────────────────────────────────────

describe("executeMigration", () => {
  let vaultDir;

  beforeEach(() => {
    vaultDir = makeVault();
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
  });

  it("renames a plural dir to singular", () => {
    writeMd(vaultDir, "knowledge", "insights", "entry.md");
    const ops = planMigration(vaultDir);
    const result = executeMigration(ops);

    expect(result.renamed).toBe(1);
    expect(result.merged).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(existsSync(join(vaultDir, "knowledge", "insight"))).toBe(true);
    expect(existsSync(join(vaultDir, "knowledge", "insights"))).toBe(false);
    expect(existsSync(join(vaultDir, "knowledge", "insight", "entry.md"))).toBe(
      true,
    );
  });

  it("merges plural dir into existing singular dir", () => {
    writeMd(vaultDir, "knowledge", "decisions", "old.md");
    writeMd(vaultDir, "knowledge", "decision", "new.md");

    const ops = planMigration(vaultDir);
    expect(ops[0].action).toBe("merge");

    const result = executeMigration(ops);
    expect(result.renamed).toBe(0);
    expect(result.merged).toBe(1);
    expect(result.errors).toHaveLength(0);

    // plural dir removed
    expect(existsSync(join(vaultDir, "knowledge", "decisions"))).toBe(false);
    // both files now in singular dir
    expect(existsSync(join(vaultDir, "knowledge", "decision", "old.md"))).toBe(
      true,
    );
    expect(existsSync(join(vaultDir, "knowledge", "decision", "new.md"))).toBe(
      true,
    );
  });

  it("does not overwrite files that already exist in singular dir during merge", () => {
    // Both dirs have a file with the same name — singular dir's copy must be preserved
    writeMd(vaultDir, "knowledge", "decisions", "shared.md");
    const singularFile = writeMd(
      vaultDir,
      "knowledge",
      "decision",
      "shared.md",
    );

    // Overwrite singular's shared.md with distinct content to detect clobbering
    writeFileSync(
      singularFile,
      "---\nid: KEEPER\ntags: []\nsource: test\ncreated: 2026-01-01T00:00:00Z\n---\nKeeper content\n",
    );

    const ops = planMigration(vaultDir);
    executeMigration(ops);

    const content = readFileSync(
      join(vaultDir, "knowledge", "decision", "shared.md"),
      "utf-8",
    );
    expect(content).toContain("KEEPER");
  });

  it("preserves nested subdirs during merge", () => {
    writeMd(vaultDir, "knowledge", "decisions", "proj", "nested.md");
    writeMd(vaultDir, "knowledge", "decision", "existing.md");

    const ops = planMigration(vaultDir);
    executeMigration(ops);

    expect(
      existsSync(join(vaultDir, "knowledge", "decision", "proj", "nested.md")),
    ).toBe(true);
    expect(
      existsSync(join(vaultDir, "knowledge", "decision", "existing.md")),
    ).toBe(true);
  });

  it("is idempotent — running on already-migrated vault does nothing", () => {
    writeMd(vaultDir, "knowledge", "insight", "entry.md");

    const ops = planMigration(vaultDir);
    expect(ops).toHaveLength(0);

    const result = executeMigration(ops);
    expect(result.renamed).toBe(0);
    expect(result.merged).toBe(0);
  });

  it("handles multiple ops in a single call", () => {
    writeMd(vaultDir, "knowledge", "insights", "i.md");
    writeMd(vaultDir, "knowledge", "decisions", "d.md");
    writeMd(vaultDir, "entities", "contacts", "c.md");

    const ops = planMigration(vaultDir);
    expect(ops).toHaveLength(3);

    const result = executeMigration(ops);
    expect(result.renamed).toBe(3);
    expect(result.merged).toBe(0);
    expect(result.errors).toHaveLength(0);

    expect(existsSync(join(vaultDir, "knowledge", "insight", "i.md"))).toBe(
      true,
    );
    expect(existsSync(join(vaultDir, "knowledge", "decision", "d.md"))).toBe(
      true,
    );
    expect(existsSync(join(vaultDir, "entities", "contact", "c.md"))).toBe(
      true,
    );
  });

  it("returns empty result for empty ops array", () => {
    const result = executeMigration([]);
    expect(result.renamed).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── dry-run behavior (planMigration does not modify) ────────────────────────

describe("planMigration is read-only (dry-run safety)", () => {
  let vaultDir;

  beforeEach(() => {
    vaultDir = makeVault();
  });

  afterEach(() => {
    rmSync(vaultDir, { recursive: true, force: true });
  });

  it("does not rename dirs when only planMigration is called", () => {
    writeMd(vaultDir, "knowledge", "insights", "entry.md");
    planMigration(vaultDir);

    // plural dir still exists, singular does not
    expect(existsSync(join(vaultDir, "knowledge", "insights"))).toBe(true);
    expect(existsSync(join(vaultDir, "knowledge", "insight"))).toBe(false);
  });

  it("calling planMigration twice yields the same ops", () => {
    writeMd(vaultDir, "knowledge", "insights", "a.md");
    writeMd(vaultDir, "knowledge", "decisions", "b.md");

    const ops1 = planMigration(vaultDir);
    const ops2 = planMigration(vaultDir);

    expect(ops1).toHaveLength(ops2.length);
    expect(ops1.map((o) => o.pluralName).sort()).toEqual(
      ops2.map((o) => o.pluralName).sort(),
    );
  });
});
