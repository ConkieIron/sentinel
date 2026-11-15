// SENTINEL breaking-news watcher (Cloudflare Worker, free plan).
//
// Every minute it polls the fastest sources (the Bluesky accounts of the wire services, a rotating
// pair of other major outlets, and USGS earthquakes). It asks GitHub Actions to run the publish workflow immediately when a new
// severity 4–5 incident appears, or when a wire posts an update on a story the site is covering
// live (topics read from the site's /data/live.json). Every NUDGE_MINUTES it also starts a
// routine publish, because GitHub's own schedule is frequently delayed. Every HEALTH_MINUTES it
// checks the live edition's age and, if the site has stopped updating, forces a rebuild and sends
// an alert (see health.js).
//
// The work per run is deliberately tiny (only new, recent headlines go through the shared
// classifier) so it fits the Workers Free 10ms CPU limit; time spent waiting on the network
// does not count.

import { classify } from '../../worker/src/analysis/classify.js';
import { quakeSeverity } from '../../worker/src/sources/usgs.js';
import { fetchWithTimeout } from '../../worker/src/lib/http.js';
import { topicFeatures, topicMatches } from '../../worker/src/analysis/live.js';
import { checkSite, noteDispatchFailure, noteDispatchSuccess, notify, siteAge } from './health.js';

// The classifier's casualty patterns cost ~15ms to compile on first use. Doing it at load time
// moves that into Worker startup, which has its own 1s allowance, instead of the 10ms per run.
// The samples are varied so the engine has also optimised the less common code paths.
const WARM_UP = [
  'Gunmen kill at least 12 people in attack on village; dozens injured',
  'Death toll rises to 40 after suicide bombing at market, 25 wounded',
  'Magnitude 6.1 earthquake strikes coast, three people were killed',
  'FAA lifts nationwide ground stop after airline computer outage grounds U.S. flights',
  'Israeli airstrike on Gaza school kills dozens, health officials say',
  'Russia launches massive drone and missile attack on Kyiv overnight',
  'Police respond to reports of a shooting at a shopping centre in Manchester',
  'Protesters clash with riot police in Nairobi as tear gas fired',
  'Hurricane makes landfall in Florida as millions without power',
  'Train derails in northern India, injuring more than 100 passengers',
  'WHO declares outbreak a public health emergency of international concern',
  'Stock markets rally as central bank holds interest rates steady',
  'Prime minister announces new cabinet after coalition talks collapse',
  'Ransomware attack forces hospitals to divert ambulances',
  'Hostages freed after armed standoff at embassy; suspect detained',
  'Opinion: Why the election result matters for Europe',
  // Non-ASCII text makes normalize() load its Unicode tables (~5ms) on first use.
  '‘Explosion’ reported near café in São Paulo — Côte d’Ivoire envoy among injured',
];
for (const sample of WARM_UP) classify(sample);
const warmTopic = { terms: { faa: 1, ground: 1, stop: 1 }, phrases: ['ground~stop'], minScore: 1 };
for (const sample of WARM_UP) topicMatches(topicFeatures(sample), warmTopic);

const APPVIEW = 'https://public.api.bsky.app';
// Each request costs about 1ms of the 10ms CPU allowance, so the wires are polled every minute
// and the other outlets in rotation, ROTATE_PER_RUN at a time (each every 3–4 minutes).
const WIRES = [
  { handle: 'reuters.com', name: 'Reuters' },
  { handle: 'apnews.com', name: 'Associated Press' },
  { handle: 'cnn.com', name: 'CNN' },
];
const ROTATING = [
  { handle: 'afp.com', name: 'AFP' },
  { handle: 'nbcnews.com', name: 'NBC News' },
  { handle: 'theguardian.com', name: 'The Guardian' },
  { handle: 'nytimes.com', name: 'The New York Times' },
  { handle: 'washingtonpost.com', name: 'The Washington Post' },
  { handle: 'news.sky.com', name: 'Sky News' },
  { handle: 'aljazeera.com', name: 'Al Jazeera' },
  { handle: 'wsj.com', name: 'The Wall Street Journal' },
];
// Fox has no usable official Bluesky account; its world RSS is polled alongside the rotate set.
const FOX_RSS = {
  id: 'fox-watch',
  name: 'Fox News',
  url: 'https://moxie.foxnews.com/google-publisher/world.xml',
};
const ROTATE_PER_RUN = 2;
// live.json only changes when the site is published, so it is re-read every few minutes.
const LIVE_TTL_MS = 3 * 60000;

export function accountsFor(now) {
  const start = (Math.floor(now / 60000) * ROTATE_PER_RUN) % ROTATING.length;
  return [...WIRES, ...Array.from({ length: ROTATE_PER_RUN }, (_, i) => ROTATING[(start + i) % ROTATING.length])];
}
const USGS_HOUR = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_hour.geojson';
const WIRE_MAX_AGE_MS = 30 * 60000;
// USGS publishes quakes several minutes after the event, so their window is longer.
const QUAKE_MAX_AGE_MS = 90 * 60000;
const MIN_GAP_MS = 90 * 1000;
const SEEN_LIMIT = 300;

const stripFlash = (s) =>
  String(s || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*(?:breaking(?: news)?|just in|urgent|developing|update|new)\s*[:!\-–—]+\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchWire(account) {
  // Busy accounts post a few times an hour and this runs every minute, so the latest few posts are
  // enough; parsing the responses is most of the CPU time.
  const url = `${APPVIEW}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(account.handle)}&limit=5&filter=posts_no_replies`;
  const res = await fetchWithTimeout(url, { timeoutMs: 8000, headers: { Accept: 'application/json' } });
  const data = await res.json();
  const items = [];
  for (const entry of data.feed || []) {
    if (entry.reason) continue;
    const post = entry.post || {};
    const external = post.embed?.external || post.embed?.media?.external;
    const title = stripFlash(external?.title || post.record?.text);
    // indexedAt is when Bluesky received the post, so late-arriving posts still count as fresh.
    const time = Date.parse(post.indexedAt || post.record?.createdAt);
    if (title.length < 20 || !Number.isFinite(time)) continue;
    items.push({ key: `bsky:${post.uri}`, source: account.name, title, time, maxAgeMs: WIRE_MAX_AGE_MS });
  }
  return items;
}

async function fetchQuakes() {
  const res = await fetchWithTimeout(USGS_HOUR, { timeoutMs: 8000, headers: { Accept: 'application/geo+json, application/json' } });
  const data = await res.json();
  return (data.features || []).map((f) => {
    const p = f.properties || {};
    const mag = Number(p.mag) || 0;
    return {
      key: `usgs:${f.id}`,
      source: 'USGS',
      title: `M${mag.toFixed(1)} earthquake — ${p.place || 'location unknown'}`,
      time: Number(p.time) || 0,
      maxAgeMs: QUAKE_MAX_AGE_MS,
      severity: quakeSeverity(mag, p.alert, p.tsunami),
    };
  });
}

/** Fox world RSS — polled every run because Fox has no official Bluesky account. */
async function fetchFoxRss() {
  const res = await fetchWithTimeout(FOX_RSS.url, {
    timeoutMs: 8000,
    headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' },
  });
  const xml = await res.text();
  const items = [];
  for (const block of xml.match(/<item\b[\s\S]*?<\/item>/gi) || []) {
    const title = stripFlash(
      (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .trim(),
    );
    const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    const time = Date.parse(block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '');
    if (title.length < 20 || !Number.isFinite(time) || !link) continue;
    items.push({ key: `rss:${link}`, source: FOX_RSS.name, title, time, maxAgeMs: WIRE_MAX_AGE_MS });
    if (items.length >= 5) break;
  }
  return items;
}

let liveCache = { at: 0, stories: [] };

async function fetchLive(siteUrl, now) {
  if (!siteUrl) return [];
  if (now - liveCache.at < LIVE_TTL_MS) return liveCache.stories;
  const res = await fetchWithTimeout(`${siteUrl.replace(/\/$/, '')}/data/live.json`, { timeoutMs: 8000, headers: { Accept: 'application/json' } });
  const data = await res.json();
  const stories = (data.stories || []).map((s) => ({ id: s.id, title: s.title, topics: s.topics || [] }));
  liveCache = { at: now, stories };
  return stories;
}

export async function fetchSources(env = {}, now = Date.now()) {
  const [live, ...results] = await Promise.allSettled([
    fetchLive(env.SITE_URL, now),
    ...accountsFor(now).map((w) => fetchWire(w)),
    fetchQuakes(),
    fetchFoxRss(),
  ]);
  const items = [];
  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(r.reason?.message || String(r.reason));
  }
  if (live.status === 'rejected') errors.push(`live.json: ${live.reason?.message || live.reason}`);
  return { items, live: live.status === 'fulfilled' ? live.value : [], errors };
}

/** New, recent wire/RSS posts that match a story the site is covering live. */
export function findLiveUpdates(items, live, { now, seen }) {
  if (!live.length) return [];
  const out = [];
  for (const item of items) {
    if ((!item.key.startsWith('bsky:') && !item.key.startsWith('rss:')) || seen.has(item.key) || now - item.time > item.maxAgeMs || item.time > now + 5 * 60000) continue;
    const features = topicFeatures(item.title);
    const story = live.find((s) => s.topics.some((t) => topicMatches(features, t)));
    if (story) out.push({ ...item, story });
  }
  return out.sort((a, b) => b.time - a.time);
}

// Classifier results survive between runs while Cloudflare reuses the isolate. KV would make
// them permanent, but writing it every minute would exceed the free plan's 1,000 writes a day.
const classified = new Map();
const CLASSIFIED_LIMIT = 500;

function classifyCached(item) {
  if (item.severity) return { severity: item.severity, retrospective: false };
  if (classified.has(item.key)) return classified.get(item.key);
  const cls = classify(item.title);
  classified.set(item.key, cls);
  if (classified.size > CLASSIFIED_LIMIT) classified.delete(classified.keys().next().value);
  return cls;
}

/**
 * New, recent items that the shared classifier rates at or above minSeverity. At most
 * maxClassify uncached headlines are classified per run (newest first) to bound CPU time;
 * the rest are picked up on the next run.
 */
export function findBreaking(items, { now, seen, minSeverity = 4, maxClassify = 20 }) {
  const out = [];
  let budget = maxClassify;
  const fresh = items
    .filter((item) => !seen.has(item.key) && now - item.time <= item.maxAgeMs && item.time <= now + 5 * 60000)
    .sort((a, b) => b.time - a.time);
  for (const item of fresh) {
    const cached = item.severity || classified.has(item.key);
    if (!cached && budget-- <= 0) continue;
    const cls = classifyCached(item);
    if (!cls || cls.retrospective || cls.severity < minSeverity) continue;
    out.push({ ...item, severity: cls.severity });
  }
  return out.sort((a, b) => b.severity - a.severity || b.time - a.time);
}

export async function dispatchPublish(env, reason, { force = false } = {}) {
  if (env.DRY_RUN === 'true' || !env.GITHUB_TOKEN) return { dryRun: true };
  const repo = env.GITHUB_REPO;
  const workflow = env.GITHUB_WORKFLOW || 'publish-pages.yml';
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'sentinel-watcher',
    },
    body: JSON.stringify({ ref: env.GITHUB_REF || 'main', inputs: { reason: reason.slice(0, 200), ...(force && { force: 'true' }) } }),
  });
  if (res.status !== 204) throw new Error(`GitHub dispatch failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { dryRun: false };
}

const DEPS = { fetchSources, dispatchPublish, siteAge, notify };

export async function tick(env, now = Date.now(), overrides = {}) {
  const deps = { ...DEPS, ...overrides };
  const kv = env.WATCHER_KV;
  const minute = Math.floor(now / 60000);

  // Health lives in the same KV record as the seen list, which is read every run anyway; the
  // record is written back only if either part changed.
  const state = (kv && (await kv.get('state', 'json'))) || { seen: [], lastBreakingAt: 0 };
  let health = state.health || {};
  const healthJson = JSON.stringify(health);
  let stateChanged = false;
  const dispatch = async (reason) => {
    try {
      const sent = await deps.dispatchPublish(env, reason);
      health = await noteDispatchSuccess(env, health, deps);
      return sent;
    } catch (err) {
      health = await noteDispatchFailure(env, now, health, err, deps);
      throw err;
    }
  };

  try {
    const { items, live = [], errors } = await deps.fetchSources(env, now);
    const seen = new Set(state.seen);
    const breaking = kv ? findBreaking(items, { now, seen, minSeverity: Number(env.BREAKING_MIN_SEVERITY || 4) }) : [];
    const liveUpdates = kv ? findLiveUpdates(items, live, { now, seen }) : [];
    const nudgeEvery = Number(env.NUDGE_MINUTES || 5);
    const healthEvery = Number(env.HEALTH_MINUTES || 5);
    const result = { at: new Date(now).toISOString(), checked: items.length, live: live.length, errors, action: 'none' };

    // Items are only marked as seen once a publish has been requested, so a story that arrives
    // during the cool-down is picked up on the next minute instead of being dropped.
    const fast = breaking.length || liveUpdates.length;
    if (fast && now - state.lastBreakingAt >= MIN_GAP_MS) {
      const lead = breaking[0] || liveUpdates[0];
      const reason = breaking.length ? `Breaking (${lead.source}): ${lead.title}` : `Live update (${lead.source}): ${lead.title}`;
      const sent = await dispatch(reason);
      state.seen = [...breaking.map((b) => b.key), ...liveUpdates.map((u) => u.key), ...state.seen].slice(0, SEEN_LIMIT);
      state.lastBreakingAt = now;
      stateChanged = true;
      Object.assign(result, {
        action: breaking.length ? 'breaking' : 'live-update',
        dryRun: sent.dryRun,
        headlines: [...breaking, ...liveUpdates].map((b) => `${b.source}: ${b.title}`),
      });
    } else if (nudgeEvery > 0 && minute % nudgeEvery === 0) {
      const sent = await dispatch('Routine check');
      Object.assign(result, { action: 'nudge', dryRun: sent.dryRun });
    }

    // Offset from the nudge minute so the two never share one run's CPU allowance.
    if (env.SITE_URL && healthEvery > 0 && minute % healthEvery === 2 % healthEvery) {
      const check = await checkSite(env, now, health, deps);
      health = check.health;
      result.site = { editionAt: check.siteAt ? new Date(check.siteAt).toISOString() : null, actions: check.actions };
    }
    if (!kv) result.warning = 'WATCHER_KV is not bound; breaking detection is off';
    return result;
  } finally {
    if (kv && (stateChanged || JSON.stringify(health) !== healthJson)) await kv.put('state', JSON.stringify({ ...state, health }));
  }
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      tick(env, controller.scheduledTime).then(
        (r) => console.log(JSON.stringify({ event: 'watch', ...r })),
        (err) => console.error(JSON.stringify({ event: 'watch', error: err.message })),
      ),
    );
  },

  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/') return new Response('Not found', { status: 404 });
    const now = Date.now();
    const iso = (t) => (t ? new Date(t).toISOString() : null);
    const [state, editionAt] = await Promise.all([
      env.WATCHER_KV ? env.WATCHER_KV.get('state', 'json') : null,
      env.SITE_URL ? siteAge(env, now).catch(() => null) : null,
    ]);
    const health = state?.health;
    const body = {
      service: 'sentinel-watcher',
      repo: env.GITHUB_REPO,
      breakingDetection: Boolean(env.WATCHER_KV),
      dispatchConfigured: Boolean(env.GITHUB_TOKEN) && env.DRY_RUN !== 'true',
      alerts: env.NTFY_TOPIC ? (env.ALERT_EMAIL ? 'ntfy push and email' : 'ntfy push') : 'not configured (set the NTFY_TOPIC secret)',
      lastBreakingAt: iso(state?.lastBreakingAt),
      storiesSeen: state?.seen?.length || 0,
      site: {
        lastEditionAt: iso(editionAt),
        minutesSinceLastEdition: editionAt ? Math.round((now - editionAt) / 60000) : null,
        staleAfterMinutes: Number(env.STALE_MINUTES || 90),
        status: !editionAt ? 'unreachable' : now - editionAt > Number(env.STALE_MINUTES || 90) * 60000 ? 'stale' : 'ok',
      },
      problems: {
        staleSince: iso(health?.staleSince),
        lastForcedRebuildAt: iso(health?.lastForceAt),
        publishRequestsFailingSince: iso(health?.dispatchFailingSince),
        lastError: health?.lastError || null,
      },
    };
    return new Response(JSON.stringify(body, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};
