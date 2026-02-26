/**
 * Unit tests for the session-end hook script.
 *
 * Tests parseTranscriptLines, buildSummary, and formatDuration in isolation
 * without requiring a real Claude Code session or vault database.
 */
import { describe, it, expect } from "vitest";
import {
  parseTranscriptLines,
  buildSummary,
  formatDuration,
} from "../../packages/local/src/hooks/session-end.mjs";
import {
  existsSync as fsExistsSync,
  readFileSync as fsReadFileSync,
  mkdirSync as fsMkdirSync,
  rmSync as fsRmSync,
} from "node:fs";
import { join as pathJoin } from "node:path";
import { tmpdir as osTmpdir } from "node:os";
import { execSync as childExecSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI_PATH = fileURLToPath(
  new URL("../../packages/local/bin/cli.js", import.meta.url),
);

// ─── parseTranscriptLines ─────────────────────────────────────────────────────

describe("parseTranscriptLines — basic parsing", () => {
  it("returns empty sets and null times for empty input", () => {
    const result = parseTranscriptLines([]);
    expect(result.filesRead.size).toBe(0);
    expect(result.filesModified.size).toBe(0);
    expect(result.searchPatterns.size).toBe(0);
    expect(result.toolCounts).toEqual({});
    expect(result.startTime).toBeNull();
    expect(result.endTime).toBeNull();
  });

  it("skips non-JSON lines silently", () => {
    const result = parseTranscriptLines(["not json", "also not json", "{}"]);
    expect(result.filesRead.size).toBe(0);
    expect(result.toolCounts).toEqual({});
  });

  it("parses timestamps for start and end time", () => {
    const t1 = "2025-01-01T10:00:00.000Z";
    const t2 = "2025-01-01T10:30:00.000Z";
    const lines = [
      JSON.stringify({ timestamp: t2, message: { content: [] } }),
      JSON.stringify({ timestamp: t1, message: { content: [] } }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result.startTime?.toISOString()).toBe(t1);
    expect(result.endTime?.toISOString()).toBe(t2);
  });

  it("skips entries without a message field", () => {
    const lines = [
      JSON.stringify({ timestamp: "2025-01-01T10:00:00.000Z", other: "data" }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result.toolCounts).toEqual({});
  });

  it("skips entries where content is not an array", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-01T10:00:00.000Z",
        message: { content: "not an array" },
      }),
    ];
    const result = parseTranscriptLines(lines);
    expect(result.toolCounts).toEqual({});
  });
});

// ─── parseTranscriptLines — tool tracking ────────────────────────────────────

describe("parseTranscriptLines — tool use counting", () => {
  function makeLine(
    toolName,
    input = {},
    timestamp = "2025-01-01T10:00:00.000Z",
  ) {
    return JSON.stringify({
      timestamp,
      message: {
        content: [{ type: "tool_use", name: toolName, input }],
      },
    });
  }

  it("counts tool uses correctly", () => {
    const lines = [
      makeLine("Read"),
      makeLine("Read"),
      makeLine("Write"),
      makeLine("Bash"),
    ];
    const { toolCounts } = parseTranscriptLines(lines);
    expect(toolCounts["Read"]).toBe(2);
    expect(toolCounts["Write"]).toBe(1);
    expect(toolCounts["Bash"]).toBe(1);
  });

  it("ignores non-tool_use content blocks", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-01T10:00:00.000Z",
        message: {
          content: [
            { type: "text", text: "some text" },
            { type: "tool_result", content: "result" },
          ],
        },
      }),
    ];
    const { toolCounts } = parseTranscriptLines(lines);
    expect(Object.keys(toolCounts)).toHaveLength(0);
  });

  it("uses 'unknown' for tool_use blocks with no name", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2025-01-01T10:00:00.000Z",
        message: {
          content: [{ type: "tool_use", input: {} }],
        },
      }),
    ];
    const { toolCounts } = parseTranscriptLines(lines);
    expect(toolCounts["unknown"]).toBe(1);
  });
});

// ─── parseTranscriptLines — file tracking ────────────────────────────────────

describe("parseTranscriptLines — file tracking", () => {
  function makeLine(toolName, input, timestamp = "2025-01-01T10:00:00.000Z") {
    return JSON.stringify({
      timestamp,
      message: { content: [{ type: "tool_use", name: toolName, input }] },
    });
  }

  it("tracks Read tool file_path in filesRead", () => {
    const lines = [
      makeLine("Read", { file_path: "/home/user/project/foo.js" }),
    ];
    const { filesRead } = parseTranscriptLines(lines);
    expect(filesRead.has("/home/user/project/foo.js")).toBe(true);
  });

  it("tracks read_file alias in filesRead", () => {
    const lines = [makeLine("read_file", { file_path: "/src/bar.ts" })];
    const { filesRead } = parseTranscriptLines(lines);
    expect(filesRead.has("/src/bar.ts")).toBe(true);
  });

  it("tracks Write tool file_path in filesModified", () => {
    const lines = [makeLine("Write", { file_path: "/src/output.js" })];
    const { filesModified } = parseTranscriptLines(lines);
    expect(filesModified.has("/src/output.js")).toBe(true);
  });

  it("tracks Edit tool file_path in filesModified", () => {
    const lines = [makeLine("Edit", { file_path: "/src/config.json" })];
    const { filesModified } = parseTranscriptLines(lines);
    expect(filesModified.has("/src/config.json")).toBe(true);
  });

  it("tracks NotebookEdit notebook_path in filesModified", () => {
    const lines = [
      makeLine("NotebookEdit", { notebook_path: "/notebooks/analysis.ipynb" }),
    ];
    const { filesModified } = parseTranscriptLines(lines);
    expect(filesModified.has("/notebooks/analysis.ipynb")).toBe(true);
  });

  it("does not add file when path is missing from input", () => {
    const lines = [makeLine("Read", {})];
    const { filesRead } = parseTranscriptLines(lines);
    expect(filesRead.size).toBe(0);
  });

  it("deduplicates repeated reads of the same file", () => {
    const lines = [
      makeLine("Read", { file_path: "/src/foo.js" }),
      makeLine("Read", { file_path: "/src/foo.js" }),
      makeLine("Read", { file_path: "/src/foo.js" }),
    ];
    const { filesRead } = parseTranscriptLines(lines);
    expect(filesRead.size).toBe(1);
  });
});

// ─── parseTranscriptLines — search pattern tracking ───────────────────────────

describe("parseTranscriptLines — search pattern tracking", () => {
  function makeLine(toolName, input, timestamp = "2025-01-01T10:00:00.000Z") {
    return JSON.stringify({
      timestamp,
      message: { content: [{ type: "tool_use", name: toolName, input }] },
    });
  }

  it("tracks Grep pattern in searchPatterns", () => {
    const lines = [makeLine("Grep", { pattern: "import.*React" })];
    const { searchPatterns } = parseTranscriptLines(lines);
    expect(searchPatterns.has("import.*React")).toBe(true);
  });

  it("tracks Glob pattern in searchPatterns", () => {
    const lines = [makeLine("Glob", { pattern: "**/*.test.js" })];
    const { searchPatterns } = parseTranscriptLines(lines);
    expect(searchPatterns.has("**/*.test.js")).toBe(true);
  });

  it("tracks WebSearch query in searchPatterns", () => {
    const lines = [makeLine("WebSearch", { query: "sqlite vec extension" })];
    const { searchPatterns } = parseTranscriptLines(lines);
    expect(searchPatterns.has("sqlite vec extension")).toBe(true);
  });

  it("extracts grep pattern from Bash command", () => {
    const lines = [makeLine("Bash", { command: "grep -r 'useEffect' src/" })];
    const { searchPatterns } = parseTranscriptLines(lines);
    expect([...searchPatterns].some((p) => p.includes("useEffect"))).toBe(true);
  });

  it("extracts rg pattern from Bash command", () => {
    const lines = [makeLine("Bash", { command: "rg -n 'createServer' lib/" })];
    const { searchPatterns } = parseTranscriptLines(lines);
    expect([...searchPatterns].some((p) => p.includes("createServer"))).toBe(
      true,
    );
  });

  it("skips search patterns with no input query", () => {
    const lines = [makeLine("Grep", {})];
    const { searchPatterns } = parseTranscriptLines(lines);
    expect(searchPatterns.size).toBe(0);
  });
});

// ─── formatDuration ───────────────────────────────────────────────────────────

describe("formatDuration", () => {
  it("returns null when start or end is missing", () => {
    expect(formatDuration(null, null)).toBeNull();
    expect(formatDuration(new Date(), null)).toBeNull();
    expect(formatDuration(null, new Date())).toBeNull();
  });

  it("formats seconds-only duration", () => {
    const start = new Date("2025-01-01T10:00:00Z");
    const end = new Date("2025-01-01T10:00:45Z");
    expect(formatDuration(start, end)).toBe("45s");
  });

  it("formats minutes and seconds duration", () => {
    const start = new Date("2025-01-01T10:00:00Z");
    const end = new Date("2025-01-01T10:03:20Z");
    expect(formatDuration(start, end)).toBe("3m 20s");
  });

  it("formats hours and minutes duration", () => {
    const start = new Date("2025-01-01T09:00:00Z");
    const end = new Date("2025-01-01T11:15:00Z");
    expect(formatDuration(start, end)).toBe("2h 15m");
  });

  it("formats zero seconds as 0s", () => {
    const t = new Date("2025-01-01T10:00:00Z");
    expect(formatDuration(t, t)).toBe("0s");
  });
});

// ─── buildSummary ─────────────────────────────────────────────────────────────

describe("buildSummary", () => {
  it("includes Session Summary heading", () => {
    const result = buildSummary({
      filesRead: new Set(),
      filesModified: new Set(),
      searchPatterns: new Set(),
      toolCounts: {},
      startTime: null,
      endTime: null,
    });
    expect(result).toContain("## Session Summary");
  });

  it("includes duration when start and end times are provided", () => {
    const start = new Date("2025-01-01T10:00:00Z");
    const end = new Date("2025-01-01T10:30:00Z");
    const result = buildSummary({
      filesRead: new Set(),
      filesModified: new Set(),
      searchPatterns: new Set(),
      toolCounts: {},
      startTime: start,
      endTime: end,
    });
    expect(result).toContain("**Duration**");
    expect(result).toContain("30m");
  });

  it("omits duration when times are null", () => {
    const result = buildSummary({
      filesRead: new Set(),
      filesModified: new Set(),
      searchPatterns: new Set(),
      toolCounts: {},
      startTime: null,
      endTime: null,
    });
    expect(result).not.toContain("**Duration**");
  });

  it("lists files read", () => {
    const result = buildSummary({
      filesRead: new Set(["/src/foo.js", "/src/bar.js"]),
      filesModified: new Set(),
      searchPatterns: new Set(),
      toolCounts: {},
      startTime: null,
      endTime: null,
    });
    expect(result).toContain("**Files read**");
    expect(result).toContain("/src/foo.js");
    expect(result).toContain("/src/bar.js");
  });

  it("lists files modified", () => {
    const result = buildSummary({
      filesRead: new Set(),
      filesModified: new Set(["/src/output.js"]),
      searchPatterns: new Set(),
      toolCounts: {},
      startTime: null,
      endTime: null,
    });
    expect(result).toContain("**Files modified**");
    expect(result).toContain("/src/output.js");
  });

  it("lists search patterns", () => {
    const result = buildSummary({
      filesRead: new Set(),
      filesModified: new Set(),
      searchPatterns: new Set(["import.*React", "**/*.test.js"]),
      toolCounts: {},
      startTime: null,
      endTime: null,
    });
    expect(result).toContain("**Searches**");
    expect(result).toContain("import.*React");
  });

  it("lists tools used with counts", () => {
    const result = buildSummary({
      filesRead: new Set(),
      filesModified: new Set(),
      searchPatterns: new Set(),
      toolCounts: { Read: 5, Write: 2, Bash: 1 },
      startTime: null,
      endTime: null,
    });
    expect(result).toContain("**Tools used**");
    expect(result).toContain("Read: 5");
    expect(result).toContain("Write: 2");
  });

  it("shows _none_ for empty file lists", () => {
    const result = buildSummary({
      filesRead: new Set(),
      filesModified: new Set(),
      searchPatterns: new Set(),
      toolCounts: {},
      startTime: null,
      endTime: null,
    });
    expect(result).toContain("_none_");
  });

  it("shows counts in section headings", () => {
    const result = buildSummary({
      filesRead: new Set(["/a.js", "/b.js"]),
      filesModified: new Set(["/c.js"]),
      searchPatterns: new Set(["foo"]),
      toolCounts: { Grep: 3 },
      startTime: null,
      endTime: null,
    });
    expect(result).toMatch(/Files read.*\(2\)/);
    expect(result).toMatch(/Files modified.*\(1\)/);
    expect(result).toMatch(/Searches.*\(1\)/);
  });

  it("handles a full realistic session", () => {
    const start = new Date("2025-01-15T09:00:00Z");
    const end = new Date("2025-01-15T10:45:30Z");
    const result = buildSummary({
      filesRead: new Set([
        "/project/src/index.js",
        "/project/src/utils.js",
        "/project/package.json",
      ]),
      filesModified: new Set([
        "/project/src/index.js",
        "/project/src/new-feature.js",
      ]),
      searchPatterns: new Set([
        "createServer",
        "export default",
        "**/*.test.js",
      ]),
      toolCounts: { Read: 12, Write: 4, Edit: 3, Bash: 8, Grep: 5 },
      startTime: start,
      endTime: end,
    });

    expect(result).toContain("## Session Summary");
    expect(result).toContain("1h 45m");
    expect(result).toMatch(/Files read.*\(3\)/);
    expect(result).toMatch(/Files modified.*\(2\)/);
    expect(result).toMatch(/Searches.*\(3\)/);
    expect(result).toContain("Read: 12");
    expect(result).toContain("Bash: 8");
  });
});

// ─── hooks install/uninstall — settings.json manipulation ─────────────────────

describe("hooks install/uninstall — settings.json format", () => {
  it("session capture hook command references session-end.mjs", () => {
    const tmpHome = pathJoin(osTmpdir(), `cv-hook-test-${Date.now()}`);
    fsMkdirSync(pathJoin(tmpHome, ".claude"), { recursive: true });
    const settingsPath = pathJoin(tmpHome, ".claude", "settings.json");

    try {
      childExecSync(`node ${CLI_PATH} hooks install --session-capture --yes`, {
        env: { ...process.env, HOME: tmpHome },
        stdio: "pipe",
        timeout: 15000,
      });

      const settings = JSON.parse(fsReadFileSync(settingsPath, "utf-8"));
      const sessionEndHooks = settings.hooks?.SessionEnd ?? [];
      const captureHook = sessionEndHooks
        .flatMap((h) => h.hooks ?? [])
        .find((hh) => hh.command?.includes("session-end.mjs"));

      expect(captureHook).toBeDefined();
      expect(captureHook.type).toBe("command");
      expect(captureHook.timeout).toBeGreaterThan(0);
    } finally {
      fsRmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("session capture hook is idempotent (no duplicate entries)", () => {
    const tmpHome = pathJoin(osTmpdir(), `cv-hook-idem-${Date.now()}`);
    fsMkdirSync(pathJoin(tmpHome, ".claude"), { recursive: true });
    const settingsPath = pathJoin(tmpHome, ".claude", "settings.json");

    try {
      const opts = {
        env: { ...process.env, HOME: tmpHome },
        stdio: "pipe",
        timeout: 15000,
      };

      childExecSync(
        `node ${CLI_PATH} hooks install --session-capture --yes`,
        opts,
      );
      childExecSync(
        `node ${CLI_PATH} hooks install --session-capture --yes`,
        opts,
      );

      const settings = JSON.parse(fsReadFileSync(settingsPath, "utf-8"));
      const captureCount = (settings.hooks?.SessionEnd ?? [])
        .flatMap((h) => h.hooks ?? [])
        .filter((hh) => hh.command?.includes("session-end.mjs")).length;

      expect(captureCount).toBe(1);
    } finally {
      fsRmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("uninstall removes session capture hook from settings.json", () => {
    const tmpHome = pathJoin(osTmpdir(), `cv-hook-uninstall-${Date.now()}`);
    fsMkdirSync(pathJoin(tmpHome, ".claude"), { recursive: true });
    const settingsPath = pathJoin(tmpHome, ".claude", "settings.json");

    try {
      const opts = {
        env: { ...process.env, HOME: tmpHome },
        stdio: "pipe",
        timeout: 15000,
      };

      childExecSync(
        `node ${CLI_PATH} hooks install --session-capture --yes`,
        opts,
      );

      {
        const settings = JSON.parse(fsReadFileSync(settingsPath, "utf-8"));
        const captureHooks = (settings.hooks?.SessionEnd ?? [])
          .flatMap((h) => h.hooks ?? [])
          .filter((hh) => hh.command?.includes("session-end.mjs"));
        expect(captureHooks.length).toBe(1);
      }

      childExecSync(`node ${CLI_PATH} hooks uninstall`, opts);

      {
        const settings = JSON.parse(fsReadFileSync(settingsPath, "utf-8"));
        const captureHooks = (settings.hooks?.SessionEnd ?? [])
          .flatMap((h) => h.hooks ?? [])
          .filter((hh) => hh.command?.includes("session-end.mjs"));
        expect(captureHooks.length).toBe(0);
      }
    } finally {
      fsRmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
