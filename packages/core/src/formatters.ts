interface FormatInput {
  title?: string | null;
  body: string;
  meta?: Record<string, unknown>;
}

const FORMATTERS: Record<string, (input: FormatInput) => string> = {
  insight: ({ body }) => '\n' + body + '\n',

  decision: ({ title, body }) => {
    const t = title || body.slice(0, 80);
    return '\n## Decision\n\n' + t + '\n\n## Rationale\n\n' + body + '\n';
  },

  pattern: ({ title, body, meta }) => {
    const t = title || body.slice(0, 80);
    const lang = (meta?.language as string) || '';
    return '\n# ' + t + '\n\n```' + lang + '\n' + body + '\n```\n';
  },
};

const DEFAULT_FORMATTER = ({ title, body }: FormatInput): string =>
  title ? '\n# ' + title + '\n\n' + body + '\n' : '\n' + body + '\n';

export function formatBody(kind: string, input: FormatInput): string {
  const fn = FORMATTERS[kind] || DEFAULT_FORMATTER;
  return fn(input);
}
