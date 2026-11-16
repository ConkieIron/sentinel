import { layout } from './layout.js';
import { renderMap, sparkline } from './map.js';
import {
  incidentCard,
  incidentList,
  regionRow,
  sectionHead,
  sourceTable,
  evidenceGuide,
  levelBadge,
  indexBar,
  trendTag,
  liveTeaser,
  liveUpdate,
  livePill,
  storyFigure,
} from './components.js';
import { leanCaveat } from './lean.js';
import { esc, safeHref, timeTag, fmtUtc, ago, LEVEL_LABEL, isReportedTerror, filterCategory, inLatest, bySeriousness, byPublishedThenSeverity, compactHeadline, publishedTime } from './util.js';
import { countriesOf, countryPath, adviceChangedAt, adviceChanges } from './countries.js';

const OFFICIAL_LINKS = [
  ['UK FCDO travel advice', 'https://www.gov.uk/foreign-travel-advice'],
  ['US State Dept travel advisories', 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html'],
  ['UN OCHA ReliefWeb', 'https://reliefweb.int/'],
  ['USGS earthquake map', 'https://earthquake.usgs.gov/earthquakes/map/'],
  ['GDACS disaster alerts', 'https://www.gdacs.org/'],
  ['Cloudflare Radar outages', 'https://radar.cloudflare.com/outage-center'],
];

function threatStrip(snapshot) {
  const raised = snapshot.regions.filter((r) => r.level !== 'low');
  const items = raised.length
    ? raised.map((r) => `<li><a href="/region/${esc(r.id)}/"><span class="dot lvl-${esc(r.level)}" aria-hidden="true"></span>${esc(r.name)}<span class="vh"> (${esc(LEVEL_LABEL[r.level])})</span></a></li>`).join('')
    : '<li>No region above Low</li>';
  const lead = (snapshot.live || []).find((s) => s.breaking);
  const breaking = lead
    ? `<a class="ts-breaking" href="/live/${esc(lead.id)}/"><span class="ts-break-label">Breaking</span> ${esc(compactHeadline(lead.title))}</a>`
    : '';
  return `<section class="threat-strip" aria-label="Regional threat levels"><div class="wrap">
<span class="ts-label">Threat levels</span>
<ul>${items}</ul>
${breaking}
<a class="ts-map" href="#map">Map ↓</a>
</div></section>`;
}

/**
 * A sidebar panel that folds away. On phones, where the sidebar sits under the main column, it
 * starts closed; app.js opens `openWide` panels on screens wide enough for a real sidebar.
 */
function foldPanel(title, body, { openWide = true, note = '' } = {}) {
  return `<details class="panel panel-fold"${openWide ? ' data-open-wide' : ''}>
<summary class="panel-title"><span>${esc(title)}</span>${note ? `<span class="fold-note">${esc(note)}</span>` : ''}</summary>
${body}
</details>`;
}

// The front page's main column already has the threat index and the headlines, so these two
// sidebar panels only show beside it, not under it.
function homePanels(ctx, serious) {
  const { snapshot, now } = ctx;
  return `<section class="panel wide-only">
<h2 class="panel-title">Regional threat levels</h2>
<ul class="link-list">${snapshot.regions
    .slice(0, 8)
    .map((r) => `<li><a href="/region/${esc(r.id)}/">${esc(r.name)}</a> ${levelBadge(r.level)}</li>`)
    .join('')}</ul>
<p class="small"><a href="/regions/">All ${snapshot.regions.length} regions →</a></p>
</section>
<section class="panel wide-only">
<h2 class="panel-title">Most serious right now</h2>
<ol class="ranked">${serious
    .map(
      (i) =>
        `<li><a href="${esc(safeHref(i.url))}" target="_blank" rel="noopener noreferrer">${esc(compactHeadline(i.title))}</a><span class="muted small">${esc(i.location?.country || 'Location unclear')} · ${timeTag(publishedTime(i, now), now)}</span></li>`,
    )
    .join('')}</ol>
</section>`;
}

function liveBox(ctx) {
  const live = ctx.snapshot.live || [];
  if (!live.length) return '';
  return `<section class="live-box" aria-label="Live coverage">
${live.map((s, i) => liveTeaser(s, ctx, { main: i === 0 })).join('')}
</section>`;
}

export function livePage(ctx, story) {
  const { snapshot, now, regionNames } = ctx;
  const counts = new Map();
  for (const u of story.updates) counts.set(u.source, (counts.get(u.source) || 0) + 1);
  // When every headline was a restatement, the timeline is empty — still list covering outlets.
  if (!counts.size) for (const name of story.outlets || []) counts.set(name, 1);
  const others = (snapshot.live || []).filter((s) => s.id !== story.id);
  const loc = story.location;
  const region = loc?.region && regionNames[loc.region];
  const updateCount = story.updates?.length || 0;
  const body = `<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <span>Live coverage</span></nav>
<section class="hero hero-small live-hero">
<p class="eyebrow">${livePill(story, ctx)} <span class="cat cat-${esc(story.category)}">${esc(snapshot.categories[story.category] || '')}</span>${
    region ? ` · <a href="/region/${esc(loc.region)}/">${esc(region)}</a>` : ''
  }</p>
<h1>${esc(compactHeadline(story.title))}</h1>
${story.summary ? `<p class="hero-dek">${esc(story.summary)}</p>` : ''}
${storyFigure(story, { className: 'live-hero-figure' })}
<ul class="facts">
<li><strong>${story.reportCount}</strong> report${story.reportCount === 1 ? '' : 's'}</li>
<li><strong>${story.outlets.length}</strong> outlets</li>
<li>Latest ${timeTag(story.updatedAt, now, { updated: true })}</li>
<li>First report ${esc(fmtUtc(story.startedAt))}</li>
</ul>
</section>
<div class="layout">
<div class="main-col">
<section class="section section-first">
${sectionHead('Latest updates', { id: 'updates' })}
${
  updateCount
    ? `<p class="section-dek">Newest first. Near-identical headlines are shown once. Every row links to the original report on the publisher's site.</p>
<ol class="live-feed" data-live-id="${esc(story.id)}" data-latest="${story.updatedAt}" data-page-size="20">
${story.updates.map((u) => liveUpdate(u, now, snapshot)).join('')}
</ol>
${story.reportCount > updateCount ? `<p class="small muted">${story.outlets.length} outlets · ${updateCount} distinct update${updateCount === 1 ? '' : 's'} from ${story.reportCount} reports.</p>` : ''}`
    : `<p class="section-dek">Outlets are still covering this story, but every new headline so far restates the same development — new distinct updates will appear here as they land.</p>
<ol class="live-feed" data-live-id="${esc(story.id)}" data-latest="${story.updatedAt}" data-page-size="20"></ol>`
}
</section>
</div>
<aside class="sidebar">
${foldPanel(
  'Outlets covering this story',
  `<ul class="link-list outlet-list">${[...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `<li><span>${esc(name)}</span><span class="muted">${n}</span></li>`)
    .join('')}</ul>`,
  { note: `${counts.size}` },
)}
${
  others.length
    ? `<section class="panel">
<h2 class="panel-title">Also live</h2>
<ul class="link-list">${others.map((s) => `<li><a href="/live/${esc(s.id)}/">${esc(s.title)}</a></li>`).join('')}</ul>
</section>`
    : ''
}
<section class="panel">
<h2 class="panel-title">About live coverage</h2>
<p>A story gets live coverage when at least three outlets are reporting it and it is still developing. Only a story that started within the last few hours is marked Breaking — later pile-on coverage of an older event stays Live. Wire updates usually reach the site within a couple of minutes of the watcher seeing them; other major outlets are checked every few minutes while a story is live.</p>
<p><a href="/">Back to the latest briefing →</a></p>
</section>
</aside>
</div>
</div>`;
  return layout({
    title: `${story.breaking || (snapshot.live || []).find((s) => s.breaking)?.id === story.id ? 'Breaking' : 'Live'}: ${story.title}`,
    description: `Live coverage from ${story.outlets.length} outlets: ${story.title}`,
    path: `/live/${story.id}/`,
    body,
    ctx,
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Live coverage', path: `/live/${story.id}/` },
    ],
    live: story,
  });
}

function sidebar(ctx, extra = '') {
  const { snapshot, now } = ctx;
  return `<aside class="sidebar">
${extra}
${foldPanel(
  'How to read SENTINEL',
  `<p>Each region's <strong>threat level</strong> compares its recent incident activity with every other region. <strong>High</strong> marks the most active areas in this edition, not an absolute danger rating.</p>
<p><a href="/about/">Read the full methodology →</a></p>`,
)}
${foldPanel('Evidence labels', evidenceGuide())}
${foldPanel('Source health', sourceTable(snapshot.sources, now, snapshot), {
  openWide: false,
  note: `${snapshot.sources.filter((s) => s.ok).length} of ${snapshot.sources.length} online`,
})}
${foldPanel('Official resources', `<ul class="link-list">${OFFICIAL_LINKS.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener noreferrer">${esc(n)}</a></li>`).join('')}</ul>`)}
</aside>`;
}

/**
 * Latest headlines: newest verified reports of severity 3–5 (published time, then severity).
 * "Most serious right now" still ranks severity first.
 */
export function headlineIncidents(incidents, limit = 7) {
  return incidents
    .filter((i) => i.evidence !== 'social' && !i.retrospective && i.severity >= 3)
    .sort(byPublishedThenSeverity)
    .slice(0, limit);
}

/** Latest timeline: severity ≥ 2, excluding stories already shown as headlines. */
const latestFeed = (ctx, excludeIds = new Set()) =>
  ctx.snapshot.incidents
    .filter((i) => inLatest(i) && !excludeIds.has(i.id))
    .sort(byPublishedThenSeverity)
    .slice(0, ctx.site.homeIncidents);

export function homePage(ctx) {
  const { snapshot, now } = ctx;
  const s = snapshot.stats;
  const newestFirst = (a, b) => b.time - a.time;

  const fresh = headlineIncidents(snapshot.incidents, 7);
  const lead = fresh[0];
  const tiles = fresh.slice(1);
  const headlineIds = new Set(fresh.map((i) => i.id));

  // Stories already in the headline grid are left out of Latest so each appears once.
  const feed = latestFeed(ctx, headlineIds);
  const listedIds = new Set([...headlineIds, ...feed.map((i) => i.id)]);
  // Severity first — independent of Latest headlines, which are newest-first.
  const serious = snapshot.incidents
    .filter((i) => i.evidence !== 'social' && !i.retrospective && i.severity >= 3)
    .sort(bySeriousness)
    .slice(0, 5);
  const terror = snapshot.incidents.filter(isReportedTerror).sort(newestFirst);
  const pins = snapshot.incidents.filter((i) => i.location && (listedIds.has(i.id) || i.severity >= 3)).slice(0, 220);
  const pinnedNotListed = pins.filter((i) => !listedIds.has(i.id));

  const highest = snapshot.regions.filter((r) => r.level === 'high').map((r) => r.name);
  const dek = highest.length
    ? `Highest relative activity: ${highest.join(', ')}.`
    : 'No region currently meets the High threshold.';

  const body = `${threatStrip(snapshot)}
<div class="wrap">
<h1 class="vh">SENTINEL: latest world incidents and suspected terrorism</h1>
<div class="layout">
<div class="main-col">
${liveBox(ctx)}
<section class="section section-first">
${sectionHead('Latest headlines', { more: { href: '#latest', label: 'All updates' } })}
${
  lead
    ? `<div class="headlines">
${incidentCard(lead, ctx, { variant: 'lead' })}
${tiles.map((i) => incidentCard(i, ctx, { variant: 'tile' })).join('')}
</div>`
    : '<p class="empty">No verified incident reports in this window yet.</p>'
}
</section>

<section class="section">
${sectionHead('Latest updates', { id: 'latest' })}
${leanCaveat()}
${incidentList(feed, ctx, { filterable: true, pageSize: 20, variant: 'row', advice: adviceChanges(snapshot, now) })}
</section>

<section id="map" class="section">
${sectionHead('Regional threat map', { more: { href: '/regions/', label: 'All regions' } })}
<p class="section-dek">${esc(dek)} ${s.incidents} incidents in the last ${snapshot.windowHours} hours from ${s.sourcesOnline} live sources, including ${s.terrorism} suspected terrorism report${s.terrorism === 1 ? '' : 's'}.</p>
${renderMap(snapshot, { incidents: pins, caption: 'Tap a region for its briefing or a marker for the incident. Markers on country centres are approximate; USGS and GDACS markers are exact.' })}
</section>

<section class="section">
${sectionHead('Regional threat index', { more: { href: '/regions/', label: 'All regions' } })}
<ol class="region-list region-list-short">${snapshot.regions.map((r, i) => regionRow(r, i + 1)).join('')}</ol>
</section>

<section class="section">
${sectionHead('Suspected terrorism', { more: { href: '/terrorism/', label: `All ${terror.length} reports` } })}
${terror.length ? `<div class="compact-list">${terror.slice(0, 6).map((i) => incidentCard(i, ctx, { variant: 'compact', anchor: false })).join('')}</div>` : '<p class="empty">No reports flagged as suspected terrorism in this window.</p>'}
${pinnedNotListed.length ? `<details class="more-pins"><summary>${pinnedNotListed.length} more mapped incidents</summary>${pinnedNotListed.map((i) => incidentCard(i, ctx, { variant: 'compact' })).join('')}</details>` : ''}
</section>
</div>
${sidebar(ctx, homePanels(ctx, serious))}
</div>
</div>`;

  return layout({
    title: '',
    description: `Live-updated static briefing of world incidents and suspected terrorism with a regional threat index. ${dek}`,
    path: '/',
    body,
    ctx,
    active: 'home',
    pageType: 'WebPage',
  });
}

export function regionsIndexPage(ctx) {
  const { snapshot } = ctx;
  const pins = snapshot.incidents.filter((i) => i.location && i.severity >= 2).slice(0, 220);
  const body = `<div class="wrap">
<section class="hero hero-small">
<p class="eyebrow">Regional threat index</p>
<h1>Incident map</h1>
<p class="hero-dek">${pins.length} located incidents and ${snapshot.regions.length} regions ranked by weighted incident activity over the last ${snapshot.windowHours} hours. Levels are relative to one another.</p>
${countrySearch(ctx)}
<p class="small"><a href="/countries/">Browse all ${countriesOf(ctx).size} country briefings →</a></p>
</section>
${renderMap(snapshot, { incidents: pins })}
<ol class="region-list region-list-full">${snapshot.regions.map((r, i) => regionRow(r, i + 1)).join('')}</ol>
</div>`;
  return layout({
    title: 'Incident map',
    description: 'Map of located world incidents with the threat level, index and incident counts for every monitored region.',
    path: '/regions/',
    body,
    ctx,
    active: 'regions',
    pageType: 'CollectionPage',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Incident map', path: '/regions/' },
    ],
  });
}

const US_LEVEL_CLASS = { 1: 'adv-1', 2: 'adv-2', 3: 'adv-3', 4: 'adv-4' };
const shortDate = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
// Advice that changed this recently is flagged next to the country.
const ADVICE_NEW_MS = 48 * 3600000;

const usBadge = (a) => (a.us ? `<span class="adv ${US_LEVEL_CLASS[a.us.level] || ''}">US Level ${a.us.level}: ${esc(a.us.label)}</span>` : '');

function adviceChangedBadge(a, now) {
  const at = adviceChangedAt(a);
  if (!at || now - at > ADVICE_NEW_MS) return '';
  const raised = a.us?.levelChangedAt === at && a.us.previousLevel && a.us.level > a.us.previousLevel;
  return `<span class="adv-new${raised ? ' adv-new-raised' : ''}">${raised ? 'US level raised' : 'Advice changed'} ${esc(ago(at, now))}</span>`;
}

/** Official advice for countries in this region's news, then any others the US says not to visit. */
function travelPanel(ctx, region, list) {
  const { snapshot, now } = ctx;
  const counts = {};
  for (const i of list) if (i.location?.iso3) counts[i.location.iso3] = (counts[i.location.iso3] || 0) + 1;
  const rows = Object.entries(snapshot.travel || {})
    .filter(([iso3, a]) => a.region === region.id && (counts[iso3] || a.us?.level === 4 || now - adviceChangedAt(a) <= ADVICE_NEW_MS))
    .sort(([a, x], [b, y]) => (counts[b] || 0) - (counts[a] || 0) || (y.us?.level || 0) - (x.us?.level || 0) || x.name.localeCompare(y.name));
  if (!rows.length) return '';
  const row = ([iso3, a]) => {
    const links = [
      a.fcdo && `<a href="${esc(safeHref(a.fcdo.url))}" target="_blank" rel="noopener noreferrer"${a.fcdo.change ? ` title="${esc(a.fcdo.change)}"` : ''}>UK FCDO</a>`,
      a.us && `<a href="${esc(safeHref(a.us.url))}" target="_blank" rel="noopener noreferrer">US State Dept</a>`,
    ].filter(Boolean);
    const updated = a.fcdo?.updated ? `UK advice updated ${shortDate(a.fcdo.updated)}` : '';
    const href = countryPath(ctx, iso3);
    return `<li class="adv-row"><div class="adv-head"><strong>${href ? `<a href="${esc(href)}">${esc(a.name)}</a>` : esc(a.name)}</strong>${counts[iso3] ? `<span class="muted small">${counts[iso3]} in the news</span>` : ''}</div>${usBadge(a)}${adviceChangedBadge(a, now)}<div class="adv-links small">${links.join(' · ')}${updated ? `<span class="muted"> · ${updated}</span>` : ''}</div></li>`;
  };
  const first = rows.slice(0, 8);
  const rest = rows.slice(8);
  return `<section class="panel">
<h2 class="panel-title">Official travel advice</h2>
<ul class="adv-list">${first.map(row).join('')}</ul>
${rest.length ? `<details class="adv-more"><summary>${rest.length} more countr${rest.length === 1 ? 'y' : 'ies'}</summary><ul class="adv-list">${rest.map(row).join('')}</ul></details>` : ''}
<p class="small muted">From the UK Foreign Office and the US State Department. Always check the full advice before you travel.</p>
</section>`;
}

export function regionPage(ctx, region) {
  const { snapshot, now } = ctx;
  const list = snapshot.incidents.filter((i) => i.location?.region === region.id).sort((a, b) => b.time - a.time);
  const leader = snapshot.regions[0];
  const rank = snapshot.regions.findIndex((r) => r.id === region.id) + 1;
  const why =
    region.score === 0
      ? 'No located incidents were reported in this region during the window.'
      : region.id === leader.id
        ? `This is the most active region in this edition (score ${region.score}).`
        : `Score ${region.score} against ${leader.score} for the most active region (${esc(leader.name)}), ranking ${rank} of ${snapshot.regions.length}.`;

  const body = `<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/regions/">Incident map</a> › <span>${esc(region.name)}</span></nav>
<section class="hero hero-small region-hero lvl-border-${esc(region.level)}">
<p class="eyebrow">Regional briefing</p>
<h1>${esc(region.name)}</h1>
<div class="region-score">${levelBadge(region.level)}<span class="big-index">${region.index}<small>/100 index</small></span>${trendTag(region.trend)}</div>
<p class="hero-dek">${why}</p>
<ul class="facts">
<li><strong>${region.incidents}</strong> incidents</li>
<li><strong>${region.severe}</strong> severe (4–5)</li>
<li><strong>${region.terrorism}</strong> suspected terrorism</li>
<li><strong>${region.reportedDeaths.toLocaleString('en-GB')}</strong> deaths reported*</li>
</ul>
<p class="small muted">*Sum of the highest figure cited per incident in publisher reports; tolls are often revised and may double count.</p>
</section>
<div class="layout">
<div class="main-col">
${renderMap(snapshot, { incidents: list, focusRegion: region.id })}
<section class="section">
${sectionHead(`Incidents in ${region.name}`)}
${incidentList(list, ctx, { filterable: list.length > 6, pageSize: 25, empty: 'No located incidents in this region during the window.' })}
</section>
</div>
<aside class="sidebar">
${travelPanel(ctx, region, list)}
<section class="panel">
<h2 class="panel-title">Seven-day trend</h2>
${sparkline(snapshot.history || [], region.id)}
</section>
<section class="panel">
<h2 class="panel-title">Hotspots</h2>
${
  region.hotspots.length
    ? `<ol class="hotspots">${region.hotspots
        .map((h) => {
          const href = countryPath(ctx, h.iso3);
          return `<li><span>${href ? `<a href="${esc(href)}">${esc(h.name)}</a>` : esc(h.name)}</span><strong>${h.count}</strong></li>`;
        })
        .join('')}</ol>`
    : '<p class="muted">None in this window.</p>'
}
<p class="small"><a href="/countries/">All countries →</a></p>
</section>
${foldPanel(
  'Other regions',
  `<ul class="link-list">${snapshot.regions
    .filter((r) => r.id !== region.id)
    .map((r) => `<li><a href="/region/${esc(r.id)}/">${esc(r.name)}</a> ${levelBadge(r.level)}</li>`)
    .join('')}</ul>`,
)}
</aside>
</div>
</div>`;
  return layout({
    title: `${region.name} threat briefing`,
    description: `${region.name}: ${LEVEL_LABEL[region.level]} relative threat level, ${region.incidents} incidents and ${region.terrorism} suspected terrorism reports in the last ${snapshot.windowHours} hours.`,
    path: `/region/${region.id}/`,
    body,
    ctx,
    active: 'regions',
    pageType: 'CollectionPage',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Incident map', path: '/regions/' },
      { name: region.name, path: `/region/${region.id}/` },
    ],
  });
}

/** Jumps straight to a country page with JavaScript; without it, opens the A–Z list. */
export function countrySearch(ctx) {
  const options = [...countriesOf(ctx).values()].map((c) => `<option value="${esc(c.name)}" data-href="${esc(c.path)}"></option>`).join('');
  return `<form class="country-search" action="/countries/" method="get" role="search" data-country-search>
<label for="country-q">Find a country</label>
<div class="cs-row"><input id="country-q" name="q" type="search" list="country-names" autocomplete="off" placeholder="Start typing, e.g. Ukraine"><button type="submit">Go</button></div>
<datalist id="country-names">${options}</datalist>
</form>`;
}

function adviceBox(ctx, country) {
  const a = country.travel;
  const { now } = ctx;
  const fallback = `<p>No official advice was found for ${esc(country.name)} in this edition. See the <a href="https://www.gov.uk/foreign-travel-advice" target="_blank" rel="noopener noreferrer">UK FCDO</a> or the <a href="https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html" target="_blank" rel="noopener noreferrer">US State Department</a>.</p>`;
  const us = a?.us
    ? `<div class="advice-card"><h3>US State Department</h3>${usBadge(a)}${
        a.us.levelChangedAt && a.us.previousLevel
          ? `<p class="small"><strong>${a.us.level > a.us.previousLevel ? 'Raised' : 'Lowered'} from Level ${a.us.previousLevel}</strong> ${esc(ago(a.us.levelChangedAt, now))}.</p>`
          : ''
      }${a.us.updated ? `<p class="small muted">Advisory dated ${shortDate(a.us.updated)}</p>` : ''}<p><a href="${esc(safeHref(a.us.url))}" target="_blank" rel="noopener noreferrer">Read the US advisory →</a></p></div>`
    : '';
  const uk = a?.fcdo
    ? `<div class="advice-card"><h3>UK Foreign Office</h3>${a.fcdo.change ? `<p>${esc(a.fcdo.change)}</p>` : ''}${
        a.fcdo.updated ? `<p class="small muted">Updated ${shortDate(a.fcdo.updated)}${now - a.fcdo.updated <= ADVICE_NEW_MS ? ` <span class="adv-new">${esc(ago(a.fcdo.updated, now))}</span>` : ''}</p>` : ''
      }<p><a href="${esc(safeHref(a.fcdo.url))}" target="_blank" rel="noopener noreferrer">Read the FCDO advice →</a></p></div>`
    : '';
  return `<section class="section advice-box">
${sectionHead('Official travel advice')}
${us || uk ? `<div class="advice-grid">${uk}${us}</div>` : fallback}
<p class="small muted">SENTINEL's threat levels compare news activity between regions; they are not travel advice. Always read the full official advice before you travel.</p>
</section>`;
}

export function countryPage(ctx, country) {
  const { snapshot } = ctx;
  const region = snapshot.regions.find((r) => r.id === country.region);
  const list = country.incidents;
  const verified = list.filter((i) => i.evidence !== 'social');
  const deaths = verified.reduce((n, i) => n + (i.casualties?.killed || 0), 0);
  const terror = list.filter(isReportedTerror).length;
  const neighbours = [...countriesOf(ctx).values()].filter((c) => c.region === country.region && c.iso3 !== country.iso3 && c.incidents.length).sort((a, b) => b.incidents.length - a.incidents.length);

  const body = `<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/regions/">Incident map</a> › ${region ? `<a href="/region/${esc(region.id)}/">${esc(region.name)}</a> › ` : ''}<span>${esc(country.name)}</span></nav>
<section class="hero hero-small${region ? ` region-hero lvl-border-${esc(region.level)}` : ''}">
<p class="eyebrow">Country briefing</p>
<h1>${esc(country.name)}</h1>
${region ? `<p class="hero-dek">Part of <a href="/region/${esc(region.id)}/">${esc(region.name)}</a>, which is at ${levelBadge(region.level)} relative threat (index ${region.index}/100). ${country.travel ? `${usBadge(country.travel)} ${adviceChangedBadge(country.travel, ctx.now)}` : ''}</p>` : ''}
<ul class="facts">
<li><strong>${list.length}</strong> incident${list.length === 1 ? '' : 's'}</li>
<li><strong>${list.filter((i) => i.severity >= 4).length}</strong> severe (4–5)</li>
<li><strong>${terror}</strong> suspected terrorism</li>
<li><strong>${deaths.toLocaleString('en-GB')}</strong> deaths reported*</li>
</ul>
<p class="small muted">In the last ${snapshot.windowHours} hours. *Sum of the highest figure cited per incident in publisher reports; tolls are often revised and may double count.</p>
</section>
<div class="layout">
<div class="main-col">
${adviceBox(ctx, country)}
${list.some((i) => i.location) ? renderMap(snapshot, { incidents: list, focusRegion: country.region }) : ''}
<section class="section">
${sectionHead(`Incidents in ${country.name}`)}
${incidentList(list, ctx, { filterable: list.length > 6, pageSize: 25, empty: `No incidents in ${country.name} were reported in the last ${snapshot.windowHours} hours.` })}
</section>
</div>
<aside class="sidebar">
<section class="panel">
${countrySearch(ctx)}
</section>
${
  neighbours.length
    ? `<section class="panel"><h2 class="panel-title">Elsewhere in ${esc(region?.name || 'the region')}</h2><ul class="link-list">${neighbours
        .slice(0, 10)
        .map((c) => `<li><a href="${esc(c.path)}">${esc(c.name)}</a><span class="muted small">${c.incidents.length}</span></li>`)
        .join('')}</ul></section>`
    : ''
}
<section class="panel"><p class="small"><a href="/countries/">All countries →</a></p></section>
</aside>
</div>
</div>`;
  return layout({
    title: `${country.name} briefing`,
    description: `${country.name}: ${list.length} incidents in the last ${snapshot.windowHours} hours, with UK and US official travel advice.`,
    path: country.path,
    body,
    ctx,
    active: 'regions',
    pageType: 'CollectionPage',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Incident map', path: '/regions/' },
      ...(region ? [{ name: region.name, path: `/region/${region.id}/` }] : []),
      { name: country.name, path: country.path },
    ],
  });
}

export function countriesIndexPage(ctx) {
  const { snapshot, now } = ctx;
  const countries = [...countriesOf(ctx).values()];
  const inNews = countries.filter((c) => c.incidents.length).length;
  const rows = countries
    .map(
      (c) => `<li class="country-row" data-name="${esc(c.name.toLowerCase())}"><a href="${esc(c.path)}"><strong>${esc(c.name)}</strong></a><span class="muted small">${esc(ctx.regionNames[c.region] || '')}</span><span class="small">${
        c.incidents.length ? `${c.incidents.length} incident${c.incidents.length === 1 ? '' : 's'}` : '<span class="muted">No incidents</span>'
      }</span>${c.travel ? `${usBadge(c.travel)}${adviceChangedBadge(c.travel, now)}` : ''}</li>`,
    )
    .join('');
  const body = `<div class="wrap narrow">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/regions/">Incident map</a> › <span>Countries</span></nav>
<section class="hero hero-small">
<p class="eyebrow">Country briefings</p>
<h1>Countries</h1>
<p class="hero-dek">${inNews} countries in the news in the last ${snapshot.windowHours} hours, plus every country the US advises against visiting and any whose official advice changed recently.</p>
${countrySearch(ctx)}
</section>
<ul class="country-list" data-country-list>${rows}</ul>
<p class="empty" data-country-empty hidden>No country with a briefing matches that name. Only countries in this edition's news, or with notable travel advice, have a page.</p>
</div>`;
  return layout({
    title: 'Countries',
    description: 'Country briefings: incidents in the news and official UK and US travel advice.',
    path: '/countries/',
    body,
    ctx,
    active: 'regions',
    pageType: 'CollectionPage',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Incident map', path: '/regions/' },
      { name: 'Countries', path: '/countries/' },
    ],
  });
}

/**
 * Local Incidents: a shell page. GPS is matched to a country on-device; cards for that ISO3 are
 * loaded from /data/local/{iso3}.json so the page does not ship the whole world as hidden HTML.
 */
export function localPage(ctx) {
  const { snapshot } = ctx;
  const body = `<div class="wrap">
<section class="hero hero-small">
<p class="eyebrow">Local incidents</p>
<h1>Incidents in your country</h1>
<p class="hero-dek">Verified headlines for the country you are in. Your location stays on this device and is only used to pick a country — it is never sent to SENTINEL.</p>
</section>
<section class="local-panel" data-local>
<div class="local-status" data-local-status>
<p data-local-message>Share your location to see verified incidents reported in your country in the last ${snapshot.windowHours} hours.</p>
<p class="local-actions"><button type="button" class="local-btn" data-local-locate>Use my location</button></p>
</div>
<div class="local-result" data-local-result hidden>
<p class="eyebrow" data-local-label></p>
<h2 class="local-country" data-local-country></h2>
<p class="muted small" data-local-meta></p>
<p class="local-actions"><button type="button" class="local-btn local-btn-ghost" data-local-retry>Change location</button> <a class="local-link" data-local-briefing hidden>Full country briefing →</a></p>
</div>
<div class="local-fallback" data-local-fallback hidden>
<p class="muted small">Or pick a country by name:</p>
${countrySearch(ctx)}
</div>
</section>
<section class="section section-first">
${sectionHead('Latest headlines')}
<p class="empty" data-local-empty>Use your location above to load local headlines.</p>
<div class="headlines" data-local-list></div>
</section>
</div>`;
  return layout({
    title: 'Local incidents',
    description: `Incidents reported in your country in the last ${snapshot.windowHours} hours, matched from your device location.`,
    path: '/local/',
    body,
    ctx,
    active: 'local',
    pageType: 'WebPage',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Local incidents', path: '/local/' },
    ],
  });
}

/** Per-country headline HTML for the Local page (written to /data/local/{iso3}.json). */
export function localCardsByIso(ctx) {
  const byIso = new Map();
  for (const i of ctx.snapshot.incidents) {
    const iso = i.location?.iso3;
    if (!iso || i.evidence === 'social' || i.retrospective) continue;
    if (!byIso.has(iso)) byIso.set(iso, []);
    byIso.get(iso).push(i);
  }
  const out = new Map();
  for (const [iso3, list] of byIso) {
    list.sort((a, b) => b.time - a.time);
    out.set(
      iso3,
      list.map((i) => incidentCard(i, ctx, { variant: 'tile', className: 'local-item' })).join(''),
    );
  }
  return out;
}

export function terrorismPage(ctx) {
  const { snapshot } = ctx;
  const all = snapshot.incidents.filter((i) => i.category === 'terrorism').sort((a, b) => b.time - a.time);
  const list = all.filter(isReportedTerror);
  const background = all.filter((i) => i.retrospective);
  const social = all.filter((i) => !i.retrospective && i.evidence === 'social');
  const regionCounts = {};
  for (const i of list) if (i.location?.region) regionCounts[i.location.region] = (regionCounts[i.location.region] || 0) + 1;
  const byRegion = snapshot.regions.filter((r) => regionCounts[r.id]);
  const body = `<div class="wrap">
<section class="hero hero-small">
<p class="eyebrow">Global terror</p>
<h1>Attacks and plots reported as terrorism</h1>
<p class="hero-dek">${list.length} report${list.length === 1 ? '' : 's'} from news outlets and official sources in the last ${snapshot.windowHours} hours. “Suspected” means the reporting uses terrorism language, names a proscribed jihadist group, or describes a non-state armed attack. It is not a legal or official designation.</p>
${byRegion.length ? `<ul class="facts">${byRegion.map((r) => `<li><a href="/region/${esc(r.id)}/"><strong>${regionCounts[r.id]}</strong> ${esc(r.name)}</a></li>`).join('')}</ul>` : ''}
</section>
<div class="layout">
<div class="main-col">
${renderMap(snapshot, { incidents: list })}
<section class="section">
${sectionHead('Suspected terrorism reports')}
${incidentList(list, ctx, { pageSize: 30, empty: 'No news outlet has reported suspected terrorism in this window.' })}
${
  social.length
    ? `<details class="more-pins"><summary>${social.length} unverified social post${social.length === 1 ? '' : 's'} mentioning terrorism</summary><p class="muted small">Public Bluesky posts that no news outlet has matched yet. They can include jokes, opinion and rumour, so they are kept off the list above.</p>${social.map((i) => incidentCard(i, ctx, { variant: 'compact' })).join('')}</details>`
    : ''
}
${
  background.length
    ? `<details class="more-pins"><summary>${background.length} anniversar${background.length === 1 ? 'y' : 'ies'}, trial${background.length === 1 ? '' : 's'} and background report${background.length === 1 ? '' : 's'}</summary><p class="muted small">Coverage of past attacks, such as memorials, court cases and sentencing.</p>${background.map((i) => incidentCard(i, ctx, { variant: 'compact' })).join('')}</details>`
    : ''
}
</section>
</div>
${sidebar(ctx)}
</div>
</div>`;
  return layout({
    title: 'Global terror',
    description: `Suspected terrorism incidents reported worldwide in the last ${snapshot.windowHours} hours.`,
    path: '/terrorism/',
    body,
    ctx,
    active: 'terrorism',
    pageType: 'CollectionPage',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Global terror', path: '/terrorism/' },
    ],
  });
}

export function aboutPage(ctx) {
  const { snapshot, now } = ctx;
  const inFeed = {};
  for (const i of snapshot.incidents.filter(inLatest)) inFeed[filterCategory(i)] = (inFeed[filterCategory(i)] || 0) + 1;
  const catRows = Object.entries(snapshot.categories)
    .map(([k, label]) => `<tr><td><span class="cat cat-${esc(k)}">${esc(label)}</span></td><td class="num">${inFeed[k] || 0}</td></tr>`)
    .join('');
  const body = `<div class="wrap narrow">
<section class="hero hero-small">
<p class="eyebrow">Methodology &amp; sources</p>
<h1>How SENTINEL builds each edition</h1>
<p class="hero-dek">Each edition is compiled from public reporting over the last ${snapshot.windowHours} hours. The pages you read are a finished briefing.</p>
</section>

<article class="prose">
<h2>What goes in</h2>
<p>Reports come from news organisations, their official social accounts, public social posts, and official hazard alerts such as earthquakes and disasters. The outlets in this edition are listed below. Each one is tagged with an approximate <strong>editorial lean</strong> (Left, Centre-left, Centre, Centre-right, Right, Wire, State-funded or Official). These labels are a transparency aid drawn from commonly cited media-bias placements and public-broadcaster status. They are <em>not</em> accuracy ratings.</p>
<p>Stock figures in the masthead can be delayed by up to 15 minutes. Open indexes rotate first; closed ones still appear marked Closed.</p>

<h2>How reports are read</h2>
<p>Each report is placed in a category and given a <strong>severity from 1 to 5</strong>, based on the headline and standfirst, including any casualties they cite. Commentary, sport and routine business coverage are left out. Look-backs such as anniversaries and trials stay in the record as background.</p>
<p>Headlines and standfirsts on the site are rewritten into SENTINEL’s own briefing wording. Each card still links to the publisher’s original report.</p>
<p>Suspected terrorism counts, the Global terror list and the diamond markers on the maps include only reports from news outlets and official sources. Unverified social posts, and coverage of past attacks, are listed separately at the foot of the Global terror page.</p>
<div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">In Latest now</th></tr></thead><tbody>${catRows}</tbody></table></div>
<p class="muted small">Latest headlines are the newest verified reports of severity 3–5. <strong>Most serious right now</strong> ranks by severity, so a grave but older story still surfaces there. Other notable reports appear under Latest updates and do not repeat a headline story.</p>

<h2>Where they are placed</h2>
<p>A report is placed on the country it names, or on a city when one is named. Official earthquake and disaster alerts use the coordinates those agencies publish. Failures described as worldwide are labelled <strong>Global</strong> rather than pinned to one country.</p>

<h2>One story, many reports</h2>
<p>Reports about the same event are merged into one incident. Independent coverage by several outlets raises confidence. Social posts on their own do not.</p>

<h2>Breaking and live coverage</h2>
<p>A story several outlets are still developing gets its own page. Coverage that started in the last few hours can be marked <strong>Breaking</strong>; older developing stories stay <strong>Live</strong>. The title follows the newest straight news headline, and each update links to the outlet’s original report.</p>

<h2>Regional threat levels</h2>
<p>A region’s level reflects how severe its recent incidents are, how widely they were reported, and how fresh they are. A few severe events count for more than a large number of minor ones. Levels are <strong>relative</strong>: they compare regions with each other in this edition.</p>
<ul>
<li><span class="lvl lvl-high">High</span> among the most active regions</li>
<li><span class="lvl lvl-medium">Medium</span> clearly active, below the busiest regions</li>
<li><span class="lvl lvl-low">Low</span> everything else</li>
</ul>
<p>A quiet news day does not mark every region High. Because the index measures <em>reported</em> activity, regions with heavier coverage can score higher than equally affected regions with less coverage.</p>

<h2>Official travel advice</h2>
<p>Region and country pages show UK Foreign, Commonwealth &amp; Development Office and US State Department advice for countries in the news, plus every country the US rates Level 4, “Do not travel”. A change in either government’s advice is noted on the country page and under Latest updates. SENTINEL’s threat levels are not travel advice.</p>

<h2>Limitations</h2>
<ul>
<li>Classification is automated and will sometimes be wrong.</li>
<li>“Suspected terrorism” reflects how events are reported, not an official designation.</li>
<li>Casualty figures are the highest number cited and may be revised or double counted.</li>
<li>This is not official advice. For travel and safety decisions use official government guidance.</li>
</ul>

<h2 id="sources">Sources in this edition</h2>
${sourceTable(snapshot.sources, now, snapshot)}
<p class="small muted">Edition generated ${esc(fmtUtc(Date.parse(snapshot.generatedAt), { withYear: true }))}. ${snapshot.stats.reportsScanned} reports scanned, ${snapshot.stats.incidentReports} classified as incident reports, merged into ${snapshot.stats.incidents} incidents.</p>

<h2>Evidence labels</h2>
${evidenceGuide()}
</article>
</div>`;
  return layout({
    title: 'Methodology & sources',
    description: 'How SENTINEL reads public reporting and turns it into a regional threat briefing.',
    path: '/about/',
    body,
    ctx,
    active: 'about',
    pageType: 'AboutPage',
    breadcrumbs: [
      { name: 'Home', path: '/' },
      { name: 'Methodology & sources', path: '/about/' },
    ],
  });
}

export function notFoundPage(ctx) {
  const body = `<div class="wrap narrow"><section class="hero hero-small"><p class="eyebrow">404</p><h1>Page not found</h1><p class="hero-dek">This page may belong to an earlier edition. <a href="/">Return to the latest briefing →</a></p></section></div>`;
  return layout({ title: 'Page not found', description: 'Page not found', path: '/404', body, ctx });
}
