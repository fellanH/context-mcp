const KIND_CATEGORY: Record<string, string> = {
  insight: 'knowledge',
  decision: 'knowledge',
  pattern: 'knowledge',
  prompt: 'knowledge',
  note: 'knowledge',
  document: 'knowledge',
  reference: 'knowledge',
  contact: 'entity',
  project: 'entity',
  tool: 'entity',
  source: 'entity',
  bucket: 'entity',
  event: 'event',
  conversation: 'event',
  message: 'event',
  session: 'event',
  task: 'event',
  log: 'event',
  feedback: 'event',
  inbox: 'event',
};

const CATEGORY_DIR_NAMES: Record<string, string> = {
  knowledge: 'knowledge',
  entity: 'entities',
  event: 'events',
};

export const CATEGORY_DIRS = new Set(Object.values(CATEGORY_DIR_NAMES));

export const KIND_STALENESS_DAYS: Record<string, number> = {
  pattern: 180,
  decision: 365,
  reference: 90,
};

const DURABLE_KINDS = new Set(['decision', 'architecture', 'pattern']);
const EPHEMERAL_KINDS = new Set(['session', 'observation']);

export function categoryFor(kind: string): string {
  return KIND_CATEGORY[kind] || 'knowledge';
}

export function defaultTierFor(kind: string): string {
  if (DURABLE_KINDS.has(kind)) return 'durable';
  if (EPHEMERAL_KINDS.has(kind)) return 'ephemeral';
  return 'working';
}

export function categoryDirFor(kind: string): string {
  const cat = categoryFor(kind);
  return CATEGORY_DIR_NAMES[cat] || 'knowledge';
}
