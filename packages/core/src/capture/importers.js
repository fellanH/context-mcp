/**
 * importers.js — Format detection + parsers for bulk import
 *
 * Detects and parses markdown, CSV/TSV, JSON, and plain text files into
 * the EntryData shape that captureAndIndex() accepts.
 *
 * No external dependencies — CSV parsed with split + quote handling,
 * markdown uses existing parseFrontmatter().
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import {
  parseFrontmatter,
  parseEntryFromMarkdown,
} from "../core/frontmatter.js";
import { dirToKind } from "../core/files.js";

// ─── Format Detection ────────────────────────────────────────────────────────

/**
 * Detect the format of a file by extension and content heuristics.
 * @param {string} filePath
 * @param {string} [content]
 * @returns {"markdown"|"csv"|"tsv"|"json"|"text"}
 */
export function detectFormat(filePath, content) {
  const ext = extname(filePath).toLowerCase();

  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".csv") return "csv";
  if (ext === ".tsv") return "tsv";
  if (ext === ".json" || ext === ".jsonl") return "json";

  // Content-based heuristics if extension is ambiguous
  if (content) {
    const trimmed = content.trimStart();
    if (trimmed.startsWith("---\n")) return "markdown";
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) return "json";
  }

  return "text";
}

// ─── CSV Parsing Helpers ─────────────────────────────────────────────────────

/**
 * Parse a CSV line respecting quoted fields.
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function parseCsvLine(line, delimiter) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ─── Recognized CSV columns ─────────────────────────────────────────────────

const KNOWN_COLUMNS = new Set([
  "kind",
  "title",
  "body",
  "tags",
  "source",
  "identity_key",
  "expires_at",
]);

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse a markdown file into EntryData.
 * Reuses parseFrontmatter + parseEntryFromMarkdown from core.
 *
 * @param {string} content
 * @param {{ kind?: string, source?: string }} [opts]
 * @returns {import("./import-pipeline.js").EntryData[]}
 */
export function parseMarkdown(content, opts = {}) {
  const { meta: fmMeta, body: rawBody } = parseFrontmatter(content);

  // Derive kind from frontmatter or option
  const kind = fmMeta.kind || opts.kind || "insight";
  const parsed = parseEntryFromMarkdown(kind, rawBody, fmMeta);

  return [
    {
      kind,
      title: parsed.title || fmMeta.title || null,
      body: parsed.body || rawBody,
      tags: Array.isArray(fmMeta.tags) ? fmMeta.tags : undefined,
      meta: parsed.meta || undefined,
      source: fmMeta.source || opts.source || "import",
      identity_key: fmMeta.identity_key || undefined,
      expires_at: fmMeta.expires_at || undefined,
    },
  ];
}

/**
 * Parse a CSV or TSV file into EntryData[].
 * Header row required. Recognized columns map directly; unknown → meta.
 * Tags column is comma-separated within field.
 *
 * @param {string} content
 * @param {string} delimiter - "," for CSV, "\t" for TSV
 * @param {{ kind?: string, source?: string }} [opts]
 * @returns {import("./import-pipeline.js").EntryData[]}
 */
export function parseCsv(content, delimiter, opts = {}) {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0], delimiter).map((h) =>
    h.toLowerCase().trim(),
  );
  const entries = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    if (values.every((v) => !v)) continue; // skip empty rows

    const entry = {
      kind: opts.kind || "insight",
      body: "",
      source: opts.source || "csv-import",
    };
    const meta = {};

    for (let j = 0; j < headers.length; j++) {
      const col = headers[j];
      const val = values[j] || "";

      if (col === "kind" && val) {
        entry.kind = val;
      } else if (col === "title" && val) {
        entry.title = val;
      } else if (col === "body" && val) {
        entry.body = val;
      } else if (col === "tags" && val) {
        entry.tags = val
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);
      } else if (col === "source" && val) {
        entry.source = val;
      } else if (col === "identity_key" && val) {
        entry.identity_key = val;
      } else if (col === "expires_at" && val) {
        entry.expires_at = val;
      } else if (val && !KNOWN_COLUMNS.has(col)) {
        meta[col] = val;
      }
    }

    if (!entry.body) continue; // skip rows with no body
    if (Object.keys(meta).length) entry.meta = meta;
    entries.push(entry);
  }

  return entries;
}

/**
 * Parse a JSON file into EntryData[].
 * Supports: array-of-entries, {entries:[...]}, or ChatGPT export format.
 *
 * @param {string} content
 * @param {{ kind?: string, source?: string }} [opts]
 * @returns {import("./import-pipeline.js").EntryData[]}
 */
export function parseJson(content, opts = {}) {
  let data;
  try {
    data = JSON.parse(content);
  } catch {
    return [];
  }

  // Detect format
  let rawEntries;

  if (Array.isArray(data)) {
    // Array-of-entries OR ChatGPT export format
    if (
      data.length > 0 &&
      data[0].mapping &&
      data[0].create_time !== undefined
    ) {
      return parseChatGptExport(data, opts);
    }
    rawEntries = data;
  } else if (data && Array.isArray(data.entries)) {
    rawEntries = data.entries;
  } else {
    // Single entry object
    rawEntries = [data];
  }

  return rawEntries
    .filter((e) => e && typeof e === "object" && e.body)
    .map((e) => ({
      kind: e.kind || opts.kind || "insight",
      title: e.title || null,
      body: e.body,
      tags: Array.isArray(e.tags) ? e.tags : undefined,
      meta: e.meta && typeof e.meta === "object" ? e.meta : undefined,
      source: e.source || opts.source || "json-import",
      identity_key: e.identity_key || undefined,
      expires_at: e.expires_at || undefined,
    }));
}

/**
 * Parse ChatGPT export format (array of conversations with mapping + create_time).
 */
function parseChatGptExport(conversations, opts = {}) {
  const entries = [];

  for (const conv of conversations) {
    if (!conv.title || !conv.mapping) continue;

    // Extract all assistant messages from the mapping
    const messages = Object.values(conv.mapping)
      .filter(
        (m) =>
          m.message?.author?.role === "assistant" &&
          m.message.content?.parts?.length,
      )
      .map((m) => m.message.content.parts.join("\n"))
      .filter(Boolean);

    if (!messages.length) continue;

    const body = messages.join("\n\n---\n\n");
    const created = conv.create_time
      ? new Date(conv.create_time * 1000).toISOString()
      : undefined;

    entries.push({
      kind: opts.kind || "conversation",
      title: conv.title,
      body,
      tags: ["chatgpt-import"],
      meta: { conversation_id: conv.id, created_at_original: created },
      source: opts.source || "chatgpt-export",
    });
  }

  return entries;
}

/**
 * Parse a plain text file into a single EntryData.
 *
 * @param {string} content
 * @param {string} filePath
 * @param {{ kind?: string, source?: string }} [opts]
 * @returns {import("./import-pipeline.js").EntryData[]}
 */
export function parseText(content, filePath, opts = {}) {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const name = basename(filePath, extname(filePath));
  const title = name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return [
    {
      kind: opts.kind || "insight",
      title,
      body: trimmed,
      source: opts.source || "text-import",
    },
  ];
}

/**
 * Parse a single file (auto-detect format).
 *
 * @param {string} filePath
 * @param {string} content
 * @param {{ kind?: string, source?: string }} [opts]
 * @returns {import("./import-pipeline.js").EntryData[]}
 */
export function parseFile(filePath, content, opts = {}) {
  const format = detectFormat(filePath, content);

  switch (format) {
    case "markdown":
      return parseMarkdown(content, opts);
    case "csv":
      return parseCsv(content, ",", opts);
    case "tsv":
      return parseCsv(content, "\t", opts);
    case "json":
      return parseJson(content, opts);
    case "text":
      return parseText(content, filePath, opts);
    default:
      return [];
  }
}

/**
 * Recursively parse a directory of files.
 * Walks subdirectories, filters by extension, infers kind from directory name.
 *
 * @param {string} dirPath
 * @param {{ kind?: string, source?: string, extensions?: string[] }} [opts]
 * @returns {import("./import-pipeline.js").EntryData[]}
 */
export function parseDirectory(dirPath, opts = {}) {
  const extensions = opts.extensions || [
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
    ".json",
    ".txt",
  ];
  const entries = [];

  function walk(dir, inferredKind) {
    let items;
    try {
      items = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const item of items) {
      if (item.name.startsWith(".") || item.name.startsWith("_")) continue;

      const fullPath = join(dir, item.name);

      if (item.isDirectory()) {
        // Try to infer kind from directory name
        const kind =
          dirToKind(item.name) !== item.name
            ? dirToKind(item.name)
            : inferredKind;
        walk(fullPath, kind);
      } else if (item.isFile()) {
        const ext = extname(item.name).toLowerCase();
        if (!extensions.includes(ext)) continue;

        try {
          const content = readFileSync(fullPath, "utf-8");
          const fileOpts = { ...opts };
          if (inferredKind && !fileOpts.kind) fileOpts.kind = inferredKind;
          const parsed = parseFile(fullPath, content, fileOpts);
          entries.push(...parsed);
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  // Infer kind from the top-level directory name
  const topKind = opts.kind || undefined;
  walk(dirPath, topKind);

  return entries;
}
