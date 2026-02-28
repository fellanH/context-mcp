/**
 * Temporal shortcut resolver.
 *
 * Converts natural-language time expressions to ISO date strings.
 * Fully pure — accepts an explicit `now` Date for deterministic testing.
 *
 * Supported shortcuts (case-insensitive, spaces or underscores):
 *   today          → start of today (00:00:00 local midnight in UTC)
 *   yesterday      → { since: start of yesterday, until: end of yesterday }
 *   this_week      → start of current ISO week (Monday 00:00)
 *   last_N_days    → N days ago (e.g. last_3_days, last 7 days)
 *   last_N_weeks   → N weeks ago
 *   last_N_months  → N calendar months ago (approximate: N × 30 days)
 *
 * Anything that doesn't match a shortcut is returned unchanged so that ISO
 * date strings pass straight through without modification.
 */

const SHORTCUT_RE = /^last[_ ](\d+)[_ ](day|days|week|weeks|month|months)$/i;

/**
 * Start of today in UTC (i.e. the midnight boundary at which the local date begins,
 * expressed as an ISO string). We operate in UTC throughout so tests are portable.
 *
 * @param {Date} now
 * @returns {Date}
 */
function startOfToday(now) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Resolve a single temporal expression to one or two ISO date strings.
 *
 * @param {"since"|"until"} role  - Which parameter we are resolving.
 * @param {string} value          - Raw parameter value from the caller.
 * @param {Date} [now]            - Override for "now" (defaults to `new Date()`).
 * @returns {string}              - Resolved ISO date string (or original value if unrecognised).
 */
export function resolveTemporalShortcut(role, value, now = new Date()) {
  if (!value || typeof value !== "string") return value;

  const trimmed = value.trim().toLowerCase().replace(/\s+/g, "_");

  if (trimmed === "today") {
    const start = startOfToday(now);
    if (role === "until") {
      // "until today" means up to end-of-today
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return end.toISOString();
    }
    return start.toISOString();
  }

  if (trimmed === "yesterday") {
    const todayStart = startOfToday(now);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    if (role === "since") return yesterdayStart.toISOString();
    // role === "until": end of yesterday = start of today
    return todayStart.toISOString();
  }

  if (trimmed === "this_week") {
    // Monday 00:00 UTC of the current week
    const todayStart = startOfToday(now);
    const dayOfWeek = todayStart.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysFromMonday = (dayOfWeek + 6) % 7; // 0 on Monday
    const monday = new Date(todayStart);
    monday.setUTCDate(monday.getUTCDate() - daysFromMonday);
    if (role === "since") return monday.toISOString();
    // "until this_week" means up to now (end of today)
    const endOfToday = new Date(todayStart);
    endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
    return endOfToday.toISOString();
  }

  if (trimmed === "this_month") {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (role === "since") return d.toISOString();
    const endOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    return endOfMonth.toISOString();
  }

  const m = SHORTCUT_RE.exec(trimmed);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].replace(/s$/, ""); // normalise plural → singular
    let ms;
    if (unit === "day") {
      ms = n * 86400000;
    } else if (unit === "week") {
      ms = n * 7 * 86400000;
    } else {
      // month → approximate as 30 days
      ms = n * 30 * 86400000;
    }
    const target = new Date(now.getTime() - ms);
    target.setUTCHours(0, 0, 0, 0);
    return target.toISOString();
  }

  // Unrecognised — pass through unchanged (ISO dates, empty strings, etc.)
  return value;
}

/**
 * Resolve both `since` and `until` parameters, handling the special case where
 * "yesterday" sets both bounds automatically when only `since` is specified.
 *
 * Returns `{ since, until }` with resolved ISO strings (or originals).
 *
 * @param {{ since?: string, until?: string }} params
 * @param {Date} [now]
 * @returns {{ since: string|undefined, until: string|undefined }}
 */
export function resolveTemporalParams(params, now = new Date()) {
  let { since, until } = params;

  // Special case: "yesterday" on `since` without an explicit `until`
  // auto-fills `until` to the end of yesterday.
  if (
    since?.trim().toLowerCase() === "yesterday" &&
    (until === undefined || until === null)
  ) {
    since = resolveTemporalShortcut("since", since, now);
    until = resolveTemporalShortcut("until", "yesterday", now);
    return { since, until };
  }

  return {
    since:
      since !== undefined
        ? resolveTemporalShortcut("since", since, now)
        : since,
    until:
      until !== undefined
        ? resolveTemporalShortcut("until", until, now)
        : until,
  };
}
