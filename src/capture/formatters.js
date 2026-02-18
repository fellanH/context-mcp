/**
 * formatters.js — Kind-specific markdown body templates
 *
 * Maps entry kinds to their markdown body format.
 * Default formatter used for unknown kinds.
 */

const FORMATTERS = {
  insight: ({ body }) => "\n" + body + "\n",

  decision: ({ title, body }) => {
    const t = title || body.slice(0, 80);
    return "\n## Decision\n\n" + t + "\n\n## Rationale\n\n" + body + "\n";
  },

  pattern: ({ title, body, meta }) => {
    const t = title || body.slice(0, 80);
    const lang = meta?.language || "";
    return "\n# " + t + "\n\n```" + lang + "\n" + body + "\n```\n";
  },
};

const DEFAULT_FORMATTER = ({ title, body }) =>
  title ? "\n# " + title + "\n\n" + body + "\n" : "\n" + body + "\n";

export function formatBody(kind, { title, body, meta }) {
  const fn = FORMATTERS[kind] || DEFAULT_FORMATTER;
  return fn({ title, body, meta });
}
