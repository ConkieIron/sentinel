const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…', pound: '£', euro: '€', eacute: 'é',
};

export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function stripHtml(s) {
  let html = String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  if (/&lt;\/?[a-z]/i.test(html)) html = decodeEntities(html);
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s, max) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

const WIRE_TAIL =
  /\s*[:\-–—|]\s*(?:Reuters|AP|AFP|PA|UPI|Bloomberg|BBC(?:\s+News)?|CNN|Fox News|USA Today|The Guardian|Sky News|NPR)\s*[.…]*$/i;

/**
 * Turn a lede / card-description pasted as a title into a short headline.
 * Deterministic: strip wire tails, prefer a buried news clause, else soft-cut or truncate.
 */
export function compactHeadline(title, max = 110) {
  let t = String(title || '')
    .replace(/\s+/g, ' ')
    .replace(WIRE_TAIL, '')
    .replace(/\s*[.…]+$/, '')
    .trim();
  if (!t) return '';
  if (t.length <= max) return t;

  // Ledes often bury the news: "… led the FAA to declare a nationwide ground stop on Nov. 13."
  // Allow "." inside abbreviations (Nov. 13) but stop at a real sentence end.
  const buried = t.match(
    /\b((?:the\s+)?(?:[A-Z][\w'’.-]+(?:\s+(?:the|of|and|for|to|a|an|[A-Z][\w'’.-]+)){0,10})\s+(?:to\s+)?(?:declare|announc\w*|say|says|said|lift\w*|ground\w*|kill\w*|hit|hits|strike\w*|restor\w*|halt\w*|order\w*|sentence\w*|detain\w*|arrest\w*|confirm\w*|warn\w*|block\w*|shut\w*)\b(?:[^.!?]|\.(?=\s*[a-z0-9])){0,90})/,
  );
  if (buried) {
    let clause = buried[1].replace(/^\s*the\s+/i, '').replace(/[,;:\s]+$/, '').trim();
    if (clause.length >= 36) return clause.length <= max ? clause : truncate(clause, max);
  }

  const first = t.match(/^(.+?[.!?])(?:\s|$)/);
  if (first && first[1].length >= 40 && first[1].length <= max) {
    return first[1].replace(/[.!?]$/, '').trim();
  }

  const soft = t.slice(0, max + 1).match(/^(.{40,}?)\s+(?:after|as|when|because|amid|following|that|which|who)\b/i);
  if (soft) return soft[1].replace(/[,;:]\s*$/, '') + '…';

  return truncate(t, max);
}

// Lowercase, accent-free, punctuation-free text for matching. Case-sensitive
// abbreviations are rewritten first so "US" (country) is not confused with "us".
export function normaliseForMatch(s) {
  return String(s || '')
    .replace(/\bU\.S\.A?\.?(?=[\s,;:'’)]|$)|\bUSA\b|\bUS\b/g, ' unitedstates ')
    .replace(/\bU\.K\.?(?=[\s,;:'’)]|$)|\bUK\b/g, ' unitedkingdom ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// FNV-1a 32-bit hash → short stable id (sync; works in Workers and Node).
export function hashId(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function safeUrl(u) {
  try {
    const url = new URL(String(u || '').trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function parseTime(s) {
  const t = Date.parse(String(s || '').trim());
  return Number.isFinite(t) ? t : null;
}

const MONTH_INDEX = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4,
  jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};
const MONTH = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

/**
 * Calendar date named in a headline ("on Nov. 13", "13 November"). Used so a fresh re-post of
 * an older event is stamped with the event day, not the feed item's publish time.
 * @returns {number|null} UTC noon on that day, or null
 */
export function eventTimeFromTitle(title, now = Date.now()) {
  const t = String(title || '');
  // Prefer "on <date>" so "since Oct. 7" / open-ended ranges are ignored.
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
  // Undated month/day that would land in the future is last year (e.g. "on Dec. 20" in January).
  if (!year && ts > now + 12 * 3600000) {
    y -= 1;
    ts = Date.UTC(y, month, day, 12, 0, 0);
  }
  if (ts > now + 12 * 3600000) return null;
  return ts;
}

/** Prefer a headline's event day when the feed item is a later re-report of that day. */
export function effectiveItemTime(title, publishedAt, now = Date.now()) {
  const published = Number(publishedAt);
  if (!Number.isFinite(published)) return publishedAt;
  const event = eventTimeFromTitle(title, now);
  // Only rewrite when the named day is clearly older than the post (half a day+).
  if (event != null && published - event >= 12 * 3600000) return event;
  return published;
}
