// Bluesky (AT Protocol) public data.
//  - Publisher accounts: app.bsky.feed.getAuthorFeed is public and unauthenticated.
//  - Keyword search: app.bsky.feed.searchPosts. Tries the public AppView first; if Bluesky
//    requires auth, falls back to an app-password session (BSKY_HANDLE / BSKY_APP_PASSWORD).

import { fetchWithTimeout } from '../lib/http.js';
import { safeUrl, parseTime, truncate } from '../lib/text.js';

const PUBLIC_APPVIEW = 'https://public.api.bsky.app';

function postUrl(post) {
  const rkey = String(post.uri || '').split('/').pop();
  return `https://bsky.app/profile/${post.author?.handle || post.author?.did}/post/${rkey}`;
}

function cleanPostText(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[a-z0-9-]+\.[a-z]{2,}\/\S+/gi, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchPublisherFeed(account, { now, windowMs, maxItems }) {
  const url = `${PUBLIC_APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(account.handle)}&limit=50&filter=posts_no_replies`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  const items = [];
  let newest = 0;
  for (const entry of data.feed || []) {
    if (entry.reason) continue; // reposts
    const post = entry.post || {};
    const record = post.record || {};
    const time = parseTime(record.createdAt || post.indexedAt);
    if (time) newest = Math.max(newest, time);
    if (!time || now - time > windowMs) continue;
    const external = post.embed?.external || post.embed?.media?.external;
    const title = cleanPostText(external?.title || record.text);
    if (title.length < 25 || /^(?:here[’']?s the latest|live updates?|watch|read more)\b/i.test(title)) continue;
    items.push({
      sourceId: account.id,
      sourceName: account.name,
      type: 'publisher',
      title: truncate(title, 220),
      summary: truncate(cleanPostText(external?.description || (external ? record.text : '')), 400),
      url: safeUrl(external?.uri) || postUrl(post),
      time: Math.min(time, now),
      via: 'Bluesky',
    });
    if (items.length >= maxItems) break;
  }
  return { items, parsed: (data.feed || []).length, newest: newest || null };
}

async function getSession(env) {
  if (!env.BSKY_HANDLE || !env.BSKY_APP_PASSWORD) return null;
  const cached = env.SENTINEL_KV ? await env.SENTINEL_KV.get('bsky:session', 'json') : null;
  if (cached?.accessJwt && cached.expires > Date.now()) return cached;
  const res = await fetchWithTimeout('https://bsky.social/xrpc/com.atproto.server.createSession', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: env.BSKY_HANDLE, password: env.BSKY_APP_PASSWORD }),
  });
  const data = await res.json();
  const session = { accessJwt: data.accessJwt, expires: Date.now() + 90 * 60 * 1000 };
  if (env.SENTINEL_KV) await env.SENTINEL_KV.put('bsky:session', JSON.stringify(session), { expirationTtl: 5400 });
  return session;
}

async function search(query, env) {
  const params = `q=${encodeURIComponent(query)}&sort=latest&limit=40&lang=en`;
  const appview = env.BSKY_APPVIEW || 'https://api.bsky.app';
  try {
    const res = await fetchWithTimeout(`${appview}/xrpc/app.bsky.feed.searchPosts?${params}`, { headers: { Accept: 'application/json' } });
    return { data: await res.json(), auth: false };
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    const session = await getSession(env);
    if (!session) throw new Error('Bluesky search requires login: set BSKY_HANDLE and BSKY_APP_PASSWORD secrets');
    const res = await fetchWithTimeout(`https://bsky.social/xrpc/app.bsky.feed.searchPosts?${params}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${session.accessJwt}` },
    });
    return { data: await res.json(), auth: true };
  }
}

const OPINION =
  /\b(?:i think|i believe|i feel|imo|imho|in my opinion|lol|lmao|wtf|btw|smh|thoughts and prayers|pray for|why is|why are|how is|can't believe|reminder that|in case you|incase you|unpopular opinion|hot take|thread|fuck\w*|shit)\b/i;
const NOISE =
  /\b(?:game|movie|film|novel|episode|trailer|album|song|fiction|fanfic|podcast|giveaway|sale|discount|subscribe|crypto|nft|director|documentary|doco|book|author|pope|vibe check)\b/i;

const SATIRE =
  /\b(?:(?:news|film|more) at 11|in what may have been|unable to determine whether|area (?:man|woman)|local (?:man|woman) who|sources confirm nobody|satire|parody)\b|(?:^|\s)\/s(?:\s|$)/i;
const SATIRE_HANDLES = /(?:onion|babylonbee|dailymash|newsthump|reductress|beaverton|clickhole|waterfordwhispers|duffelblog|thehardtimes|borowitz)/i;

export function isUsableSocialPost(text, record, handle = '') {
  if (!text || text.length < 60) return false;
  if (record.reply) return false;
  if (SATIRE_HANDLES.test(handle) || SATIRE.test(text)) return false;
  if (OPINION.test(text) || NOISE.test(text)) return false;
  if ((text.match(/#/g) || []).length > 4) return false;
  if ((text.match(/\?/g) || []).length > 1) return false;
  const words = text.split(/\s+/).length;
  return words >= 10;
}

export async function fetchSocialSearch(queries, env, { now, windowMs, excludeHandles }) {
  const results = await Promise.allSettled(queries.map((q) => search(q, env)));
  const seen = new Set();
  const items = [];
  let ok = 0;
  let newest = 0;
  let lastError = null;
  let usedAuth = false;
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      lastError = r.reason?.message || String(r.reason);
      continue;
    }
    ok++;
    usedAuth ||= r.value.auth;
    for (const post of r.value.data.posts || []) {
      if (seen.has(post.uri) || excludeHandles.has(post.author?.handle)) continue;
      seen.add(post.uri);
      const record = post.record || {};
      const time = parseTime(record.createdAt || post.indexedAt);
      if (time) newest = Math.max(newest, time);
      if (!time || now - time > windowMs) continue;
      if ((post.labels || []).length || (post.author?.labels || []).length) continue;
      const text = cleanPostText(record.text);
      if (!isUsableSocialPost(text, record, post.author?.handle)) continue;
      const body = text.replace(/^(?:breaking|urgent|just in|developing)\s*[:!\-–—]*\s*/i, '');
      const firstSentence = body.match(/^.{30,170}?[.!](?=\s|$)/)?.[0] || body;
      items.push({
        sourceId: 'bsky-search',
        sourceName: `Bluesky · @${post.author?.handle || 'unknown'}`,
        type: 'social',
        title: truncate(firstSentence.split(/\s*[•|]\s*/)[0], 160),
        summary: truncate(text, 400),
        url: postUrl(post),
        time: Math.min(time, now),
        engagement: (post.likeCount || 0) + 2 * (post.repostCount || 0),
      });
    }
  }
  if (!ok) throw new Error(lastError || 'All Bluesky searches failed');
  return { items, parsed: seen.size, newest: newest || null, note: usedAuth ? 'authenticated search' : 'public search', partialError: ok < queries.length ? lastError : null };
}
