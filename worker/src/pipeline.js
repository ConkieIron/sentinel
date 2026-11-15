// Gather → classify → locate → cluster → score. Pure function of (env, now); storage is the caller's job.

import { RSS_FEEDS, BLUESKY_PUBLISHERS, BLUESKY_SEARCHES, USGS_FEED, GDACS_FEED, MODEL } from './config.js';
import { fetchRss, fetchGdacs } from './sources/rss.js';
import { fetchUsgs } from './sources/usgs.js';
import { fetchPublisherFeed, fetchSocialSearch } from './sources/bluesky.js';
import { fetchMarkets } from './sources/markets.js';
import { classify, extractCasualties, CATEGORIES } from './analysis/classify.js';
import { locate, nearestCountry, COUNTRY_BY_ISO } from './analysis/geo.js';
import { clusterItems } from './analysis/cluster.js';
import { leanFor, LEAN } from './data/mediaLean.js';
import { incidentWeight, scoreRegions, pickBreaking, isReportedTerror } from './analysis/threat.js';
import { findLiveStories } from './analysis/live.js';
import { effectiveItemTime } from './lib/text.js';

export const SCHEMA_VERSION = 1;

async function runSource(meta, task) {
  const started = Date.now();
  const lean = leanFor(meta.name);
  const withLean = { ...meta, lean: lean !== 'unrated' ? lean : undefined };
  try {
    const r = await task();
    return {
      meta: { ...withLean, ok: true, items: r.items.length, scanned: r.parsed, newest: r.newest, note: r.note || null, error: r.partialError || null, ms: Date.now() - started },
      items: r.items,
    };
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message;
    const error = String(err?.message || err) + (cause ? ` (${cause})` : '');
    return { meta: { ...withLean, ok: false, items: 0, scanned: 0, newest: null, error, ms: Date.now() - started }, items: [] };
  }
}

function canonicalUrl(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|at_|cmpid|ns_|ito|ref)/i.test(k)) url.searchParams.delete(k);
    return url.href.replace(/\/$/, '');
  } catch {
    return u;
  }
}

function locateItem(item) {
  if (item.coords) {
    const [lat, lon] = item.coords;
    const named = locate(item.placeHint || '', item.title);
    const country = named ? COUNTRY_BY_ISO.get(named.iso3) : nearestCountry(lat, lon);
    return {
      iso3: country?.iso3 || null,
      country: country?.name || 'International waters',
      region: country?.region || null,
      lat,
      lon,
      precision: 'exact',
      place: item.placeHint || undefined,
    };
  }
  return locate(item.title, item.summary, item.placeHint);
}

export async function runPipeline(env = {}, { now = Date.now(), history = [] } = {}) {
  const windowMs = MODEL.windowHours * 3600000;
  const opts = { now, windowMs, maxItems: MODEL.maxItemsPerFeed };

  const jobs = [
    ...RSS_FEEDS.map((f) => runSource({ id: f.id, name: f.label || f.name, kind: 'rss', home: f.home }, () => fetchRss(f, opts))),
    ...BLUESKY_PUBLISHERS.map((a) =>
      runSource({ id: a.id, name: `${a.name} (Bluesky)`, kind: 'bluesky-publisher', home: `https://bsky.app/profile/${a.handle}` }, () => fetchPublisherFeed(a, opts)),
    ),
    runSource({ id: 'usgs', name: 'USGS Earthquakes', kind: 'official', home: 'https://earthquake.usgs.gov/earthquakes/map/' }, () => fetchUsgs(USGS_FEED, opts)),
    runSource({ id: 'gdacs', name: 'GDACS Disaster Alerts', kind: 'official', home: 'https://www.gdacs.org/' }, () => fetchGdacs(GDACS_FEED, opts)),
    runSource({ id: 'bsky-search', name: 'Bluesky public posts', kind: 'social', home: 'https://bsky.app/' }, () =>
      fetchSocialSearch(BLUESKY_SEARCHES, env, { ...opts, excludeHandles: new Set(BLUESKY_PUBLISHERS.map((a) => a.handle)) }),
    ),
  ];
  // Market data is a masthead extra, not a news source: a failure just hides the ticker.
  const [results, markets] = await Promise.all([Promise.all(jobs), fetchMarkets(now).catch(() => [])]);

  const seen = new Set();
  const enriched = [];
  // Every publisher report, incident or not: live coverage of a developing story includes
  // follow-ups ("flights resume", "airlines clear backlog") that the classifier ignores.
  const reports = [];
  let scanned = 0;
  for (const { items } of results) {
    for (const item of items) {
      scanned++;
      const key = item.dedupeKey || canonicalUrl(item.url);
      // Outlets repost the same headline under new links (and BBC/Sky appear in two feeds each).
      const titleKey = item.type === 'publisher' ? `${item.sourceName}|${item.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}` : null;
      if (seen.has(key) || (titleKey && seen.has(titleKey))) continue;
      seen.add(key);
      if (titleKey) seen.add(titleKey);
      if (item.type === 'publisher') reports.push(item);
      const cls = item.forced
        ? { ...item.forced, casualties: extractCasualties(item.title + '. ' + item.summary), retrospective: false }
        : classify(item.title, item.summary);
      if (!cls) continue;
      const loc = locateItem(item);
      if (item.type === 'social' && (!loc || cls.severity < 2)) continue;
      // A fresh re-post that names an older calendar day (e.g. "on Nov. 13") keeps that event time.
      const time = effectiveItemTime(item.title, item.time, now);
      enriched.push({ ...item, time, cls, loc });
    }
  }

  let incidents = clusterItems(enriched).map((inc) => ({ ...inc, weight: incidentWeight(inc, now, MODEL) }));
  incidents.sort((a, b) => b.weight - a.weight || b.time - a.time);
  let social = 0;
  incidents = incidents.filter((i) => i.evidence !== 'social' || ++social <= MODEL.maxSocialIncidents).slice(0, MODEL.maxIncidents);

  const regions = scoreRegions(incidents, now, MODEL, history);
  const levels = { high: 0, medium: 0, low: 0 };
  for (const r of regions) levels[r.level]++;

  const sources = results.map((r) => r.meta);
  const categoryCounts = Object.fromEntries(Object.keys(CATEGORIES).map((c) => [c, incidents.filter((i) => i.category === c).length]));

  return {
    schema: SCHEMA_VERSION,
    generatedAt: new Date(now).toISOString(),
    windowHours: MODEL.windowHours,
    model: {
      highRelative: MODEL.highRelative,
      mediumRelative: MODEL.mediumRelative,
      highFloor: MODEL.highFloor,
      mediumFloor: MODEL.mediumFloor,
      recencyHalfLifeHours: MODEL.recencyHalfLifeHours,
      diminishingReturns: MODEL.diminishingReturns,
      severityWeight: MODEL.severityWeight,
      categoryWeight: MODEL.categoryWeight,
      evidenceWeight: MODEL.evidenceWeight,
    },
    categories: CATEGORIES,
    leans: LEAN,
    stats: {
      reportsScanned: scanned,
      incidentReports: enriched.length,
      incidents: incidents.length,
      located: incidents.filter((i) => i.location?.region).length,
      terrorism: incidents.filter(isReportedTerror).length,
      severe: incidents.filter((i) => i.severity >= 4).length,
      sourcesOnline: sources.filter((s) => s.ok).length,
      sourcesTotal: sources.length,
      levels,
      categoryCounts,
    },
    breakingId: pickBreaking(incidents, now),
    live: findLiveStories(incidents, reports, now),
    markets,
    regions,
    incidents,
    sources,
  };
}

export function appendHistory(history, snapshot, now) {
  const last = history[history.length - 1];
  const entry = { t: now, s: Object.fromEntries(snapshot.regions.map((r) => [r.id, r.score])) };
  const next = last && now - last.t < 50 * 60000 ? [...history.slice(0, -1), entry] : [...history, entry];
  return next.filter((h) => now - h.t <= MODEL.historyHours * 3600000);
}
