import type { DatabaseSync } from 'node:sqlite';

export function parseRelatedTo(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw as string);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === 'string' && id.trim());
  } catch {
    return [];
  }
}

export function resolveLinks(db: DatabaseSync, ids: string[]): any[] {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => '?').join(',');
  try {
    return db
      .prepare(
        `SELECT * FROM vault
         WHERE id IN (${placeholders})
           AND (expires_at IS NULL OR expires_at > datetime('now'))
           AND superseded_by IS NULL`
      )
      .all(...unique);
  } catch {
    return [];
  }
}

export function resolveBacklinks(db: DatabaseSync, entryId: string): any[] {
  if (!entryId) return [];
  const likePattern = `%"${entryId}"%`;
  try {
    return db
      .prepare(
        `SELECT * FROM vault
         WHERE related_to LIKE ?
           AND (expires_at IS NULL OR expires_at > datetime('now'))
           AND superseded_by IS NULL`
      )
      .all(likePattern);
  } catch {
    return [];
  }
}

export function collectLinkedEntries(
  db: DatabaseSync,
  primaryEntries: Array<{ id: string; related_to?: string | null }>
): { forward: any[]; backward: any[] } {
  const primaryIds = new Set(primaryEntries.map((e) => e.id));

  const forwardIds: string[] = [];
  for (const entry of primaryEntries) {
    const ids = parseRelatedTo(entry.related_to);
    for (const id of ids) {
      if (!primaryIds.has(id)) forwardIds.push(id);
    }
  }
  const forwardEntries = resolveLinks(db, forwardIds).filter((e) => !primaryIds.has(e.id));

  const backwardSeen = new Set<string>();
  const backwardEntries: any[] = [];
  for (const entry of primaryEntries) {
    const backlinks = resolveBacklinks(db, entry.id);
    for (const bl of backlinks) {
      if (!primaryIds.has(bl.id) && !backwardSeen.has(bl.id)) {
        backwardSeen.add(bl.id);
        backwardEntries.push(bl);
      }
    }
  }

  return { forward: forwardEntries, backward: backwardEntries };
}

export function validateRelatedTo(relatedTo: unknown): string | null {
  if (relatedTo === undefined || relatedTo === null) return null;
  if (!Array.isArray(relatedTo)) return 'related_to must be an array of entry IDs';
  for (const id of relatedTo) {
    if (typeof id !== 'string' || !id.trim()) {
      return 'each related_to entry must be a non-empty string ID';
    }
    if (id.length > 32) {
      return `related_to ID too long (max 32 chars): "${id.slice(0, 32)}..."`;
    }
  }
  return null;
}
