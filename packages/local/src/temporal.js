const SHORTCUT_RE = /^last[_ ](\d+)[_ ](day|days|week|weeks|month|months)$/i;

function startOfToday(now) {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function resolveTemporalShortcut(role, value, now = new Date()) {
  if (!value || typeof value !== 'string') return value;
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, '_');

  if (trimmed === 'today') {
    const start = startOfToday(now);
    if (role === 'until') {
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return end.toISOString();
    }
    return start.toISOString();
  }

  if (trimmed === 'yesterday') {
    const todayStart = startOfToday(now);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setUTCDate(yesterdayStart.getUTCDate() - 1);
    if (role === 'since') return yesterdayStart.toISOString();
    return todayStart.toISOString();
  }

  if (trimmed === 'this_week') {
    const todayStart = startOfToday(now);
    const dayOfWeek = todayStart.getUTCDay();
    const daysFromMonday = (dayOfWeek + 6) % 7;
    const monday = new Date(todayStart);
    monday.setUTCDate(monday.getUTCDate() - daysFromMonday);
    if (role === 'since') return monday.toISOString();
    const endOfToday = new Date(todayStart);
    endOfToday.setUTCDate(endOfToday.getUTCDate() + 1);
    return endOfToday.toISOString();
  }

  if (trimmed === 'this_month') {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    if (role === 'since') return d.toISOString();
    const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return endOfMonth.toISOString();
  }

  const m = SHORTCUT_RE.exec(trimmed);
  if (m) {
    const n = parseInt(m[1], 10);
    const unit = m[2].replace(/s$/, '');
    let ms;
    if (unit === 'day') ms = n * 86400000;
    else if (unit === 'week') ms = n * 7 * 86400000;
    else ms = n * 30 * 86400000;
    const target = new Date(now.getTime() - ms);
    target.setUTCHours(0, 0, 0, 0);
    return target.toISOString();
  }

  return value;
}

export function resolveTemporalParams(params, now = new Date()) {
  let { since, until } = params;

  if (since?.trim().toLowerCase() === 'yesterday' && (until === undefined || until === null)) {
    since = resolveTemporalShortcut('since', since, now);
    until = resolveTemporalShortcut('until', 'yesterday', now);
    return { since, until };
  }

  return {
    since: since !== undefined ? resolveTemporalShortcut('since', since, now) : since,
    until: until !== undefined ? resolveTemporalShortcut('until', until, now) : until,
  };
}
