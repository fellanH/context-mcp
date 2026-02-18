/**
 * frontmatter.js — YAML frontmatter parsing and formatting
 */

// ─── YAML Frontmatter Helpers ────────────────────────────────────────────────

const NEEDS_QUOTING = /[:#'"{}[\],>|&*?!@`]/;

export function formatFrontmatter(meta) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((i) => JSON.stringify(i)).join(", ")}]`);
    } else {
      const str = String(v);
      lines.push(`${k}: ${NEEDS_QUOTING.test(str) ? JSON.stringify(str) : str}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

export function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized.trim() };
  const meta = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    // Unquote JSON-quoted strings from formatFrontmatter
    if (val.length >= 2 && val.startsWith('"') && val.endsWith('"') && !val.startsWith('["')) {
      try { val = JSON.parse(val); } catch { /* keep as-is */ }
    }
    // Parse arrays: [a, b, c]
    if (val.startsWith("[") && val.endsWith("]")) {
      try {
        val = JSON.parse(val);
      } catch {
        val = val
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""));
      }
    }
    meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

// ─── Extract Custom Meta ────────────────────────────────────────────────────

const RESERVED_FM_KEYS = new Set(["id", "tags", "source", "created"]);

export function extractCustomMeta(fmMeta) {
  const custom = {};
  for (const [k, v] of Object.entries(fmMeta)) {
    if (!RESERVED_FM_KEYS.has(k)) custom[k] = v;
  }
  return Object.keys(custom).length ? custom : null;
}

// ─── Parse Entry From Markdown ──────────────────────────────────────────────

export function parseEntryFromMarkdown(kind, body, fmMeta) {
  if (kind === "insight") {
    return {
      title: null,
      body,
      meta: extractCustomMeta(fmMeta),
    };
  }

  if (kind === "decision") {
    const titleMatch = body.match(/^## Decision\s*\n+([\s\S]*?)(?=\n## |\n*$)/);
    const rationaleMatch = body.match(/## Rationale\s*\n+([\s\S]*?)$/);
    const title = titleMatch ? titleMatch[1].trim() : body.slice(0, 100);
    const rationale = rationaleMatch ? rationaleMatch[1].trim() : body;
    return {
      title,
      body: rationale,
      meta: extractCustomMeta(fmMeta),
    };
  }

  if (kind === "pattern") {
    const titleMatch = body.match(/^# (.+)/);
    const title = titleMatch ? titleMatch[1].trim() : body.slice(0, 80);
    const codeMatch = body.match(/```[\w]*\n([\s\S]*?)```/);
    const content = codeMatch ? codeMatch[1].trim() : body;
    return {
      title,
      body: content,
      meta: extractCustomMeta(fmMeta),
    };
  }

  // Generic: use first heading as title, rest as body
  const headingMatch = body.match(/^#+ (.+)/);
  return {
    title: headingMatch ? headingMatch[1].trim() : null,
    body,
    meta: extractCustomMeta(fmMeta),
  };
}
