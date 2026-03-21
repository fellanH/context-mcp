/**
 * Contextual reinstatement: encoding context capture and serialization.
 *
 * Inspired by hippocampal contextual reinstatement in neuroscience:
 * the brain stores the situation (place, task, goal) alongside each memory,
 * and re-entering a similar situation boosts recall. This module provides
 * the same mechanism for vault entries.
 */

export interface EncodingContext {
  project?: string;
  arc?: string;
  task?: string;
  cwd?: string;
  session_id?: string;
  [key: string]: string | undefined;
}

/**
 * Serialize an EncodingContext into a natural-language sentence suitable
 * for embedding with MiniLM. The output is a simple key-value string
 * that produces meaningful sentence embeddings for similarity matching.
 *
 * Example: "project: leadfront, arc: auth-rewrite, task: implementing JWT rotation"
 */
export function serializeContext(ctx: EncodingContext): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(ctx)) {
    if (value != null && typeof value === 'string' && value.trim()) {
      parts.push(`${key}: ${value.trim()}`);
    }
  }
  return parts.join(', ');
}

/**
 * Parse and validate a context parameter from tool input.
 * Accepts either a string (used as-is for embedding) or a structured object.
 * Returns null if the input is empty or invalid.
 */
export function parseContextParam(input: unknown): { text: string; structured: EncodingContext | null } | null {
  if (input == null) return null;

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return null;
    return { text: trimmed, structured: null };
  }

  if (typeof input === 'object' && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    const ctx: EncodingContext = {};
    let hasValue = false;
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string' && value.trim()) {
        ctx[key] = value.trim();
        hasValue = true;
      }
    }
    if (!hasValue) return null;
    return { text: serializeContext(ctx), structured: ctx };
  }

  return null;
}
