#!/usr/bin/env node
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    setTimeout(() => resolve(data), 3000); // safety timeout
  });
}

function extractRelevantInput(toolName, input) {
  if (!input) return {};
  const relevant = {};
  if (input.file_path) relevant.file_path = input.file_path;
  if (input.path) relevant.path = input.path;
  if (input.notebook_path) relevant.notebook_path = input.notebook_path;
  if (input.pattern) relevant.pattern = input.pattern;
  if (input.query) relevant.query = input.query;
  if (input.command) {
    relevant.command = input.command.slice(0, 200);
  }
  if (input.glob) relevant.glob = input.glob;
  if (input.regex) relevant.regex = input.regex;
  return relevant;
}

export async function main() {
  try {
    const raw = await readStdin();
    if (!raw.trim()) process.exit(0);

    let hookInput;
    try {
      hookInput = JSON.parse(raw);
    } catch {
      process.exit(0);
    }

    const { session_id, tool_name, tool_input } = hookInput;
    if (!session_id || !tool_name) process.exit(0);

    const sessionsDir = join(homedir(), ".context-mcp", "sessions");
    mkdirSync(sessionsDir, { recursive: true });

    const logFile = join(sessionsDir, `${session_id}.jsonl`);
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      tool: tool_name,
      input: extractRelevantInput(tool_name, tool_input),
    });

    appendFileSync(logFile, entry + "\n");
  } catch {
    // Never block the agent
  }
}

main();
