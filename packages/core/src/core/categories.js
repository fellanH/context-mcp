/**
 * categories.js — Static kind→category mapping
 *
 * Three categories with distinct write semantics:
 *   knowledge — append-only, enduring (default)
 *   entity    — upsert by identity_key, enduring
 *   event     — append-only, decaying relevance
 */

const KIND_CATEGORY = {
  // Knowledge — append-only, enduring
  insight: "knowledge",
  decision: "knowledge",
  pattern: "knowledge",
  prompt: "knowledge",
  note: "knowledge",
  document: "knowledge",
  reference: "knowledge",
  // Entity — upsert, enduring
  contact: "entity",
  project: "entity",
  tool: "entity",
  source: "entity",
  bucket: "entity",
  // Event — append-only, decaying
  conversation: "event",
  message: "event",
  session: "event",
  task: "event",
  log: "event",
  feedback: "event",
};

/** Map category name → directory name on disk */
const CATEGORY_DIR_NAMES = {
  knowledge: "knowledge",
  entity: "entities",
  event: "events",
};

/** Set of valid category directory names (for reindex discovery) */
export const CATEGORY_DIRS = new Set(Object.values(CATEGORY_DIR_NAMES));

/**
 * Staleness thresholds (in days) per knowledge kind.
 * Kinds not listed here are considered enduring (no staleness threshold).
 * Based on updated_at; falls back to created_at if updated_at is null.
 */
export const KIND_STALENESS_DAYS = {
  pattern: 180,
  decision: 365,
  reference: 90,
};

const DURABLE_KINDS = new Set(["decision", "architecture", "pattern"]);
const EPHEMERAL_KINDS = new Set(["session", "observation"]);

export function categoryFor(kind) {
  return KIND_CATEGORY[kind] || "knowledge";
}

export function defaultTierFor(kind) {
  if (DURABLE_KINDS.has(kind)) return "durable";
  if (EPHEMERAL_KINDS.has(kind)) return "ephemeral";
  return "working";
}

/** Returns the category directory name for a given kind (e.g. "insight" → "knowledge") */
export function categoryDirFor(kind) {
  const cat = categoryFor(kind);
  return CATEGORY_DIR_NAMES[cat] || "knowledge";
}
