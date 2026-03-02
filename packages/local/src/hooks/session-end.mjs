/**
 * Session-end hook helpers — extracted from cli.js for testability.
 *
 * Exports:
 *   parseTranscriptLines(lines)  — parse JSONL transcript lines into structured data
 *   buildSummary(data)           — format a session summary markdown string
 *   formatDuration(start, end)   — return human-readable duration string or null
 *   extractInsights(path)        — scan transcript file for insight patterns
 */

import { existsSync, readFileSync } from "node:fs";

// ─── parseTranscriptLines ────────────────────────────────────────────────────

/**
 * Parse an array of JSONL transcript lines into structured session data.
 *
 * @param {string[]} lines - Raw JSONL strings from a Claude Code transcript
 * @returns {{ filesRead: Set<string>, filesModified: Set<string>, searchPatterns: Set<string>, toolCounts: Record<string, number>, startTime: Date|null, endTime: Date|null }}
 */
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
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Track timestamps
    if (entry.timestamp) {
      const ts = new Date(entry.timestamp);
      if (!isNaN(ts.getTime())) {
        if (startTime === null || ts < startTime) startTime = ts;
        if (endTime === null || ts > endTime) endTime = ts;
      }
    }

    // Skip entries without a message or with non-array content
    if (!entry.message || !Array.isArray(entry.message.content)) continue;

    for (const block of entry.message.content) {
      if (block.type !== "tool_use") continue;

      const toolName = block.name || "unknown";
      const input = block.input || {};

      // Count tool uses
      toolCounts[toolName] = (toolCounts[toolName] || 0) + 1;

      // Track files read
      if (toolName === "Read" || toolName === "read_file") {
        if (input.file_path) filesRead.add(input.file_path);
      }

      // Track files modified
      if (toolName === "Write" || toolName === "Edit") {
        if (input.file_path) filesModified.add(input.file_path);
      }
      if (toolName === "NotebookEdit") {
        if (input.notebook_path) filesModified.add(input.notebook_path);
      }

      // Track search patterns
      if (toolName === "Grep" || toolName === "Glob") {
        if (input.pattern) searchPatterns.add(input.pattern);
      }
      if (toolName === "WebSearch") {
        if (input.query) searchPatterns.add(input.query);
      }

      // Extract search patterns from Bash grep/rg commands
      if (toolName === "Bash" && input.command) {
        const cmd = input.command;
        // Match grep -r 'pattern' or rg -n 'pattern'
        const grepMatch = cmd.match(/(?:grep|rg)\s+(?:[^\s]*\s+)*'([^']+)'/);
        if (grepMatch) {
          searchPatterns.add(grepMatch[1]);
        }
      }
    }
  }

  return { filesRead, filesModified, searchPatterns, toolCounts, startTime, endTime };
}

// ─── formatDuration ──────────────────────────────────────────────────────────

/**
 * Format the duration between two Date objects as a human-readable string.
 *
 * @param {Date|null} start
 * @param {Date|null} end
 * @returns {string|null}
 */
export function formatDuration(start, end) {
  if (!start || !end) return null;

  const diffMs = end - start;
  const totalSec = Math.round(diffMs / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

// ─── buildSummary ────────────────────────────────────────────────────────────

/**
 * Build a markdown session summary from parsed transcript data.
 *
 * @param {{ filesRead: Set<string>, filesModified: Set<string>, searchPatterns: Set<string>, toolCounts: Record<string, number>, startTime: Date|null, endTime: Date|null, insights?: Array<{title: string, body: string}> }} data
 * @returns {string}
 */
export function buildSummary(data) {
  const { filesRead, filesModified, searchPatterns, toolCounts, startTime, endTime, insights } = data;
  const lines = [];

  lines.push("## Session Summary");
  lines.push("");

  // Duration
  const duration = formatDuration(startTime, endTime);
  if (duration) {
    lines.push(`**Duration**: ${duration}`);
    lines.push("");
  }

  // Files read
  if (filesRead.size > 0) {
    lines.push(`**Files read** (${filesRead.size})`);
    for (const f of filesRead) lines.push(`- ${f}`);
  } else {
    lines.push("**Files read**: _none_");
  }
  lines.push("");

  // Files modified
  if (filesModified.size > 0) {
    lines.push(`**Files modified** (${filesModified.size})`);
    for (const f of filesModified) lines.push(`- ${f}`);
  } else {
    lines.push("**Files modified**: _none_");
  }
  lines.push("");

  // Search patterns
  if (searchPatterns.size > 0) {
    lines.push(`**Searches** (${searchPatterns.size})`);
    for (const p of searchPatterns) lines.push(`- ${p}`);
  } else {
    lines.push("**Searches**: _none_");
  }
  lines.push("");

  // Tools used
  if (Object.keys(toolCounts).length > 0) {
    lines.push("**Tools used**");
    const sorted = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted) lines.push(`- ${name}: ${count}`);
  } else {
    lines.push("**Tools used**: _none_");
  }

  // Insights
  if (insights && insights.length > 0) {
    lines.push("");
    lines.push(`**Insights captured** (${insights.length})`);
    for (const insight of insights) {
      lines.push(`- ${insight.body}`);
    }
  }

  return lines.join("\n");
}

// ─── extractInsights ─────────────────────────────────────────────────────────

const INSIGHT_PATTERNS = [
  /^★\s+(.+)/,                    // ★ star pattern
  /^\*\*Insight:\*\*\s*(.+)/,     // **Insight:** pattern
  /^\*\*Key insight:\*\*\s*(.+)/i, // **Key insight:** pattern
  /^\*\*Key Finding:\*\*\s*(.+)/i, // **Key Finding:** pattern
  /^>\s*\*\*Note:\*\*\s*(.+)/,    // > **Note:** pattern
  /^>\s*\*\*Important:\*\*\s*(.+)/, // > **Important:** pattern
];

const MAX_INSIGHTS = 10;
const MIN_BODY_LENGTH = 10;
const MAX_BODY_LENGTH = 300;

/**
 * Scan a transcript file for insight patterns in assistant messages.
 *
 * @param {string|null} transcriptPath - Path to a JSONL transcript file
 * @returns {Array<{title: string, body: string}>}
 */
export function extractInsights(transcriptPath) {
  if (!transcriptPath) return [];
  if (!existsSync(transcriptPath)) return [];

  let content;
  try {
    content = readFileSync(transcriptPath, "utf-8");
  } catch {
    return [];
  }

  if (!content.trim()) return [];

  const insights = [];
  const lines = content.split("\n");

  for (const line of lines) {
    if (insights.length >= MAX_INSIGHTS) break;

    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry;
    try {
      entry = JSON.parse(trimmed);
    } catch {
      continue;
    }

    // Only scan assistant messages
    if (!entry.message || entry.message.role !== "assistant") continue;
    if (!Array.isArray(entry.message.content)) continue;

    for (const block of entry.message.content) {
      if (insights.length >= MAX_INSIGHTS) break;

      // Only scan text blocks, not tool_use
      if (block.type !== "text" || !block.text) continue;

      // Check each line of the text for insight patterns
      const textLines = block.text.split("\n");
      for (const textLine of textLines) {
        if (insights.length >= MAX_INSIGHTS) break;

        for (const pattern of INSIGHT_PATTERNS) {
          const match = textLine.match(pattern);
          if (match) {
            let body = match[1].trim();
            // Truncate to MAX_BODY_LENGTH
            if (body.length > MAX_BODY_LENGTH) {
              body = body.slice(0, MAX_BODY_LENGTH);
            }
            // Skip if too short
            if (body.length < MIN_BODY_LENGTH) continue;

            insights.push({
              title: body.slice(0, 80),
              body,
            });
            break; // One match per line
          }
        }
      }
    }
  }

  return insights;
}
