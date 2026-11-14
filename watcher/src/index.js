// SENTINEL breaking-news watcher (Cloudflare Worker, free plan).
//
// Every minute it polls the fastest sources (the Bluesky accounts of the wire services, a rotating
// pair of other major outlets, and USGS earthquakes). It asks GitHub Actions to run the publish workflow immediately when a new
// severity 4–5 incident appears, or when a wire posts an update on a story the site is covering
// live (topics read from the site's /data/live.json). Every NUDGE_MINUTES it also starts a
// routine publish, because GitHub's own schedule is frequently delayed.
//
// The work per run is deliberately tiny (only new, recent headlines go through the shared
// classifier) so it fits the Workers Free 10ms CPU limit; time spent waiting on the network
// does not count.

import { classify } from '../../worker/src/analysis/classify.js';
import { quakeSeverity } from '../../worker/src/sources/usgs.js';
import { fetchWithTimeout } from '../../worker/src/lib/http.js';
import { topicFeatures, topicMatches } from '../../worker/src/analysis/live.js';

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
];
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
  const [live, ...results] = await Promise.allSettled([fetchLive(env.SITE_URL, now), ...accountsFor(now).map((w) => fetchWire(w)), fetchQuakes()]);
  const items = [];
  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value);
    else errors.push(r.reason?.message || String(r.reason));
  }
  if (live.status === 'rejected') errors.push(`live.json: ${live.reason?.message || live.reason}`);
  return { items, live: live.status === 'fulfilled' ? live.value : [], errors };
}

/** New, recent wire posts that match a story the site is covering live. */
export function findLiveUpdates(items, live, { now, seen }) {
  if (!live.length) return [];
  const out = [];
  for (const item of items) {
    if (!item.key.startsWith('bsky:') || seen.has(item.key) || now - item.time > item.maxAgeMs || item.time > now + 5 * 60000) continue;
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

export async function dispatchPublish(env, reason) {
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
    body: JSON.stringify({ ref: env.GITHUB_REF || 'main', inputs: { reason: reason.slice(0, 200) } }),
  });
  if (res.status !== 204) throw new Error(`GitHub dispatch failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return { dryRun: false };
}

export async function tick(env, now = Date.now(), deps = { fetchSources, dispatchPublish }) {
  const kv = env.WATCHER_KV;
  const state = (kv && (await kv.get('state', 'json'))) || { seen: [], lastBreakingAt: 0 };
  const { items, live = [], errors } = await deps.fetchSources(env, now);
  const seen = new Set(state.seen);
  const breaking = kv ? findBreaking(items, { now, seen, minSeverity: Number(env.BREAKING_MIN_SEVERITY || 4) }) : [];
  const liveUpdates = kv ? findLiveUpdates(items, live, { now, seen }) : [];
  const nudgeEvery = Number(env.NUDGE_MINUTES || 5);
  const result = { at: new Date(now).toISOString(), checked: items.length, live: live.length, errors, action: 'none' };

  // Items are only marked as seen once a publish has been requested, so a story that arrives
  // during the cool-down is picked up on the next minute instead of being dropped.
  const fast = breaking.length || liveUpdates.length;
  if (fast && now - state.lastBreakingAt >= MIN_GAP_MS) {
    const lead = breaking[0] || liveUpdates[0];
    const reason = breaking.length ? `Breaking (${lead.source}): ${lead.title}` : `Live update (${lead.source}): ${lead.title}`;
    const sent = await deps.dispatchPublish(env, reason);
    state.seen = [...breaking.map((b) => b.key), ...liveUpdates.map((u) => u.key), ...state.seen].slice(0, SEEN_LIMIT);
    state.lastBreakingAt = now;
    await kv.put('state', JSON.stringify(state));
    Object.assign(result, {
      action: breaking.length ? 'breaking' : 'live-update',
      dryRun: sent.dryRun,
      headlines: [...breaking, ...liveUpdates].map((b) => `${b.source}: ${b.title}`),
    });
  } else if (nudgeEvery > 0 && Math.floor(now / 60000) % nudgeEvery === 0) {
    const sent = await deps.dispatchPublish(env, 'Routine check');
    Object.assign(result, { action: 'nudge', dryRun: sent.dryRun });
  }
  if (!kv) result.warning = 'WATCHER_KV is not bound; breaking detection is off';
  return result;
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
    const state = env.WATCHER_KV ? await env.WATCHER_KV.get('state', 'json') : null;
    const body = {
      service: 'sentinel-watcher',
      repo: env.GITHUB_REPO,
      breakingDetection: Boolean(env.WATCHER_KV),
      dispatchConfigured: Boolean(env.GITHUB_TOKEN) && env.DRY_RUN !== 'true',
      lastBreakingAt: state?.lastBreakingAt ? new Date(state.lastBreakingAt).toISOString() : null,
      storiesSeen: state?.seen?.length || 0,
    };
    return new Response(JSON.stringify(body, null, 2), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  },
};
