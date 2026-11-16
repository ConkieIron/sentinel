// Resolve Google News RSS wrapper URLs (news.google.com/rss/articles/…) to the publisher page.
// Post-2024 wrappers are opaque; resolution needs the per-article signature then a batchexecute RPC.

import { fetchWithTimeout } from '../lib/http.js';
import { safeUrl } from '../lib/text.js';

const BATCH_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute';
const BROWSER_UA =
  'Mozilla/5.0 (compatible; SentinelGlobalNews/1.0; +https://globalsentinel.co.uk)';

export function isGoogleNewsUrl(url) {
  return /news\.google\.com\/rss\/articles\//i.test(String(url || ''));
}

function articleId(url) {
  return String(url).split('/').pop().split('?')[0];
}

/**
 * Best-effort unwrap. Returns the publisher URL, or the original wrapper if resolution fails.
 * Caps concurrent work via fetchWithTimeout's shared gate.
 */
export async function resolveGoogleNewsUrl(url) {
  if (!isGoogleNewsUrl(url)) return url;
  try {
    const page = await fetchWithTimeout(url, {
      timeoutMs: 8000,
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html', Cookie: 'CONSENT=YES+' },
    });
    const html = await page.text();
    const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
    if (!sig || !ts) return url;

    const rpcInner = JSON.stringify([
      'garturlreq',
      [
        ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
        'X',
        'X',
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
      ],
      articleId(url),
      Number(ts),
      sig,
    ]);
    const fReq = JSON.stringify([[['Fbv4je', rpcInner, null, 'generic']]]);
    const res = await fetchWithTimeout(BATCH_URL, {
      method: 'POST',
      timeoutMs: 8000,
      headers: {
        'User-Agent': BROWSER_UA,
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        Referer: 'https://news.google.com/',
      },
      body: `f.req=${encodeURIComponent(fReq)}`,
    });
    let body = await res.text();
    if (body.startsWith(")]}'")) body = body.slice(4);
    const match = body.match(/"garturlres","(https?:[^"]+)"/);
    const resolved = match ? safeUrl(match[1].replace(/\\u003d/g, '=').replace(/\\+/g, '')) : null;
    return resolved || url;
  } catch {
    return url;
  }
}

/** Resolve wrappers for a list of items; at most `limit` lookups, soft-fail. Sets via when resolved. */
export async function resolveGoogleNewsItems(items, { limit = 12 } = {}) {
  let left = limit;
  const out = [];
  for (const item of items) {
    if (left <= 0 || !isGoogleNewsUrl(item.url)) {
      out.push(item);
      continue;
    }
    left--;
    const resolved = await resolveGoogleNewsUrl(item.url);
    const viaGoogle = isGoogleNewsUrl(resolved);
    out.push({
      ...item,
      url: resolved,
      via: viaGoogle ? item.via : item.via || 'Google News',
    });
  }
  return out;
}
