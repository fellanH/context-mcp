const NEEDS_QUOTING = /[:#'"{}[\],>|&*?!@`]/;

export function formatFrontmatter(meta: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((i) => JSON.stringify(i)).join(', ')}]`);
    } else {
      const str = String(v);
      lines.push(`${k}: ${NEEDS_QUOTING.test(str) ? JSON.stringify(str) : str}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function parseFrontmatter(text: string): {
  meta: Record<string, unknown>;
  body: string;
} {
  const normalized = text.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: normalized.trim() };
  const meta: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val: unknown = line.slice(idx + 1).trim() as string;
    if (
      typeof val === 'string' &&
      val.length >= 2 &&
      val.startsWith('"') &&
      val.endsWith('"') &&
      !val.startsWith('["')
    ) {
      try {
        val = JSON.parse(val);
      } catch {
        /* keep as-is */
      }
    }
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      try {
        val = JSON.parse(val);
      } catch {
        val = (val as string)
          .slice(1, -1)
          .split(',')
          .map((s: string) => s.trim().replace(/^"|"$/g, ''));
      }
    }
    meta[key] = val;
  }
  return { meta, body: match[2].trim() };
}

const RESERVED_FM_KEYS = new Set([
  'id',
  'title',
  'kind',
  'tier',
  'tags',
  'source',
  'created',
  'updated',
  'identity_key',
  'expires_at',
  'supersedes',
  'related_to',
]);

export function extractCustomMeta(fmMeta: Record<string, unknown>): Record<string, unknown> | null {
  const custom: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fmMeta)) {
    if (!RESERVED_FM_KEYS.has(k)) custom[k] = v;
  }
  return Object.keys(custom).length ? custom : null;
}

export function parseEntryFromMarkdown(
  kind: string,
  body: string,
  fmMeta: Record<string, unknown>
): {
  title: string | null;
  body: string;
  meta: Record<string, unknown> | null;
} {
  if (kind === 'insight') {
    const fmTitle = typeof fmMeta.title === 'string' ? fmMeta.title : null;
    const headingMatch = body.match(/^#+ (.+)/);
    const title = fmTitle || (headingMatch ? headingMatch[1].trim() : null);
    return { title, body, meta: extractCustomMeta(fmMeta) };
  }

  if (kind === 'decision') {
    const titleMatch = body.match(/^## Decision\s*\n+([\s\S]*?)(?=\n## |\n*$)/);
    const rationaleMatch = body.match(/## Rationale\s*\n+([\s\S]*?)$/);
    const title = titleMatch ? titleMatch[1].trim() : body.slice(0, 100);
    const rationale = rationaleMatch ? rationaleMatch[1].trim() : body;
    return { title, body: rationale, meta: extractCustomMeta(fmMeta) };
  }

  if (kind === 'pattern') {
    const titleMatch = body.match(/^# (.+)/);
    const title = titleMatch ? titleMatch[1].trim() : body.slice(0, 80);
    const codeMatch = body.match(/```[\w]*\n([\s\S]*?)```/);
    const content = codeMatch ? codeMatch[1].trim() : body;
    return { title, body: content, meta: extractCustomMeta(fmMeta) };
  }

  const fmTitle = typeof fmMeta.title === 'string' ? fmMeta.title : null;
  const headingMatch = body.match(/^#+ (.+)/);
  return {
    title: fmTitle || (headingMatch ? headingMatch[1].trim() : null),
    body,
    meta: extractCustomMeta(fmMeta),
  };
}
