import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { esc, safeHref, ago } from '../src/util.js';
import { homePage, regionsIndexPage, regionPage, terrorismPage, aboutPage, notFoundPage } from '../src/pages.js';
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
  ];
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

test('empty snapshot still renders', () => {
  const snapshot = structuredClone(fixture);
  snapshot.incidents = [];
  snapshot.breakingId = null;
  for (const r of snapshot.regions) Object.assign(r, { level: 'low', index: 0, score: 0, incidents: 0, hotspots: [], topIncidentIds: [] });
  for (const html of allPages(context(snapshot))) assert.match(html, /<\/html>\s*$/);
});
