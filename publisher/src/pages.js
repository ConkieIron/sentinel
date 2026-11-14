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
import { esc, safeHref, timeTag, fmtUtc, ago, LEVEL_LABEL, isReportedTerror, filterCategory, inLatest } from './util.js';
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
  return `<section class="threat-strip" aria-label="Regional threat levels"><div class="wrap">
<span class="ts-label">Threat levels</span>
<ul>${items}</ul>
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
        `<li><a href="${esc(safeHref(i.url))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><span class="muted small">${esc(i.location?.country || 'Location unclear')} · ${timeTag(i.time, now)}</span></li>`,
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
  const others = (snapshot.live || []).filter((s) => s.id !== story.id);
  const loc = story.location;
  const region = loc?.region && regionNames[loc.region];
  const shown = story.updates.length;

  const body = `<div class="wrap">
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <span>Live coverage</span></nav>
<section class="hero hero-small live-hero">
<p class="eyebrow">${livePill(story, ctx)} <span class="cat cat-${esc(story.category)}">${esc(snapshot.categories[story.category] || '')}</span>${
    region ? ` · <a href="/region/${esc(loc.region)}/">${esc(region)}</a>` : ''
  }</p>
<h1>${esc(story.title)}</h1>
${story.summary ? `<p class="hero-dek">${esc(story.summary)}</p>` : ''}
${storyFigure(story, { className: 'live-hero-figure' })}
<ul class="facts">
<li><strong>${story.reportCount}</strong> report${story.reportCount === 1 ? '' : 's'}</li>
<li><strong>${story.outlets.length}</strong> outlets</li>
<li>Latest ${timeTag(story.updatedAt, now)}</li>
<li>First report ${esc(fmtUtc(story.startedAt))}</li>
</ul>
</section>
<div class="layout">
<div class="main-col">
<section class="section section-first">
${sectionHead('Latest updates', { id: 'updates' })}
<p class="section-dek">Newest first. Every update links to the original report on the publisher's site. SENTINEL groups reports automatically by matching headlines, so a closely related story can occasionally appear.</p>
<ol class="live-feed" data-live-id="${esc(story.id)}" data-latest="${story.updatedAt}" data-page-size="20">
${story.updates.map((u) => liveUpdate(u, now)).join('')}
</ol>
${story.reportCount > shown ? `<p class="small muted">Showing the newest ${shown} of ${story.reportCount} reports.</p>` : ''}
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
<p>A story gets live coverage when at least three outlets are reporting it and it is still developing. The leading one is marked Breaking. Updates from major wire services and outlets on Bluesky can publish within a few minutes; others appear within about five.</p>
<p><a href="/">Back to the latest briefing →</a></p>
</section>
</aside>
</div>
</div>`;
  return layout({
    title: `${snapshot.live?.[0]?.id === story.id ? 'Breaking' : 'Live'}: ${story.title}`,
    description: `Live coverage from ${story.outlets.length} outlets: ${story.title}`,
    path: `/live/${story.id}/`,
    body,
    ctx,
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
${foldPanel('Source health', sourceTable(snapshot.sources, now), {
  openWide: false,
  note: `${snapshot.sources.filter((s) => s.ok).length} of ${snapshot.sources.length} online`,
})}
${foldPanel('Official resources', `<ul class="link-list">${OFFICIAL_LINKS.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener noreferrer">${esc(n)}</a></li>`).join('')}</ul>`)}
</aside>`;
}

/** The Latest timeline on the home page, headlines included, newest first. */
const latestFeed = (ctx) =>
  ctx.snapshot.incidents
    .filter(inLatest)
    .sort((a, b) => b.time - a.time)
    .slice(0, ctx.site.homeIncidents);

export function homePage(ctx) {
  const { snapshot, now } = ctx;
  const s = snapshot.stats;
  const newestFirst = (a, b) => b.time - a.time;

  // Headlines: the newest verified reports. The most severe of that fresh batch leads.
  const fresh = snapshot.incidents
    .filter((i) => i.evidence !== 'social' && !i.retrospective && i.severity >= 2)
    .sort(newestFirst)
    .slice(0, 7);
  const lead = [...fresh].sort((a, b) => b.severity - a.severity || b.time - a.time)[0];
  const tiles = fresh.filter((i) => i !== lead);
  const headlineIds = new Set(fresh.map((i) => i.id));

  // The full timeline, headlines included, so its first row is always the newest report.
  const feed = latestFeed(ctx);
  const listedIds = new Set([...headlineIds, ...feed.map((i) => i.id)]);
  const serious = snapshot.incidents.filter((i) => i.evidence !== 'social' && !i.retrospective).slice(0, 5);
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
${incidentList(feed, ctx, { filterable: true, pageSize: 20, variant: 'row', advice: adviceChanges(snapshot, now), leadId: lead?.id })}
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
  return layout({ title: 'Incident map', description: 'Map of located world incidents with the threat level, index and incident counts for every monitored region.', path: '/regions/', body, ctx, active: 'regions' });
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
  return layout({ title: 'Countries', description: 'Country briefings: incidents in the news and official UK and US travel advice.', path: '/countries/', body, ctx, active: 'regions' });
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
  return layout({ title: 'Global terror', description: `Suspected terrorism incidents reported worldwide in the last ${snapshot.windowHours} hours.`, path: '/terrorism/', body, ctx, active: 'terrorism' });
}

export function aboutPage(ctx) {
  const { snapshot, now } = ctx;
  const m = snapshot.model;
  const inFeed = {};
  for (const i of latestFeed(ctx)) inFeed[filterCategory(i)] = (inFeed[filterCategory(i)] || 0) + 1;
  const catRows = Object.entries(snapshot.categories)
    .map(([k, label]) => `<tr><td><span class="cat cat-${esc(k)}">${esc(label)}</span></td><td class="num">${m.categoryWeight[k]}</td><td class="num">${inFeed[k] || 0}</td></tr>`)
    .join('');
  // Outlets with two feeds (BBC News and "BBC News (top stories)") are named once.
  const names = (kind) => [...new Set(snapshot.sources.filter((s) => s.kind === kind).map((s) => s.name.replace(/\s*\((?:top stories|Bluesky)\)$/, '')))];
  const rss = names('rss');
  const bskyPublishers = names('bluesky-publisher');
  const listNames = (list) => (list.length > 8 ? `${list.slice(0, 8).join(', ')} and others` : list.join(', '));
  const body = `<div class="wrap narrow">
<section class="hero hero-small">
<p class="eyebrow">Methodology &amp; sources</p>
<h1>How SENTINEL builds each edition</h1>
<p class="hero-dek">SENTINEL is a static site. Every few minutes an automated job gathers public reporting, scores it and compiles the result into plain HTML pages. There is no database behind these pages.</p>
</section>

<article class="prose">
<h2>1. Collection and publishing</h2>
<p>Every five minutes SENTINEL reads ${snapshot.sources.length} sources: news feeds from ${rss.length} publishers (${esc(listNames(rss))}), the official Bluesky accounts of ${bskyPublishers.length} news organisations (${esc(listNames(bskyPublishers))}), public Bluesky posts matching incident keywords, USGS earthquake data and GDACS disaster alerts. Only items from the last ${snapshot.windowHours} hours are used.</p>
<p>A new edition is published whenever something a reader would notice has changed, and at least once an hour. Separately, a watcher checks the wire services and other major outlets every minute. When one reports major breaking news or a new development in a story covered live, it starts a rebuild straight away, so these usually appear within two or three minutes.</p>
<p>Stock market figures in the masthead come from Yahoo Finance and can be delayed by up to 15 minutes.</p>

<h2>2. Classification</h2>
<p>Each headline and standfirst is matched against an explainable rule set that assigns a category, extracts reported casualty figures and sets a <strong>severity from 1 to 5</strong>. Retrospective items (anniversaries, trials, sentencing) are capped at severity 1. Commentary, sport and business stories are excluded. Public social posts that read as jokes or satire are dropped.</p>
<p>Suspected terrorism counts, the Global terror list and the diamond markers on the maps include only reports from news outlets and official sources. Unverified social posts, and coverage of past attacks such as anniversaries and trials, are listed separately at the foot of the Global terror page.</p>
<div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Weight</th><th class="num">In Latest now</th></tr></thead><tbody>${catRows}</tbody></table></div>
<p class="muted small">Latest lists reports of severity 2 and above. Unverified social posts and look-backs that read as terrorism stay in Latest but are not counted as suspected terrorism.</p>

<h2>3. Location</h2>
<p>Places named in the report are matched against a gazetteer of every country plus key cities and conflict hotspots. USGS and GDACS markers use exact coordinates; others sit on the city or country centre and are approximate.</p>

<h2>4. Corroboration</h2>
<p>Reports about the same event (same country, compatible category, within 36 hours, overlapping key terms) are merged into one incident. Independent coverage by several outlets raises confidence; social posts alone never do.</p>

<h2>5. Breaking and live coverage</h2>
<p>A story gets its own live page when at least three outlets have reported it, with at least four reports in total, and at least two outlets have reported it in the last three hours (three, once a story is more than 12 hours old, so late re-reports of a story that has ended don't keep it live). Reports are matched by their distinctive words and phrases, so follow-ups such as “flights resume” join the story even when they don't repeat its first headline. A report that shares only a couple of words with a story is added only if it appeared within a few hours of the story's main coverage. The most widely reported live story is marked <strong>Breaking</strong> and the others <strong>Live</strong>.</p>
<p>A live story's title is the newest straight news headline from the last two hours, preferring major outlets, so it follows events rather than the first report. Explainers, questions and video teasers are never used as the title. Every update links to the outlet's original report.</p>

<h2>6. Regional threat index</h2>
<p>Each incident contributes <code>severity weight × category weight × evidence weight × recency</code>. Severity weights are ${m.severityWeight.slice(1).join(', ')} for levels 1 to 5. Evidence weights are ${Object.entries(m.evidenceWeight).map(([k, v]) => `${k} ${v}`).join(', ')}. Recency halves every ${m.recencyHalfLifeHours} hours.</p>
<p>A region's score adds up its incidents, heaviest first, with diminishing returns: the second-heaviest incident counts at ${Math.round((m.diminishingReturns ?? 1) * 100)}% of its weight, the third at ${Math.round((m.diminishingReturns ?? 1) ** 2 * 100)}%, and so on. This stops a high volume of minor stories from outranking a few severe events. Levels are <strong>relative</strong>: the index is the square root of each region's score divided by the most active region's score, from 0 to 100. The square root keeps one extreme hotspot from flattening every other region.</p>
<ul>
<li><span class="lvl lvl-high">High</span> index ≥ ${Math.round(m.highRelative * 100)} and score ≥ ${m.highFloor}</li>
<li><span class="lvl lvl-medium">Medium</span> index ≥ ${Math.round(m.mediumRelative * 100)} and score ≥ ${m.mediumFloor}</li>
<li><span class="lvl lvl-low">Low</span> everything else</li>
</ul>
<p>The absolute floors stop a quiet news day from painting any region red. Because the index measures <em>reported</em> activity, regions with heavy media coverage can score higher than equally affected regions with less coverage.</p>

<h2>7. Official travel advice</h2>
<p>Region and country pages show the UK Foreign, Commonwealth &amp; Development Office (FCDO) and US State Department advice for each country in the news, plus every country the US rates Level 4, “Do not travel”. Both are read from the governments' own public feeds every six hours. A change to either government's advice is flagged on the country's page and listed under Latest updates. SENTINEL's threat levels compare news activity between regions and are not travel advice.</p>

<h2>8. Limitations</h2>
<ul>
<li>Classifications are automated keyword heuristics and will sometimes be wrong.</li>
<li>“Suspected terrorism” reflects how events are reported, not an official designation.</li>
<li>Casualty figures are the highest number cited and may be revised or double counted.</li>
<li>This is not official advice. For travel and safety decisions use official government guidance.</li>
</ul>

<h2 id="sources">Sources in this edition</h2>
${sourceTable(snapshot.sources, now)}
<p class="small muted">Edition generated ${esc(fmtUtc(Date.parse(snapshot.generatedAt), { withYear: true }))}. ${snapshot.stats.reportsScanned} reports scanned, ${snapshot.stats.incidentReports} classified as incident reports, merged into ${snapshot.stats.incidents} incidents.</p>

<h2>Evidence labels</h2>
${evidenceGuide()}
</article>
</div>`;
  return layout({ title: 'Methodology & sources', description: 'How SENTINEL collects, classifies, locates and scores world incidents into a regional threat index.', path: '/about/', body, ctx, active: 'about' });
}

export function notFoundPage(ctx) {
  const body = `<div class="wrap narrow"><section class="hero hero-small"><p class="eyebrow">404</p><h1>Page not found</h1><p class="hero-dek">This page may belong to an earlier edition. <a href="/">Return to the latest briefing →</a></p></section></div>`;
  return layout({ title: 'Page not found', description: 'Page not found', path: '/404', body, ctx });
}
