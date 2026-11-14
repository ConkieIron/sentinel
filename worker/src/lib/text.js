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
