#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { execSync, execFileSync } from "node:child_process";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data), 5000);
  });
}

function detectProject(cwd) {
  if (!cwd) return null;
  try {
    const remote = execSync("git remote get-url origin 2>/dev/null", {
      cwd,
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (remote) {
      const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
      if (match) return match[1];
    }
  } catch {}
  return basename(cwd);
}

export function parseTranscript(transcriptPath) {
  const filesRead = new Set();
  const filesModified = new Set();
  const searchPatterns = new Set();
  const toolCounts = {};
  let startTime = null;
  let endTime = null;

  if (!transcriptPath || !existsSync(transcriptPath)) {
    return {
      filesRead,
      filesModified,
      searchPatterns,
      toolCounts,
      startTime,
      endTime,
    };
  }

  let lines;
  try {
    const raw = readFileSync(transcriptPath, "utf-8");
    lines = raw.split("\n").filter((l) => l.trim());
  } catch {
    return {
      filesRead,
      filesModified,
      searchPatterns,
      toolCounts,
      startTime,
      endTime,
    };
  }

  return parseTranscriptLines(lines);
}

export function parseTranscriptLines(lines) {
  const filesRead = new Set();
  const filesModified = new Set();
  const searchPatterns = new Set();
  const toolCounts = {};
  let startTime = null;
  let endTime = null;

  for (const line of lines) {
    let entry;
    try {
      entry = typeof line === "string" ? JSON.parse(line) : line;
    } catch {
      continue;
    }

    if (entry.timestamp) {
      const ts = new Date(entry.timestamp);
      if (!isNaN(ts.getTime())) {
        if (!startTime || ts < startTime) startTime = ts;
        if (!endTime || ts > endTime) endTime = ts;
      }
    }

    const msg = entry.message;
    if (!msg) continue;

    const contentBlocks = msg.content;
    if (!Array.isArray(contentBlocks)) continue;

    for (const block of contentBlocks) {
      if (block.type === "tool_use") {
        const toolName = block.name || "unknown";
        toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;

        const input = block.input || {};

        if (
          toolName === "Read" ||
          toolName === "read_file" ||
          toolName === "read"
        ) {
          const fp = input.file_path || input.path;
          if (fp) filesRead.add(fp);
        }

        if (
          toolName === "Write" ||
          toolName === "Edit" ||
          toolName === "write_file" ||
          toolName === "edit_file" ||
          toolName === "write" ||
          toolName === "edit"
        ) {
          const fp = input.file_path || input.path;
          if (fp) filesModified.add(fp);
        }

        if (toolName === "NotebookEdit" || toolName === "notebook_edit") {
          const fp = input.notebook_path || input.path;
          if (fp) filesModified.add(fp);
        }

        if (
          toolName === "Grep" ||
          toolName === "grep" ||
          toolName === "search" ||
          toolName === "Search"
        ) {
          const pattern = input.pattern || input.query || input.regex;
          if (pattern) searchPatterns.add(pattern);
        }

        if (toolName === "Glob" || toolName === "glob") {
          const pattern = input.pattern;
          if (pattern) searchPatterns.add(pattern);
        }

        if (toolName === "Bash" || toolName === "bash") {
          const cmd = input.command || "";
          const grepMatch = cmd.match(
            /\bgrep\s+(?:-[^\s]+\s+)*['"]?([^'"|\s]+)/,
          );
          if (grepMatch) searchPatterns.add(grepMatch[1]);
          const rgMatch = cmd.match(/\brg\s+(?:-[^\s]+\s+)*['"]?([^'"|\s]+)/);
          if (rgMatch) searchPatterns.add(rgMatch[1]);
        }

        if (toolName === "WebSearch" || toolName === "web_search") {
          const q = input.query;
          if (q) searchPatterns.add(q);
        }
      }
    }
  }

  return {
    filesRead,
    filesModified,
    searchPatterns,
    toolCounts,
    startTime,
    endTime,
  };
}

export function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const ms = endTime - startTime;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSec}s`;
  const hours = Math.floor(minutes / 60);
  const remainMin = minutes % 60;
  return `${hours}h ${remainMin}m`;
}

function formatList(items, max = 20) {
  const arr = Array.from(items);
  if (arr.length === 0) return "_none_";
  const shown = arr.slice(0, max);
  const lines = shown.map((p) => `  - \`${p}\``);
  if (arr.length > max) lines.push(`  - _...and ${arr.length - max} more_`);
  return lines.join("\n");
}

function formatToolCounts(toolCounts) {
  const entries = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return "_none_";
  return entries.map(([name, count]) => `  - ${name}: ${count}`).join("\n");
}

export function buildSummary({
  filesRead,
  filesModified,
  searchPatterns,
  toolCounts,
  startTime,
  endTime,
}) {
  const sections = ["## Session Summary"];

  const duration = formatDuration(startTime, endTime);
  if (duration) {
    sections.push(`- **Duration**: ${duration}`);
  }

  sections.push(
    `- **Files read** (${filesRead.size}):\n${formatList(filesRead)}`,
  );
  sections.push(
    `- **Files modified** (${filesModified.size}):\n${formatList(filesModified)}`,
  );
  sections.push(
    `- **Searches** (${searchPatterns.size}):\n${formatList(searchPatterns)}`,
  );
  sections.push(`- **Tools used**:\n${formatToolCounts(toolCounts)}`);

  return sections.join("\n");
}

async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);

    let hookInput;
    try {
      hookInput = JSON.parse(raw);
    } catch {
      process.exit(0);
    }

    const { transcript_path, cwd, session_id } = hookInput;
    const project = detectProject(cwd);
    const data = parseTranscript(transcript_path);

    const totalToolCalls = Object.values(data.toolCounts).reduce(
      (a, b) => a + b,
      0,
    );
    if (totalToolCalls === 0) {
      process.exit(0);
    }

    const body = buildSummary(data);
    const tags = ["session", "auto-captured"];
    if (project) tags.unshift(project);

    const title = `Session ${session_id ? session_id.slice(0, 8) : new Date().toISOString().slice(0, 10)}`;

    const payload = JSON.stringify({
      kind: "session",
      title,
      body,
      tags,
      source: "session-end-hook",
    });

    execFileSync("npx", ["context-vault", "session-capture"], {
      input: payload,
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // fail silently — never block session end
  }
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("session-end.mjs") ||
    process.argv[1].endsWith("session-end.js"));

if (isDirectRun) {
  main();
}
