import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { esc, safeHref, ago } from '../src/util.js';
import { homePage, regionsIndexPage, regionPage, terrorismPage, aboutPage, notFoundPage, livePage } from '../src/pages.js';
import { project, MAP_WIDTH, MAP_HEIGHT } from '../src/projection.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/sample-snapshot.json', import.meta.url), 'utf8'));
const EVIL = '<script>alert("x")</script><img src=x onerror=alert(1)>';

function context(snapshot) {
  return {
    snapshot,
    site: { url: 'https://example.pages.dev', publishMinutes: 120, homeIncidents: 80 },
    now: Date.parse(snapshot.generatedAt),
    byId: new Map(snapshot.incidents.map((i) => [i.id, i])),
    regionNames: Object.fromEntries(snapshot.regions.map((r) => [r.id, r.name])),
    assets: { css: '/assets/styles.test.css', js: '/assets/app.test.js' },
  };
}

function allPages(ctx) {
  return [
    homePage(ctx),
    regionsIndexPage(ctx),
    terrorismPage(ctx),
    aboutPage(ctx),
    notFoundPage(ctx),
    ...ctx.snapshot.regions.map((r) => regionPage(ctx, r)),
    ...(ctx.snapshot.live || []).map((s) => livePage(ctx, s)),
  ];
}

function withLiveStory(snapshot, { title = 'US flights resume after nationwide ground stop', url = 'https://www.bbc.co.uk/news/ground-stop' } = {}) {
  const now = Date.parse(snapshot.generatedAt);
  const copy = structuredClone(snapshot);
  copy.live = [
    {
      id: 'abc123',
      title,
      summary: 'Flights resumed after an hours-long halt.',
      category: 'infrastructure',
      severity: 3,
      location: null,
      startedAt: now - 10 * 3600000,
      updatedAt: now - 600000,
      outlets: ['BBC News', 'Reuters', 'CNN'],
      reportCount: 3,
      topics: [],
      updates: [
        { title, summary: 'What we know.', url, source: 'BBC News', time: now - 600000 },
        { title: 'FAA lifts ground stop', summary: '', url: 'https://www.reuters.com/x', source: 'Reuters', via: 'Bluesky', time: now - 3600000 },
        { title: 'All US flights grounded', summary: '', url: 'https://edition.cnn.com/y', source: 'CNN', time: now - 10 * 3600000 },
      ],
    },
  ];
  return copy;
}

test('esc escapes all HTML-significant characters', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('safeHref only allows http(s)', () => {
  assert.equal(safeHref('https://bbc.co.uk/news'), 'https://bbc.co.uk/news');
  assert.equal(safeHref('javascript:alert(1)'), '#');
  assert.equal(safeHref('data:text/html,hi'), '#');
  assert.equal(safeHref('not a url'), '#');
});

test('ago formats relative times', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  assert.equal(ago(now, now), 'just now');
  assert.equal(ago(now - 5 * 60000, now), '5 min ago');
  assert.equal(ago(now - 3 * 3600000, now), '3 hr ago');
  assert.equal(ago(now - 50 * 3600000, now), '2 days ago');
});

test('projection keeps the visible world inside the map frame', () => {
  for (const [lon, lat] of [[-180, 84], [180, -58], [0, 0], [151.2, -33.9]]) {
    const [x, y] = project(lon, lat);
    assert.ok(x >= -0.5 && x <= MAP_WIDTH + 0.5, `x=${x}`);
    assert.ok(y >= -0.5 && y <= MAP_HEIGHT + 0.5, `y=${y}`);
  }
});

test('every page renders a complete document from the fixture', () => {
  const pages = allPages(context(fixture));
  assert.equal(pages.length, 5 + fixture.regions.length);
  for (const html of pages) {
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<\/html>\s*$/);
    assert.ok(!/\sstyle=/i.test(html), 'inline styles would be blocked by the CSP');
    assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'inline scripts would be blocked by the CSP');
  }
});

test('external links open in a new tab without leaking the opener', () => {
  const html = allPages(context(fixture)).join('\n');
  const external = html.match(/<a\b[^>]*\bhref="https?:\/\/[^"]*"[^>]*>/gi) || [];
  assert.ok(external.length > 50);
  for (const tag of external) {
    assert.match(tag, /\btarget="_blank"/, tag);
    assert.match(tag, /\brel="noopener noreferrer"/, tag);
  }
});

test('hostile feed content is escaped and unsafe links neutralised', () => {
  const snapshot = structuredClone(fixture);
  const target = snapshot.incidents.find((i) => i.location) || snapshot.incidents[0];
  target.title = EVIL;
  target.summary = EVIL;
  target.url = 'javascript:alert(1)';
  target.sources = [{ name: EVIL, url: 'javascript:alert(2)', type: 'publisher', time: target.time }];
  target.severity = 5;
  target.evidence = 'multi';
  target.retrospective = false;
  target.time = Date.parse(snapshot.generatedAt);
  snapshot.breakingId = target.id;

  const html = allPages(context(snapshot)).join('\n');
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'), 'hostile title should appear escaped');
  assert.ok(!html.includes('<script>alert('), 'raw script tag leaked');
  assert.ok(!html.includes('<img src=x'), 'raw img tag leaked');
  assert.ok(!/href="javascript:/i.test(html), 'javascript: link leaked');
});

test('live stories get a front-page teaser and a page listing every update, newest first', () => {
  const ctx = context(withLiveStory(fixture));
  const home = homePage(ctx);
  assert.match(home, /class="live-box"/);
  assert.match(home, /href="\/live\/abc123\/"/);
  assert.match(home, /<span class="live-pill">Breaking<\/span>/);
  assert.doesNotMatch(home, /class="breaking"/);
  const page = livePage(ctx, ctx.snapshot.live[0]);
  const order = ['www.bbc.co.uk/news/ground-stop', 'www.reuters.com/x', 'edition.cnn.com/y'].map((u) => page.indexOf(u));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'updates newest first');
  assert.match(page, /data-live-id="abc123"/);
  assert.match(page, /via Bluesky/);
});

test('hostile content in live stories is escaped', () => {
  const ctx = context(withLiveStory(fixture, { title: EVIL, url: 'javascript:alert(1)' }));
  const html = allPages(ctx).join('\n');
  assert.ok(!html.includes('<script>alert('), 'raw script tag leaked');
  assert.ok(!/href="javascript:/i.test(html), 'javascript: link leaked');
});

test('the masthead ticker shows each index, the first visible without JavaScript', () => {
  const snapshot = structuredClone(fixture);
  const at = Date.parse(snapshot.generatedAt);
  snapshot.markets = [
    { id: 'ftse', name: 'FTSE 100', price: 10902.56, changePct: 0.36, time: at, open: true },
    { id: 'dow', name: 'Dow Jones', price: 52347.55, changePct: -0.4, time: at - 86400000, open: false },
  ];
  const home = homePage(context(snapshot));
  assert.match(home, /data-ticker-item><span class="wc-city">FTSE 100<\/span><span class="wc-time">10,902\.56<\/span><span class="wc-meta"><span class="tk-up">▲ 0\.36%<\/span><span class="tk-status"> · <time/);
  assert.match(home, /data-ticker-item hidden><span class="wc-city">Dow Jones<\/span>.*▼ 0\.40%<\/span><span class="tk-status"> · Closed/);
  delete snapshot.markets;
  assert.doesNotMatch(homePage(context(snapshot)), /data-ticker/, 'no market data, no ticker');
});

test('empty snapshot still renders', () => {
  const snapshot = structuredClone(fixture);
  snapshot.incidents = [];
  snapshot.breakingId = null;
  for (const r of snapshot.regions) Object.assign(r, { level: 'low', index: 0, score: 0, incidents: 0, hotspots: [], topIncidentIds: [] });
  for (const html of allPages(context(snapshot))) assert.match(html, /<\/html>\s*$/);
});
