/**
 * linking.js — Pure graph traversal for related_to links.
 *
 * All functions accept a db handle and return data — no side effects.
 * The calling layer (get-context handler) is responsible for I/O wiring.
 */

/**
 * Parse a `related_to` JSON string from the DB into an array of ID strings.
 * Returns an empty array on any parse failure or null input.
 *
 * @param {string|null|undefined} raw
 * @returns {string[]}
 */
export function parseRelatedTo(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string" && id.trim());
  } catch {
    return [];
  }
}

/**
 * Fetch vault entries by their IDs, scoped to a user.
 * Returns only entries that exist and are not expired or superseded.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string[]} ids
 * @param {string|null|undefined} userId
 * @returns {object[]} Matching DB rows
 */
export function resolveLinks(db, ids, userId) {
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => "?").join(",");
  const userClause =
    userId !== undefined && userId !== null
      ? "AND user_id = ?"
      : "AND user_id IS NULL";
  const params =
    userId !== undefined && userId !== null ? [...unique, userId] : unique;
  try {
    return db
      .prepare(
        `SELECT * FROM vault
         WHERE id IN (${placeholders})
           ${userClause}
           AND (expires_at IS NULL OR expires_at > datetime('now'))
           AND superseded_by IS NULL`,
      )
      .all(...params);
  } catch {
    return [];
  }
}

/**
 * Find all entries that declare `entryId` in their `related_to` field
 * (i.e. entries that point *to* this entry — backlinks).
 * Scoped to the same user. Excludes expired and superseded entries.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {string} entryId
 * @param {string|null|undefined} userId
 * @returns {object[]} Entries with a backlink to entryId
 */
export function resolveBacklinks(db, entryId, userId) {
  if (!entryId) return [];
  const userClause =
    userId !== undefined && userId !== null
      ? "AND user_id = ?"
      : "AND user_id IS NULL";
  const likePattern = `%"${entryId}"%`;
  const params =
    userId !== undefined && userId !== null
      ? [likePattern, userId]
      : [likePattern];
  try {
    return db
      .prepare(
        `SELECT * FROM vault
         WHERE related_to LIKE ?
           ${userClause}
           AND (expires_at IS NULL OR expires_at > datetime('now'))
           AND superseded_by IS NULL`,
      )
      .all(...params);
  } catch {
    return [];
  }
}

/**
 * For a set of primary entry IDs, collect all forward links (entries pointed
 * to by `related_to`) and backlinks (entries that point back to any primary).
 *
 * Returns a Map of id → entry row for all linked entries, excluding entries
 * already present in `primaryIds`.
 *
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object[]} primaryEntries - Full entry rows (must have id + related_to fields)
 * @param {string|null|undefined} userId
 * @returns {{ forward: object[], backward: object[] }}
 */
export function collectLinkedEntries(db, primaryEntries, userId) {
  const primaryIds = new Set(primaryEntries.map((e) => e.id));

  // Forward: resolve all IDs from related_to fields
  const forwardIds = [];
  for (const entry of primaryEntries) {
    const ids = parseRelatedTo(entry.related_to);
    for (const id of ids) {
      if (!primaryIds.has(id)) forwardIds.push(id);
    }
  }
  const forwardEntries = resolveLinks(db, forwardIds, userId).filter(
    (e) => !primaryIds.has(e.id),
  );

  // Backward: find all entries that link to any primary entry
  const backwardSeen = new Set();
  const backwardEntries = [];
  const forwardIds2 = new Set(forwardEntries.map((e) => e.id));
  for (const entry of primaryEntries) {
    const backlinks = resolveBacklinks(db, entry.id, userId);
    for (const bl of backlinks) {
      if (!primaryIds.has(bl.id) && !backwardSeen.has(bl.id)) {
        backwardSeen.add(bl.id);
        backwardEntries.push(bl);
      }
    }
  }

  return { forward: forwardEntries, backward: backwardEntries };
}

/**
 * Validate a `related_to` value from user input.
 * Must be an array of non-empty strings (ULID-like IDs).
 * Returns an error message string if invalid, or null if valid.
 *
 * @param {unknown} relatedTo
 * @returns {string|null}
 */
export function validateRelatedTo(relatedTo) {
  if (relatedTo === undefined || relatedTo === null) return null;
  if (!Array.isArray(relatedTo))
    return "related_to must be an array of entry IDs";
  for (const id of relatedTo) {
    if (typeof id !== "string" || !id.trim()) {
      return "each related_to entry must be a non-empty string ID";
    }
    if (id.length > 32) {
      return `related_to ID too long (max 32 chars): "${id.slice(0, 32)}..."`;
    }
  }
  return null;
}
