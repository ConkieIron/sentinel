#!/usr/bin/env node
// SENTINEL HTML publisher — compiles a gatherer snapshot into a static site in ./dist.
//
// Snapshot source (first match wins):
//   --snapshot <path|url>        CLI argument
//   SNAPSHOT_URL                 e.g. https://sentinel-gatherer.<you>.workers.dev/snapshot.json
//   SNAPSHOT_FILE                local file path
//   ../data/snapshot.json        default for local development
//
// The build fails (non-zero exit) when no valid snapshot is available, so Cloudflare Pages keeps
// serving the previous successful deployment instead of publishing an empty site.

import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homePage, regionsIndexPage, regionPage, terrorismPage, aboutPage, notFoundPage, livePage, countryPage, countriesIndexPage, localPage } from './src/pages.js';
import { countriesOf, adviceChanges } from './src/countries.js';
import { COUNTRIES as GEO_COUNTRIES } from '../worker/src/data/countries.js';
import { CATCH_KM, DEFAULT_CATCH_KM } from './src/localGeo.js';
import { bumpPatch, fetchLiveVersion } from './src/version.js';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const SUPPORTED_SCHEMA = 1;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function loadSnapshot() {
  const source = arg('--snapshot') || process.env.SNAPSHOT_URL || process.env.SNAPSHOT_FILE || join(here, '../data/snapshot.json');
  let text;
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Snapshot request failed: HTTP ${res.status} from ${source}`);
    text = await res.text();
  } else {
    text = await readFile(resolve(source), 'utf8');
  }
  const snapshot = JSON.parse(text);
  if (snapshot.schema !== SUPPORTED_SCHEMA) throw new Error(`Unsupported snapshot schema ${snapshot.schema}; expected ${SUPPORTED_SCHEMA}`);
  if (!Array.isArray(snapshot.regions) || !Array.isArray(snapshot.incidents)) throw new Error('Snapshot is missing regions or incidents');
  const ageH = (Date.now() - Date.parse(snapshot.generatedAt)) / 3600000;
  const maxAge = Number(process.env.MAX_SNAPSHOT_AGE_HOURS || 12);
  if (ageH > maxAge && !process.argv.includes('--allow-stale')) {
    throw new Error(`Snapshot is ${ageH.toFixed(1)}h old (limit ${maxAge}h). Is the gatherer Worker running? Use --allow-stale to override.`);
  }
  const { sourcesOnline = 0, sourcesTotal = 0 } = snapshot.stats || {};
  if (sourcesOnline < Math.ceil(sourcesTotal / 2) && !process.argv.includes('--allow-degraded')) {
    throw new Error(`Only ${sourcesOnline}/${sourcesTotal} sources were online; refusing to publish a partial edition. Use --allow-degraded to override.`);
  }
  return { snapshot, source };
}

// Hash of the templates, styles and scripts, so a design change counts as a new edition.
async function codeVersion() {
  const hash = createHash('sha256');
  for (const dir of ['src', 'static']) {
    const files = (await readdir(join(here, dir), { recursive: true, withFileTypes: true }))
      .filter((f) => f.isFile())
      .map((f) => join(f.parentPath ?? f.path, f.name))
      .sort();
    for (const file of files) hash.update(file.slice(here.length)).update(await readFile(file));
  }
  return hash.digest('hex').slice(0, 12);
}

// Identifies what a reader would notice: the site design, region levels, significant incidents,
// the home Latest set (sev ≥ 2), and every report on a live story. Market prices count once per
// 15 minutes while a market is open, and once more for the closing prices.
const MARKET_REFRESH_MS = 15 * 60000;
function editionFingerprint(snapshot, version) {
  const markets = snapshot.markets || [];
  const latestHome = snapshot.incidents
    .filter((i) => i.severity >= 2 && i.evidence !== 'social' && !i.retrospective)
    .sort((a, b) => b.time - a.time)
    .slice(0, 40)
    .map((i) => `${i.id}:${i.time}`);
  const material = {
    version,
    markets: markets.some((m) => m.open)
      ? Math.floor(Date.parse(snapshot.generatedAt) / MARKET_REFRESH_MS)
      : markets.map((m) => `${m.id}:${m.price}`),
    regions: snapshot.regions.map((r) => [r.id, r.level]),
    incidents: snapshot.incidents
      .filter((i) => i.severity >= 3)
      .map((i) => `${i.id}:${i.severity}:${i.category}`)
      .sort(),
    latest: latestHome,
    live: (snapshot.live || []).map((s) => [s.id, ...s.updates.map((u) => u.url)]),
    advice: adviceChanges(snapshot, Date.parse(snapshot.generatedAt)).map((c) => `${c.iso3}:${c.gov}:${c.time}`),
  };
  return createHash('sha256').update(JSON.stringify(material)).digest('hex').slice(0, 16);
}

async function writePage(path, html) {
  const file = join(dist, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, html);
}

async function fingerprint(name) {
  const body = await readFile(join(here, 'static', name));
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 10);
  const [base, ext] = name.split('.');
  const out = `/assets/${base}.${hash}.${ext}`;
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, out), body);
  return out;
}

async function iconVersion() {
  const hash = createHash('sha256');
  for (const name of ['favicon.ico', 'favicon-32.png', 'favicon.svg', 'apple-touch-icon.png', 'sentinel-wordmark.png']) hash.update(await readFile(join(here, 'static/public', name)));
  return hash.digest('hex').slice(0, 8);
}

const started = Date.now();
const { snapshot, source } = await loadSnapshot();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(here, 'static/public'), dist, { recursive: true });

const rootPkg = JSON.parse(await readFile(join(here, '../package.json'), 'utf8'));
const siteUrl = process.env.SITE_URL || 'https://sentinelglobalnews.pages.dev';
// On CI publishes, the badge is always one patch above whatever is currently live, so each
// uploaded edition advances 0.0.1. Local builds keep package.json unchanged.
const pkgVersion = rootPkg.version || '0.0.0';
const bumpOnPublish = process.env.GITHUB_ACTIONS === 'true' || process.env.BUMP_VERSION === '1';
const liveVersion = bumpOnPublish ? await fetchLiveVersion(siteUrl) : null;
const siteVersion = bumpOnPublish ? bumpPatch(liveVersion || pkgVersion) : pkgVersion;
if (bumpOnPublish) {
  console.log(`Version badge: ${liveVersion || pkgVersion} → ${siteVersion}${liveVersion ? ' (from live)' : ' (from package.json)'}`);
}
const site = {
  url: siteUrl,
  publishMinutes: Number(process.env.PUBLISH_INTERVAL_MINUTES || 120),
  homeIncidents: 80,
  version: siteVersion,
};
const live = snapshot.live || [];
const liveByUrl = new Map(live.flatMap((s) => s.updates.map((u) => [u.url, s])));
const ctx = {
  snapshot,
  site,
  now: Date.parse(snapshot.generatedAt),
  liveFor: (inc) => liveByUrl.get(inc.url) || null,
  byId: new Map(snapshot.incidents.map((i) => [i.id, i])),
  regionNames: Object.fromEntries(snapshot.regions.map((r) => [r.id, r.name])),
  assets: { css: await fingerprint('styles.css'), js: await fingerprint('app.js'), icons: await iconVersion() },
};

const pages = [
  ['index.html', homePage(ctx)],
  ['local/index.html', localPage(ctx)],
  ['regions/index.html', regionsIndexPage(ctx)],
  ['terrorism/index.html', terrorismPage(ctx)],
  ['about/index.html', aboutPage(ctx)],
  ['404.html', notFoundPage(ctx)],
  ...snapshot.regions.map((r) => [`region/${r.id}/index.html`, regionPage(ctx, r)]),
  ...live.map((s) => [`live/${s.id}/index.html`, livePage(ctx, s)]),
  ['countries/index.html', countriesIndexPage(ctx)],
  ...[...countriesOf(ctx).values()].map((c) => [`${c.path.slice(1)}index.html`, countryPage(ctx, c)]),
];
for (const [path, html] of pages) await writePage(path, html);

const pagesByIso = countriesOf(ctx);
await writePage(
  'data/countries-geo.json',
  JSON.stringify(
    GEO_COUNTRIES.map((c) => ({
      iso3: c.iso3,
      name: pagesByIso.get(c.iso3)?.name || c.name,
      region: c.region,
      lat: c.lat,
      lon: c.lon,
      path: pagesByIso.get(c.iso3)?.path || null,
      // Tiny dependencies only match when you are essentially there (see localGeo.js).
      catchKm: CATCH_KM[c.iso3] ?? DEFAULT_CATCH_KM,
    })),
  ),
);

await writePage('data/snapshot.json', JSON.stringify(snapshot));
await writePage(
  'data/meta.json',
  JSON.stringify({
    generatedAt: snapshot.generatedAt,
    incidents: snapshot.incidents.length,
    version: site.version,
    fingerprint: editionFingerprint(snapshot, await codeVersion()),
  }),
);
// Read by open live pages (new-update count) and by the breaking-news watcher (topic matching).
await writePage(
  'data/live.json',
  JSON.stringify({
    generatedAt: snapshot.generatedAt,
    stories: live.map((s) => ({
      id: s.id,
      title: s.title,
      path: `/live/${s.id}/`,
      updatedAt: s.updatedAt,
      reportCount: s.reportCount,
      times: s.updates.map((u) => u.time),
      topics: s.topics,
    })),
  }),
);

const urls = [
  '/',
  '/local/',
  '/regions/',
  '/terrorism/',
  '/about/',
  '/countries/',
  ...snapshot.regions.map((r) => `/region/${r.id}/`),
  ...live.map((s) => `/live/${s.id}/`),
  ...[...countriesOf(ctx).values()].map((c) => c.path),
];
await writePage(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `<url><loc>${site.url.replace(/\/$/, '')}${u}</loc><lastmod>${snapshot.generatedAt}</lastmod></url>`)
    .join('\n')}\n</urlset>\n`,
);
await writePage('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site.url.replace(/\/$/, '')}/sitemap.xml\n`);

const kb = (await Promise.all(pages.map(([p]) => readFile(join(dist, p))))).reduce((n, b) => n + b.length, 0) / 1024;
console.log(`Built ${pages.length} pages (${kb.toFixed(0)} KB HTML) into ${dist} in ${Date.now() - started} ms`);
console.log(`Snapshot: ${source} · generated ${snapshot.generatedAt} · ${snapshot.incidents.length} incidents`);
