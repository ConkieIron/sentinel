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
import { homePage, regionsIndexPage, regionPage, terrorismPage, aboutPage, notFoundPage } from './src/pages.js';

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

// Identifies what a reader would notice: the site design, the breaking story, region levels and
// the significant incidents. Minor churn (new sev-1/2 reports, extra sources) does not change it.
function editionFingerprint(snapshot, version) {
  const material = {
    version,
    breaking: snapshot.breakingId || null,
    regions: snapshot.regions.map((r) => [r.id, r.level]),
    incidents: snapshot.incidents
      .filter((i) => i.severity >= 3)
      .map((i) => `${i.id}:${i.severity}:${i.category}`)
      .sort(),
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

const started = Date.now();
const { snapshot, source } = await loadSnapshot();

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(here, 'static/public'), dist, { recursive: true });

const site = {
  url: process.env.SITE_URL || 'https://sentinelglobalnews.pages.dev',
  publishMinutes: Number(process.env.PUBLISH_INTERVAL_MINUTES || 120),
  homeIncidents: 80,
};
const ctx = {
  snapshot,
  site,
  now: Date.parse(snapshot.generatedAt),
  byId: new Map(snapshot.incidents.map((i) => [i.id, i])),
  regionNames: Object.fromEntries(snapshot.regions.map((r) => [r.id, r.name])),
  assets: { css: await fingerprint('styles.css'), js: await fingerprint('app.js') },
};

const pages = [
  ['index.html', homePage(ctx)],
  ['regions/index.html', regionsIndexPage(ctx)],
  ['terrorism/index.html', terrorismPage(ctx)],
  ['about/index.html', aboutPage(ctx)],
  ['404.html', notFoundPage(ctx)],
  ...snapshot.regions.map((r) => [`region/${r.id}/index.html`, regionPage(ctx, r)]),
];
for (const [path, html] of pages) await writePage(path, html);

await writePage('data/snapshot.json', JSON.stringify(snapshot));
await writePage(
  'data/meta.json',
  JSON.stringify({ generatedAt: snapshot.generatedAt, incidents: snapshot.incidents.length, fingerprint: editionFingerprint(snapshot, await codeVersion()) }),
);

const urls = ['/', '/regions/', '/terrorism/', '/about/', ...snapshot.regions.map((r) => `/region/${r.id}/`)];
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
