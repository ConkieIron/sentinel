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

export function trim(s, max) {
  const t = String(s || '').trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

export const LEVEL_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
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
