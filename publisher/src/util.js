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

const MONTH_INDEX = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

/** Calendar day named in a headline ("on Nov. 13") — matches worker eventTimeFromTitle. */
export function eventTimeFromTitle(title, now = Date.now()) {
  const t = String(title || '');
  const m =
    t.match(new RegExp(`\\bon\\s+(${MONTH})\\.\\s*(\\d{1,2})(?:,?\\s*(\\d{4}))?\\b`, 'i')) ||
    t.match(new RegExp(`\\bon\\s+(\\d{1,2})\\s+(${MONTH})\\.?(?:,?\\s*(\\d{4}))?\\b`, 'i')) ||
    t.match(new RegExp(`\\b(${MONTH})\\.\\s*(\\d{1,2})(?:,\\s*(\\d{4}))?(?=\\s*[.!]?(?:\\s|$|:))`, 'i'));
  if (!m) return null;
  let monthName;
  let day;
  let year;
  if (/^\d/.test(m[1])) {
    day = Number(m[1]);
    monthName = m[2];
    year = m[3] ? Number(m[3]) : null;
  } else {
    monthName = m[1];
    day = Number(m[2]);
    year = m[3] ? Number(m[3]) : null;
  }
  const month = MONTH_INDEX[monthName.toLowerCase().replace(/\.$/, '')];
  if (month === undefined || !day || day < 1 || day > 31) return null;
  const nowDate = new Date(now);
  let y = year ?? nowDate.getUTCFullYear();
  let ts = Date.UTC(y, month, day, 12, 0, 0);
  if (!year && ts > now + 12 * 3600000) {
    y -= 1;
    ts = Date.UTC(y, month, day, 12, 0, 0);
  }
  if (ts > now + 12 * 3600000) return null;
  return ts;
}

/** Card timestamp: use the headline's event day when the feed post is a later rehash. */
export function displayTime(inc, now = Date.now()) {
  const published = Number(inc?.time);
  if (!Number.isFinite(published)) return published;
  const event = eventTimeFromTitle(inc.title, now);
  if (event != null && published - event >= 12 * 3600000) return event;
  return published;
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

const WIRE_TAIL =
  /\s*[:\-–—|]\s*(?:Reuters|AP|AFP|PA|UPI|Bloomberg|BBC(?:\s+News)?|CNN|Fox News|USA Today|The Guardian|Sky News|NPR)\s*[.…]*$/i;

/** Shorten lede-style titles pasted into the title field (matches worker compactHeadline). */
export function compactHeadline(title, max = 110) {
  let t = String(title || '')
    .replace(/\s+/g, ' ')
    .replace(WIRE_TAIL, '')
    .replace(/\s*[.…]+$/, '')
    .trim();
  if (!t) return '';
  if (t.length <= max) return t;

  const buried = t.match(
    /\b((?:the\s+)?(?:[A-Z][\w'’.-]+(?:\s+(?:the|of|and|for|to|a|an|[A-Z][\w'’.-]+)){0,10})\s+(?:to\s+)?(?:declare|announc\w*|say|says|said|lift\w*|ground\w*|kill\w*|hit|hits|strike\w*|restor\w*|halt\w*|order\w*|sentence\w*|detain\w*|arrest\w*|confirm\w*|warn\w*|block\w*|shut\w*)\b(?:[^.!?]|\.(?=\s*[a-z0-9])){0,90})/,
  );
  if (buried) {
    let clause = buried[1].replace(/^\s*the\s+/i, '').replace(/[,;:\s]+$/, '').trim();
    if (clause.length >= 36) return clause.length <= max ? clause : trim(clause, max);
  }

  const first = t.match(/^(.+?[.!?])(?:\s|$)/);
  if (first && first[1].length >= 40 && first[1].length <= max) {
    return first[1].replace(/[.!?]$/, '').trim();
  }

  const soft = t.slice(0, max + 1).match(/^(.{40,}?)\s+(?:after|as|when|because|amid|following|that|which|who)\b/i);
  if (soft) return soft[1].replace(/[,;:]\s*$/, '') + '…';

  return trim(t, max);
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
