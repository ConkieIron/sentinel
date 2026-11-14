// SENTINEL data gatherer — Cloudflare Worker.
//
//  scheduled (cron)    → run pipeline, store snapshot in KV, trigger Pages rebuild when due
//  GET  /snapshot.json → latest snapshot (read by the Pages build)
//  GET  /health        → run + source status
//  POST /run           → manual run (requires `Authorization: Bearer <RUN_TOKEN>`)

import { runPipeline, appendHistory } from './pipeline.js';
import { refreshTravelAdvice, travelForSnapshot } from './sources/travel.js';

const KEYS = { snapshot: 'snapshot:latest', history: 'history:hourly', meta: 'meta:run', travel: 'travel:advice' };

async function readJson(env, key, fallback) {
  try {
    return (await env.SENTINEL_KV.get(key, 'json')) ?? fallback;
  } catch {
    return fallback;
  }
}

async function maybeTriggerPublish(env, snapshot, previousMeta, now) {
  if (!env.PAGES_DEPLOY_HOOK) return { triggered: false, reason: 'PAGES_DEPLOY_HOOK not configured' };
  const intervalMs = Number(env.PUBLISH_INTERVAL_MINUTES || 120) * 60000;
  const breakingMs = Number(env.BREAKING_PUBLISH_MINUTES || 20) * 60000;
  const last = previousMeta?.lastPublishAt || 0;
  const newBreaking = snapshot.breakingId && snapshot.breakingId !== previousMeta?.lastPublishedBreakingId;
  const due = now - last >= intervalMs || (newBreaking && now - last >= breakingMs);
  if (!due) return { triggered: false, reason: 'not due' };
  const res = await fetch(env.PAGES_DEPLOY_HOOK, { method: 'POST' });
  return { triggered: res.ok, status: res.status, reason: newBreaking ? 'new breaking incident' : 'interval' };
}

export async function gather(env, now = Date.now()) {
  const history = await readJson(env, KEYS.history, []);
  const previousMeta = await readJson(env, KEYS.meta, {});
  const cachedTravel = await readJson(env, KEYS.travel, null);
  const [snapshot, travel] = await Promise.all([runPipeline(env, { now, history }), refreshTravelAdvice(cachedTravel, now).catch(() => cachedTravel)]);
  const nextHistory = appendHistory(history, snapshot, now);
  snapshot.history = nextHistory;
  snapshot.travel = travelForSnapshot(travel, snapshot.incidents, now, snapshot.windowHours * 3600000);

  await env.SENTINEL_KV.put(KEYS.snapshot, JSON.stringify(snapshot));
  await env.SENTINEL_KV.put(KEYS.history, JSON.stringify(nextHistory));
  if (travel && travel !== cachedTravel) await env.SENTINEL_KV.put(KEYS.travel, JSON.stringify(travel));

  let publish;
  try {
    publish = await maybeTriggerPublish(env, snapshot, previousMeta, now);
  } catch (err) {
    publish = { triggered: false, reason: String(err?.message || err) };
  }
  const meta = {
    lastRunAt: now,
    lastRunMs: Date.now() - now,
    incidents: snapshot.incidents.length,
    sourcesOnline: snapshot.stats.sourcesOnline,
    sourcesTotal: snapshot.stats.sourcesTotal,
    lastPublishAt: publish.triggered ? now : previousMeta.lastPublishAt || null,
    lastPublishedBreakingId: publish.triggered ? snapshot.breakingId : previousMeta.lastPublishedBreakingId || null,
    publish,
  };
  await env.SENTINEL_KV.put(KEYS.meta, JSON.stringify(meta));
  return { snapshot, meta };
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

function json(body, status = 200, extra = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

function authorised(request, env) {
  const token = env.RUN_TOKEN;
  if (!token) return false;
  const header = request.headers.get('Authorization') || '';
  return header === `Bearer ${token}`;
}

export default {
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      gather(env).then(
        ({ meta }) => console.log(JSON.stringify({ event: 'gather', ...meta })),
        (err) => console.error('gather failed', err?.stack || err),
      ),
    );
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/snapshot.json' && request.method === 'GET') {
      const body = await env.SENTINEL_KV.get(KEYS.snapshot);
      if (!body) return json({ error: 'No snapshot yet. Wait for the first scheduled run or POST /run.' }, 503);
      return json(body, 200, { 'Cache-Control': 'public, max-age=60' });
    }

    if (url.pathname === '/health' && request.method === 'GET') {
      const meta = await readJson(env, KEYS.meta, null);
      const snapshot = await readJson(env, KEYS.snapshot, null);
      return json({
        ok: Boolean(meta),
        lastRun: meta?.lastRunAt ? new Date(meta.lastRunAt).toISOString() : null,
        lastPublish: meta?.lastPublishAt ? new Date(meta.lastPublishAt).toISOString() : null,
        publish: meta?.publish || null,
        incidents: meta?.incidents ?? 0,
        sources: snapshot?.sources?.map(({ id, name, ok, items, error, newest }) => ({ id, name, ok, items, error, newest })) || [],
      });
    }

    if (url.pathname === '/run' && request.method === 'POST') {
      if (!authorised(request, env)) return json({ error: 'Unauthorised. Set RUN_TOKEN and send it as a Bearer token.' }, 401);
      const { snapshot, meta } = await gather(env);
      return json({ ok: true, meta, stats: snapshot.stats });
    }

    if (url.pathname === '/') {
      return json({
        service: 'SENTINEL data gatherer',
        endpoints: { snapshot: '/snapshot.json', health: '/health', run: 'POST /run (Bearer RUN_TOKEN)' },
        site: env.SITE_URL || null,
      });
    }
    return json({ error: 'Not found' }, 404);
  },
};
