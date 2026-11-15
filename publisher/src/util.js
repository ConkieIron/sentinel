export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function safeHref(u) {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '#';
  } catch {
    return '#';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

export function fmtUtc(ts, { withYear = false } = {}) {
  const d = new Date(ts);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ' ' + d.getUTCFullYear() : ''}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function ago(ts, now) {
  const m = Math.max(0, Math.round((now - ts) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} hr ago`;
  const d = Math.floor(m / 1440);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

export function timeTag(ts, now) {
  const iso = new Date(ts).toISOString();
  return `<time datetime="${iso}" title="${esc(fmtUtc(ts, { withYear: true }))}" data-rel>${esc(ago(ts, now))}</time>`;
}

/** Clock time ("14:05", UTC in the HTML; the script switches it to the reader's time zone). */
export function clockTag(ts) {
  const d = new Date(ts);
  return `<time class="clock" datetime="${d.toISOString()}" title="${esc(fmtUtc(ts, { withYear: true }))}" data-clock>${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}</time>`;
}

export function trim(s, max) {
  const t = String(s || '').trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** Standfirst for a live update only when it adds facts the headline does not already carry. */
export function usefulUpdateDek(u, max = 220) {
  const title = String(u?.title || '').trim();
  const summary = String(u?.summary || '').trim();
  if (!summary || summary === title) return '';
  const words = (t) => t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const titleWords = new Set(words(title));
  const extra = words(summary).filter((w) => !titleWords.has(w));
  if (extra.length < 2) return '';
  if (summary.startsWith(title)) {
    const rest = summary.slice(title.length).replace(/^[\s.:\-–—]+/, '');
    return rest.length >= 40 ? trim(rest, max) : trim(summary, max);
  }
  return trim(summary, max);
}

export const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };

/** Same rule as the gatherer's counts: reported by an outlet or official source, not a look back. */
export const isReportedTerror = (i) => i.category === 'terrorism' && i.evidence !== 'social' && !i.retrospective;

/** The category a list filter files an incident under, so the terrorism chip agrees with the terrorism counts. */
export const filterCategory = (i) => (i.category === 'terrorism' && !isReportedTerror(i) ? 'unconfirmed' : i.category);

/** Latest leaves out severity-1 items (minor quakes, anniversaries). */
export const inLatest = (i) => i.severity >= 2;

/**
 * Rank by the severity badge first, then threat weight, then freshness.
 * A 5/5 always outranks a 4/5 — category and recency must not reorder severity levels.
 */
export const bySeriousness = (a, b) =>
  b.severity - a.severity || (b.weight ?? 0) - (a.weight ?? 0) || b.time - a.time;
export const TREND = {
  rising: ['▲', 'Rising'],
  falling: ['▼', 'Falling'],
  steady: ['▬', 'Steady'],
  new: ['•', 'Building baseline'],
};
export const EVIDENCE = {
  official: 'Official record',
  multi: 'Multiple outlets',
  publisher: 'Single outlet',
  social: 'Unverified social',
};
