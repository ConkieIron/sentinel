import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { esc, safeHref, ago, timeLabel, isUpdatedIncident, publishedTime, bySeriousness, byPublishedThenSeverity } from '../src/util.js';
import { homePage, regionsIndexPage, regionPage, terrorismPage, aboutPage, notFoundPage, livePage, countryPage, countriesIndexPage, localPage, localCardsByIso, headlineIncidents } from '../src/pages.js';
import { buildCountries } from '../src/countries.js';
import { project, MAP_WIDTH, MAP_HEIGHT } from '../src/projection.js';

const fixture = JSON.parse(await readFile(new URL('../fixtures/sample-snapshot.json', import.meta.url), 'utf8'));
const EVIL = '<script>alert("x")</script><img src=x onerror=alert(1)>';

function context(snapshot) {
  return {
    snapshot,
    site: { url: 'https://example.pages.dev', publishMinutes: 120, homeIncidents: 80, version: '1.1.0' },
    now: Date.parse(snapshot.generatedAt),
    byId: new Map(snapshot.incidents.map((i) => [i.id, i])),
    regionNames: Object.fromEntries(snapshot.regions.map((r) => [r.id, r.name])),
    assets: { css: '/assets/styles.test.css', js: '/assets/app.test.js' },
  };
}

function allPages(ctx) {
  return [
    homePage(ctx),
    localPage(ctx),
    regionsIndexPage(ctx),
    terrorismPage(ctx),
    aboutPage(ctx),
    notFoundPage(ctx),
    ...ctx.snapshot.regions.map((r) => regionPage(ctx, r)),
    ...(ctx.snapshot.live || []).map((s) => livePage(ctx, s)),
    countriesIndexPage(ctx),
    ...[...buildCountries(ctx.snapshot).values()].map((c) => countryPage(ctx, c)),
  ];
}

function withLiveStory(snapshot, { title = 'US flights resume after nationwide ground stop', url = 'https://www.bbc.co.uk/news/ground-stop', image, breaking = true, startedHoursAgo = 1 } = {}) {
  const now = Date.parse(snapshot.generatedAt);
  const copy = structuredClone(snapshot);
  copy.live = [
    {
      id: 'abc123',
      title,
      summary: 'Flights resumed after an hours-long halt.',
      image,
      category: 'infrastructure',
      severity: 3,
      location: null,
      startedAt: now - startedHoursAgo * 3600000,
      updatedAt: now - 600000,
      breaking: !!breaking,
      outlets: ['BBC News', 'Reuters', 'CNN'],
      reportCount: 3,
      topics: [],
      updates: [
        { title, summary: 'What we know.', url, source: 'BBC News', time: now - 600000 },
        { title: 'FAA lifts ground stop', summary: '', url: 'https://www.reuters.com/x', source: 'Reuters', via: 'Bluesky', time: now - 3600000 },
        { title: 'All US flights grounded', summary: '', url: 'https://edition.cnn.com/y', source: 'CNN', time: now - startedHoursAgo * 3600000 },
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

test('timeLabel marks revisions as updated', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  assert.equal(timeLabel(now - 5 * 60000, now), '5 min ago');
  assert.equal(timeLabel(now - 5 * 60000, now, { updated: true }), 'updated 5 min ago');
  assert.equal(timeLabel(now, now, { updated: true }), 'updated just now');
});

test('isUpdatedIncident is true for revised or late follow-up reports', () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  assert.equal(isUpdatedIncident({ title: 'Blast', time: now - 60000, firstSeen: now - 60000 }, now), false);
  assert.equal(isUpdatedIncident({ title: 'Blast', time: now - 60000, firstSeen: now - 2 * 3600000 }, now), true);
  assert.equal(isUpdatedIncident({ title: 'Blast', time: now - 60000, firstSeen: now - 60000, revised: true }, now), true);
  assert.equal(
    isUpdatedIncident({ title: 'Attack on Nov. 10 killed dozens', time: now - 60000, firstSeen: now - 2 * 3600000 }, now),
    false,
  );
});

test('cards show source+lean up top, category bottom-right, published time only', async () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const first = now - 2 * 3600000;
  const updated = now - 60000;
  const inc = {
    id: 'u1',
    title: 'Blast hits port city',
    summary: 'A blast hit the port city, officials said, with damage reported near the harbour.',
    category: 'armed_conflict',
    severity: 3,
    evidence: 'publisher',
    casualties: { killed: 0, injured: 0 },
    location: null,
    sources: [{ name: 'Reuters', url: 'https://www.reuters.com/x', time: updated }],
    sourceCount: 1,
    reportCount: 1,
    weight: 1,
    time: updated,
    firstSeen: first,
    url: 'https://www.reuters.com/x',
  };
  assert.equal(publishedTime(inc, now), first);
  const { incidentCard } = await import('../src/components.js');
  const html = incidentCard(inc, {
    snapshot: { categories: { armed_conflict: 'Armed conflict' }, leans: { wire: 'Wire' }, mediaLean: {} },
    now,
  });
  assert.match(html, /story-byline[\s\S]*Reuters/);
  assert.match(html, /story-foot-right[\s\S]*Armed conflict/);
  assert.match(html, /story-times[\s\S]*>2 hr ago</);
  assert.match(html, /class="dek"/);
  assert.doesNotMatch(html, /updated |Severity |sev-3|story-updated/);
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
  assert.equal(pages.length, 7 + fixture.regions.length + buildCountries(fixture).size);
  for (const html of pages) {
    assert.match(html, /^<!doctype html>/i);
    assert.match(html, /<\/html>\s*$/);
    assert.ok(!/\sstyle=/i.test(html), 'inline styles would be blocked by the CSP');
    // JSON-LD uses type=application/ld+json (not executable); CSP script-src only blocks JS.
    assert.ok(
      !/<script(?![^>]*(?:\bsrc=|type=["']application\/ld\+json["']))/i.test(html),
      'inline scripts would be blocked by the CSP',
    );
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

test('outlet cards show an approximate editorial lean tag', () => {
  const snapshot = structuredClone(fixture);
  const inc = snapshot.incidents.find((i) => i.evidence !== 'social' && i.sources?.[0]);
  assert.ok(inc, 'fixture has a publisher incident');
  inc.sources[0].name = 'The Guardian';
  inc.sources[0].lean = 'left';
  const home = homePage(context(snapshot));
  assert.match(home, /class="lean lean-left"[^>]*>Left</);
  assert.match(home, /lean-caveat/);
  assert.match(aboutPage(context(snapshot)), /editorial lean/);
});

test('masthead shows Beta and version badges', () => {
  const html = homePage(context(fixture));
  assert.match(html, /class="brand-badge brand-beta"[^>]*>Beta</);
  assert.match(html, /class="brand-badge brand-version"[^>]*>v1\.1\.0</);
});

test('Local incidents page asks for location and loads country cards on demand', () => {
  const html = localPage(context(fixture));
  assert.match(html, /aria-current="page">Local</);
  assert.match(html, /data-local-locate/);
  assert.match(html, /Incidents in your country/);
  assert.match(html, /Your location stays on this device/);
  assert.match(html, /class="headlines" data-local-list/);
  assert.doesNotMatch(html, /story-tile local-item/);
  const cards = localCardsByIso(context(fixture));
  const located = fixture.incidents.filter((i) => i.location?.iso3 && i.evidence !== 'social' && !i.retrospective);
  if (located[0]) {
    const iso = located[0].location.iso3;
    assert.ok(cards.get(iso)?.includes(`data-iso3="${iso}"`));
  }
});

test('live stories get a front-page teaser and a page listing every update, newest first', () => {
  const ctx = context(withLiveStory(fixture));
  const home = homePage(ctx);
  assert.match(home, /class="live-box"/);
  assert.match(home, /href="\/live\/abc123\/"/);
  assert.match(home, /<span class="live-pill">Breaking<\/span>/);
  assert.match(home, /name="sentinel-breaking" content="abc123"/);

  const oldOnly = context(withLiveStory(fixture, { breaking: false, startedHoursAgo: 10 }));
  assert.doesNotMatch(homePage(oldOnly), /name="sentinel-breaking"/);
  assert.match(livePage(oldOnly, oldOnly.snapshot.live[0]), /<span class="live-pill">Live<\/span>/);
  assert.doesNotMatch(homePage(oldOnly), /ts-break-label">Breaking/);
  assert.match(home, /data-breaking-flash/);
  assert.match(home, /data-breaking-kicker/);
  assert.match(home, /data-edition-age/);
  assert.match(home, /ts-breaking/);
  assert.doesNotMatch(home, /class="breaking"/);
  const page = livePage(ctx, ctx.snapshot.live[0]);
  const order = ['www.bbc.co.uk/news/ground-stop', 'www.reuters.com/x', 'edition.cnn.com/y'].map((u) => page.indexOf(u));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'updates newest first');
  assert.match(page, /data-live-id="abc123"/);
  assert.match(page, /via Bluesky/);
});

test('live updates show a dek only when the summary adds facts, and mark live-blog ticks', () => {
  const now = Date.parse(fixture.generatedAt);
  const snapshot = withLiveStory(fixture);
  snapshot.live[0].updates = [
    {
      title: 'US flights resume after nationwide ground stop',
      summary: 'US flights resume after nationwide ground stop',
      url: 'https://www.bbc.co.uk/news/live/ground-stop',
      source: 'BBC News',
      time: now - 600000,
      liveBlog: true,
    },
    {
      title: 'FAA lifts nationwide ground stop',
      summary:
        'The FAA lifted a nationwide ground stop after air traffic control systems failed for several hours, leaving thousands of passengers stranded.',
      url: 'https://www.reuters.com/x',
      source: 'Reuters',
      time: now - 3600000,
    },
  ];
  const page = livePage(context(snapshot), snapshot.live[0]);
  assert.match(page, /is-liveblog/);
  assert.match(page, /Live blog/);
  assert.match(page, /thousands of passengers stranded/);
  assert.doesNotMatch(page, /US flights resume after nationwide ground stop<\/a><\/h3>\s*<p class="dek">US flights resume/);
});

test('hostile content in live stories is escaped', () => {
  const ctx = context(withLiveStory(fixture, { title: EVIL, url: 'javascript:alert(1)' }));
  const html = allPages(ctx).join('\n');
  assert.ok(!html.includes('<script>alert('), 'raw script tag leaked');
  assert.ok(!/href="javascript:/i.test(html), 'javascript: link leaked');
});

test('phones get folded sidebar panels', () => {
  const home = homePage(context(fixture));
  assert.match(home, /<details class="panel panel-fold">\s*<summary class="panel-title"><span>Source health<\/span><span class="fold-note">\d+ of \d+ online<\/span>/);
  assert.match(home, /<details class="panel panel-fold" data-open-wide>\s*<summary class="panel-title"><span>Evidence labels<\/span>/);
  assert.match(home, /<section class="panel wide-only">\s*<h2 class="panel-title">Regional threat levels/);
});

test('Most serious ranks by severity; Latest headlines are newest severity 3+', () => {
  const now = Date.now();
  const olderFive = {
    id: 'ebola',
    title: 'Ebola outbreak remains out of control',
    severity: 5,
    weight: 9,
    time: now - 6 * 3600000,
    evidence: 'multi',
    retrospective: false,
  };
  const freshThree = {
    id: 'protest',
    title: 'Large protest fills capital streets',
    severity: 3,
    weight: 4,
    time: now - 3600000,
    evidence: 'multi',
    retrospective: false,
  };
  const minor = {
    id: 'quake',
    title: 'Minor quake felt in coastal town',
    severity: 2,
    weight: 2,
    time: now,
    evidence: 'publisher',
    retrospective: false,
  };
  assert.ok(bySeriousness(olderFive, freshThree) < 0);
  const headlines = headlineIncidents([olderFive, freshThree, minor], 3);
  assert.equal(headlines[0].id, 'protest', 'newest severity 3+ leads headlines');
  assert.equal(headlines[1].id, 'ebola');
  assert.ok(!headlines.some((i) => i.id === 'quake'), 'severity 2 stays out of headlines');
});

test('headlines are newest first, Most serious is severity first, and neither repeats in Latest', () => {
  const ctx = context(fixture);
  const home = homePage(ctx);
  const headlines = home.slice(home.indexOf('Latest headlines'), home.indexOf('id="latest"'));
  const latest = home.slice(home.indexOf('id="latest"'));
  const mostSerious = home.slice(home.indexOf('Most serious right now'));
  const fresh = headlineIncidents(fixture.incidents, 7);
  const serious = [...fixture.incidents]
    .filter((i) => i.evidence !== 'social' && !i.retrospective && i.severity >= 3)
    .sort(bySeriousness)
    .slice(0, 5);
  assert.ok(fresh[0], 'fixture should have severity 3+ incidents');
  assert.match(headlines, new RegExp(`id="i-${fresh[0].id}"`));
  assert.match(mostSerious, new RegExp(serious[0].title.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const i of fresh) {
    assert.equal(latest.includes(`id="i-${i.id}"`), false, `${i.id} should not reappear in Latest`);
  }
});

test('the main live story shows its picture, credited and linked to the source', () => {
  const image = { url: 'https://ichef.bbci.co.uk/ace/standard/976/x.jpg', source: 'BBC News', link: 'https://www.bbc.co.uk/news/ground-stop', title: 'US flights resume' };
  const ctx = context(withLiveStory(fixture, { image }));
  const home = homePage(ctx);
  assert.match(home, /live-teaser-main has-figure/);
  assert.match(home, /<a href="\/live\/abc123\/" tabindex="-1" aria-hidden="true"><img src="https:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/976\/x\.jpg" alt="" [^>]*referrerpolicy="no-referrer">/);
  assert.match(home, /Picture: <a href="https:\/\/www\.bbc\.co\.uk\/news\/ground-stop" target="_blank" rel="noopener noreferrer">BBC News/);
  assert.match(livePage(ctx, ctx.snapshot.live[0]), /class="story-figure live-hero-figure"/);
  assert.doesNotMatch(homePage(context(withLiveStory(fixture))), /story-figure|has-figure/, 'no picture, no figure');

  const hostile = context(withLiveStory(fixture, { image: { url: 'javascript:alert(1)', source: EVIL, link: 'javascript:alert(2)' } }));
  assert.doesNotMatch(homePage(hostile), /story-figure/);
  const insecure = context(withLiveStory(fixture, { image: { url: 'http://img.example/x.jpg', source: EVIL, link: 'javascript:alert(2)' } }));
  assert.doesNotMatch(homePage(insecure), /story-figure/);
  const badLink = homePage(context(withLiveStory(fixture, { image: { ...image, source: EVIL, link: 'javascript:alert(2)' } })));
  assert.ok(!badLink.includes('<script>alert('));
  assert.ok(!/href="javascript:/i.test(badLink));
});

test('the masthead ticker shows each index with open markets first', () => {
  const snapshot = structuredClone(fixture);
  const at = Date.parse(snapshot.generatedAt);
  snapshot.markets = [
    { id: 'dow', name: 'Dow Jones', price: 52347.55, changePct: -0.4, time: at - 86400000, open: false },
    { id: 'ftse', name: 'FTSE 100', price: 10902.56, changePct: 0.36, time: at, open: true },
  ];
  const home = homePage(context(snapshot));
  assert.match(home, /data-ticker-item><span class="wc-city">FTSE 100<\/span><span class="wc-time">10,902\.56<\/span><span class="wc-meta"><span class="tk-up">▲ 0\.36%<\/span><span class="tk-status"> · <time/);
  assert.match(home, /data-ticker-item hidden><span class="wc-city">Dow Jones<\/span>.*▼ 0\.40%<\/span><span class="tk-status"> · Closed/);
  assert.match(home, /data-edition-age/);
  delete snapshot.markets;
  assert.doesNotMatch(homePage(context(snapshot)), /data-ticker/, 'no market data, no ticker');
});

test('Global terror lists outlet reports; social posts and anniversaries sit apart underneath', () => {
  const snapshot = structuredClone(fixture);
  const at = Date.parse(snapshot.generatedAt);
  const base = { category: 'terrorism', severity: 3, casualties: { killed: 0, injured: 0 }, location: null, sources: [], sourceCount: 1, reportCount: 1, weight: 1, time: at, firstSeen: at };
  snapshot.incidents = [
    { ...base, id: 't1', title: 'Gunmen kill 12 in attack on village market', summary: '', url: 'https://www.bbc.co.uk/1', evidence: 'publisher', retrospective: false },
    { ...base, id: 't2', title: 'Americans unable to determine whether terror attack caused outage', summary: '', url: 'https://bsky.app/profile/x/post/1', evidence: 'social', retrospective: false },
    { ...base, id: 't3', title: 'France marks 11th anniversary of Paris attacks', summary: '', url: 'https://www.france24.com/3', evidence: 'publisher', retrospective: true, severity: 1 },
  ];
  const html = terrorismPage(context(snapshot));
  const details = html.indexOf('<details');
  assert.ok(details > 0);
  assert.ok(html.indexOf('Gunmen kill 12') < details, 'outlet report in the main list');
  assert.ok(html.indexOf('Americans unable') > details, 'social post kept below');
  assert.ok(html.indexOf('France marks 11th anniversary') > details, 'anniversary kept below');
  assert.match(html, /1 unverified social post mentioning terrorism/);
  const home = homePage(context(snapshot));
  const panel = home.slice(home.indexOf('<h2>Suspected terrorism</h2>'));
  assert.match(panel, /Gunmen kill 12/);
  assert.doesNotMatch(panel.slice(0, panel.indexOf('</section>')), /Americans unable|France marks/);
  // The outlet report leads the headlines, so Latest only shows the unverified social post.
  assert.match(home, /story-lead" id="i-t1"/);
  assert.doesNotMatch(home.slice(home.indexOf('id="latest"')), /id="i-t1"/);
  assert.match(home, /data-cat="unconfirmed"/);
  assert.match(aboutPage(context(snapshot)), /cat-terrorism">Suspected terrorism<\/span><\/td><td class="num">1<\/td>/);
});

test('region pages show official travel advice for countries in the news', () => {
  const snapshot = structuredClone(fixture);
  const region = snapshot.regions[0];
  const inc = snapshot.incidents.find((i) => i.location?.region === region.id);
  const iso3 = inc?.location?.iso3 || 'XXX';
  snapshot.travel = {
    [iso3]: {
      name: 'Testland',
      region: region.id,
      fcdo: { url: 'https://www.gov.uk/foreign-travel-advice/testland', updated: Date.parse('2026-10-02T08:30:00Z'), change: 'Updated safety advice' },
      us: { level: 4, label: 'Do Not Travel', url: 'https://travel.state.gov/destination.tst.html', updated: null },
    },
    ZZZ: { name: 'Elsewhere', region: 'not-this-region', us: { level: 4, label: 'Do Not Travel', url: 'https://travel.state.gov/z.html' } },
  };
  const html = regionPage(context(snapshot), region);
  assert.match(html, /Official travel advice/);
  assert.match(html, /<strong><a href="\/country\/[a-z-]+\/">Testland<\/a><\/strong>/);
  assert.match(html, /class="adv adv-4">US Level 4: Do Not Travel/);
  assert.match(html, /href="https:\/\/www\.gov\.uk\/foreign-travel-advice\/testland" target="_blank" rel="noopener noreferrer" title="Updated safety advice">UK FCDO/);
  assert.match(html, /UK advice updated 2 Oct 2026/);
  assert.doesNotMatch(html, /Elsewhere/);
  delete snapshot.travel;
  assert.doesNotMatch(regionPage(context(snapshot), region), /Official travel advice/);
});

test('every country in the news gets a page with its incidents, linked from incident cards', () => {
  const ctx = context(fixture);
  const countries = [...buildCountries(fixture).values()];
  const located = fixture.incidents.filter((i) => i.location?.iso3 && i.location.region);
  assert.equal(countries.length, new Set(located.map((i) => i.location.iso3)).size);
  assert.equal(new Set(countries.map((c) => c.path)).size, countries.length, 'paths are unique');
  for (const c of countries) assert.match(c.path, /^\/country\/[a-z0-9-]+\/$/);

  const busiest = [...countries].sort((a, b) => b.incidents.length - a.incidents.length)[0];
  const page = countryPage(ctx, busiest);
  assert.match(page, /^<!doctype html>/i);
  assert.match(page, new RegExp(`<h1>${busiest.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</h1>`.replace(/&/g, '&amp;')));
  assert.match(page, /No official advice was found/, 'fixture has no travel data');
  for (const i of busiest.incidents.slice(0, 3)) assert.ok(page.includes(`id="i-${i.id}"`));
  assert.ok(homePage(ctx).includes(`href="${busiest.path}"`), 'incident cards link to the country');

  const index = countriesIndexPage(ctx);
  assert.match(index, /data-country-search/);
  assert.equal((index.match(/class="country-row"/g) || []).length, countries.length);
});

test('travel advice changes appear in Latest and are flagged on the country page', () => {
  const snapshot = structuredClone(fixture);
  const now = Date.parse(snapshot.generatedAt);
  const inc = snapshot.incidents.find((i) => i.location?.iso3);
  snapshot.travel = {
    [inc.location.iso3]: {
      name: inc.location.country,
      region: inc.location.region,
      fcdo: { url: 'https://www.gov.uk/foreign-travel-advice/x', updated: now - 3 * 3600000, change: 'New warning about protests' },
      us: { level: 4, label: 'Do Not Travel', previousLevel: 3, levelChangedAt: now - 3600000, url: 'https://travel.state.gov/x.html' },
    },
    ZZZ: { name: 'Quietland', region: inc.location.region, fcdo: { url: 'https://www.gov.uk/foreign-travel-advice/q', updated: now - 10 * 86400000 } },
  };
  const ctx = context(snapshot);
  const home = homePage(ctx);
  assert.match(home, /data-filter="advice" aria-pressed="false">Travel advice <span>2<\/span>/);
  assert.match(home, new RegExp(`US raises travel advisory for ${inc.location.country} to Level 4: Do Not Travel`));
  assert.match(home, /UK travel advice for .* updated/);
  assert.doesNotMatch(home, /Quietland/, 'old changes stay out of Latest');

  const country = buildCountries(snapshot).get(inc.location.iso3);
  const page = countryPage(ctx, country);
  assert.match(page, /Raised from Level 3<\/strong> 1 hr ago/);
  assert.match(page, /class="adv-new adv-new-raised">US level raised 1 hr ago/);
  assert.match(page, /New warning about protests/);
});

test('empty snapshot still renders', () => {
  const snapshot = structuredClone(fixture);
  snapshot.incidents = [];
  snapshot.breakingId = null;
  for (const r of snapshot.regions) Object.assign(r, { level: 'low', index: 0, score: 0, incidents: 0, hotspots: [], topIncidentIds: [] });
  for (const html of allPages(context(snapshot))) assert.match(html, /<\/html>\s*$/);
});

test('Open Graph uses share art, and Breaking art when coverage is Breaking', () => {
  const normal = homePage(context(fixture));
  assert.match(normal, /property="og:image" content="https:\/\/example\.pages\.dev\/og-share\.png/);
  assert.match(normal, /name="twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(normal, /og-breaking\.png/);

  const withBreaking = context(withLiveStory(fixture, { breaking: true }));
  const home = homePage(withBreaking);
  assert.match(home, /property="og:image" content="https:\/\/example\.pages\.dev\/og-breaking\.png/);
  assert.match(livePage(withBreaking, withBreaking.snapshot.live[0]), /og-breaking\.png/);

  const oldLive = context(withLiveStory(fixture, { breaking: false, startedHoursAgo: 10 }));
  assert.match(homePage(oldLive), /og-share\.png/);
  assert.match(livePage(oldLive, oldLive.snapshot.live[0]), /og-share\.png/);
});

test('pages emit JSON-LD for Organization, WebSite, breadcrumbs and live blogs', () => {
  const ctx = context(withLiveStory(fixture));
  const home = homePage(ctx);
  assert.match(home, /application\/ld\+json/);
  assert.match(home, /"@type":"Organization"/);
  assert.match(home, /"@type":"WebSite"/);
  assert.match(home, /"@type":"WebPage"/);

  const about = aboutPage(ctx);
  assert.match(about, /"@type":"AboutPage"/);
  assert.match(about, /"@type":"BreadcrumbList"/);

  const region = regionPage(ctx, ctx.snapshot.regions[0]);
  assert.match(region, /"@type":"CollectionPage"/);
  assert.match(region, /"@type":"BreadcrumbList"/);

  const live = livePage(ctx, ctx.snapshot.live[0]);
  assert.match(live, /"@type":"LiveBlogPosting"/);
  assert.match(live, /"@type":"BlogPosting"/);
  assert.match(live, /liveBlogUpdate/);

  // Hostile titles must not break out of the JSON-LD script.
  const evil = context(withLiveStory(fixture, { title: EVIL, url: 'javascript:alert(1)' }));
  const evilLive = livePage(evil, evil.snapshot.live[0]);
  assert.match(evilLive, /\\u003cscript/);
  assert.doesNotMatch(evilLive, /application\/ld\+json"[^>]*>[^<]*<script/i);
  assert.doesNotMatch(evilLive, /<script>alert\(/);
});
