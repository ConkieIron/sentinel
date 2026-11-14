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
} from './components.js';
import { esc, safeHref, timeTag, fmtUtc, LEVEL_LABEL } from './util.js';

const OFFICIAL_LINKS = [
  ['UK FCDO travel advice', 'https://www.gov.uk/foreign-travel-advice'],
  ['US State Dept travel advisories', 'https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html'],
  ['UN OCHA ReliefWeb', 'https://reliefweb.int/'],
  ['USGS earthquake map', 'https://earthquake.usgs.gov/earthquakes/map/'],
  ['GDACS disaster alerts', 'https://www.gdacs.org/'],
  ['Cloudflare Radar outages', 'https://radar.cloudflare.com/outage-center'],
];

function breakingStrip(ctx) {
  const inc = ctx.byId.get(ctx.snapshot.breakingId);
  if (!inc) return '';
  return `<section class="breaking" aria-label="Breaking"><div class="wrap">
<span class="breaking-label">Breaking</span>
<a href="${esc(safeHref(inc.url))}" class="breaking-title" target="_blank" rel="noopener noreferrer">${esc(inc.title)}</a>
<span class="breaking-meta">${esc(inc.sources[0]?.name || '')} · ${timeTag(inc.time, ctx.now)}</span>
</div></section>`;
}

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

function homePanels(ctx, serious) {
  const { snapshot, now } = ctx;
  return `<section class="panel">
<h2 class="panel-title">Regional threat levels</h2>
<ul class="link-list">${snapshot.regions
    .slice(0, 8)
    .map((r) => `<li><a href="/region/${esc(r.id)}/">${esc(r.name)}</a> ${levelBadge(r.level)}</li>`)
    .join('')}</ul>
<p class="small"><a href="/regions/">All ${snapshot.regions.length} regions →</a></p>
</section>
<section class="panel">
<h2 class="panel-title">Most serious right now</h2>
<ol class="ranked">${serious
    .map(
      (i) =>
        `<li><a href="${esc(safeHref(i.url))}" target="_blank" rel="noopener noreferrer">${esc(i.title)}</a><span class="muted small">${esc(i.location?.country || 'Location unclear')} · ${timeTag(i.time, now)}</span></li>`,
    )
    .join('')}</ol>
</section>`;
}

function sidebar(ctx, extra = '') {
  const { snapshot, now } = ctx;
  return `<aside class="sidebar">
${extra}
<section class="panel">
<h2 class="panel-title">How to read SENTINEL</h2>
<p>Each region's <strong>threat level</strong> compares its recent incident activity with every other region. <strong>High</strong> marks the most active areas in this edition, not an absolute danger rating.</p>
<p><a href="/about/">Read the full methodology →</a></p>
</section>
<section class="panel">
<h2 class="panel-title">Evidence labels</h2>
${evidenceGuide()}
</section>
<section class="panel">
<h2 class="panel-title">Source health</h2>
${sourceTable(snapshot.sources, now)}
</section>
<section class="panel">
<h2 class="panel-title">Official resources</h2>
<ul class="link-list">${OFFICIAL_LINKS.map(([n, u]) => `<li><a href="${u}" target="_blank" rel="noopener noreferrer">${esc(n)}</a></li>`).join('')}</ul>
</section>
</aside>`;
}

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
  const feed = snapshot.incidents
    .filter((i) => i.severity >= 2)
    .sort(newestFirst)
    .slice(0, ctx.site.homeIncidents);
  const listedIds = new Set([...headlineIds, ...feed.map((i) => i.id)]);
  const serious = snapshot.incidents.filter((i) => i.evidence !== 'social' && !i.retrospective).slice(0, 5);
  const terror = snapshot.incidents.filter((i) => i.category === 'terrorism').sort(newestFirst);
  const pins = snapshot.incidents.filter((i) => i.location && (listedIds.has(i.id) || i.severity >= 3)).slice(0, 220);
  const pinnedNotListed = pins.filter((i) => !listedIds.has(i.id));

  const highest = snapshot.regions.filter((r) => r.level === 'high').map((r) => r.name);
  const dek = highest.length
    ? `Highest relative activity: ${highest.join(', ')}.`
    : 'No region currently meets the High threshold.';

  const body = `${breakingStrip(ctx)}
${threatStrip(snapshot)}
<div class="wrap">
<h1 class="vh">SENTINEL: latest world incidents and suspected terrorism</h1>
<div class="layout">
<div class="main-col">
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
${incidentList(feed, ctx, { filterable: true, pageSize: 20, variant: 'row' })}
</section>

<section id="map" class="section">
${sectionHead('Regional threat map', { more: { href: '/regions/', label: 'All regions' } })}
<p class="section-dek">${esc(dek)} ${s.incidents} incidents in the last ${snapshot.windowHours} hours from ${s.sourcesOnline} live sources, including ${s.terrorism} suspected terrorism report${s.terrorism === 1 ? '' : 's'}.</p>
${renderMap(snapshot, { incidents: pins, caption: 'Tap a region for its briefing or a marker for the incident. Markers on country centres are approximate; USGS and GDACS markers are exact.' })}
</section>

<section class="section">
${sectionHead('Regional threat index', { more: { href: '/regions/', label: 'All regions' } })}
<ol class="region-list">${snapshot.regions.map((r, i) => regionRow(r, i + 1)).join('')}</ol>
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
  const body = `<div class="wrap">
<section class="hero hero-small">
<p class="eyebrow">Regional threat index</p>
<h1>All regions</h1>
<p class="hero-dek">${snapshot.regions.length} regions ranked by weighted incident activity over the last ${snapshot.windowHours} hours. Levels are relative to one another.</p>
</section>
${renderMap(snapshot, { incidents: [] })}
<ol class="region-list region-list-full">${snapshot.regions.map((r, i) => regionRow(r, i + 1)).join('')}</ol>
</div>`;
  return layout({ title: 'Regions', description: 'Threat level, index and incident counts for every monitored world region.', path: '/regions/', body, ctx, active: 'regions' });
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
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/regions/">Regions</a> › <span>${esc(region.name)}</span></nav>
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
<section class="panel">
<h2 class="panel-title">Seven-day trend</h2>
${sparkline(snapshot.history || [], region.id)}
</section>
<section class="panel">
<h2 class="panel-title">Hotspots</h2>
${region.hotspots.length ? `<ol class="hotspots">${region.hotspots.map((h) => `<li><span>${esc(h.name)}</span><strong>${h.count}</strong></li>`).join('')}</ol>` : '<p class="muted">None in this window.</p>'}
</section>
<section class="panel">
<h2 class="panel-title">Other regions</h2>
<ul class="link-list">${snapshot.regions
    .filter((r) => r.id !== region.id)
    .map((r) => `<li><a href="/region/${esc(r.id)}/">${esc(r.name)}</a> ${levelBadge(r.level)}</li>`)
    .join('')}</ul>
</section>
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

export function terrorismPage(ctx) {
  const { snapshot } = ctx;
  const list = snapshot.incidents.filter((i) => i.category === 'terrorism').sort((a, b) => b.time - a.time);
  const byRegion = snapshot.regions.filter((r) => r.terrorism > 0);
  const body = `<div class="wrap">
<section class="hero hero-small">
<p class="eyebrow">Suspected terrorism</p>
<h1>Attacks and plots reported as terrorism</h1>
<p class="hero-dek">${list.length} report${list.length === 1 ? '' : 's'} in the last ${snapshot.windowHours} hours. “Suspected” means the reporting uses terrorism language, names a proscribed jihadist group, or describes a non-state armed attack. It is not a legal or official designation.</p>
${byRegion.length ? `<ul class="facts">${byRegion.map((r) => `<li><a href="/region/${esc(r.id)}/"><strong>${r.terrorism}</strong> ${esc(r.name)}</a></li>`).join('')}</ul>` : ''}
</section>
<div class="layout">
<div class="main-col">
${renderMap(snapshot, { incidents: list })}
<section class="section">
${sectionHead('All suspected terrorism reports')}
${incidentList(list, ctx, { pageSize: 30, empty: 'No reports flagged as suspected terrorism in this window.' })}
</section>
</div>
${sidebar(ctx)}
</div>
</div>`;
  return layout({ title: 'Suspected terrorism', description: `Suspected terrorism incidents reported worldwide in the last ${snapshot.windowHours} hours.`, path: '/terrorism/', body, ctx, active: 'terrorism' });
}

export function aboutPage(ctx) {
  const { snapshot, now } = ctx;
  const m = snapshot.model;
  const catRows = Object.entries(snapshot.categories)
    .map(([k, label]) => `<tr><td><span class="cat cat-${esc(k)}">${esc(label)}</span></td><td class="num">${m.categoryWeight[k]}</td><td class="num">${snapshot.stats.categoryCounts[k] || 0}</td></tr>`)
    .join('');
  const body = `<div class="wrap narrow">
<section class="hero hero-small">
<p class="eyebrow">Methodology &amp; sources</p>
<h1>How SENTINEL builds each edition</h1>
<p class="hero-dek">SENTINEL is a static site. A scheduled Cloudflare Worker gathers public reporting, scores it and stores a snapshot; Cloudflare Pages then compiles this snapshot into plain HTML. There is no database behind these pages.</p>
</section>

<article class="prose">
<h2>1. Collection</h2>
<p>Every 15 minutes the gatherer reads public RSS feeds from international publishers (BBC, Al Jazeera, Sky News, The Guardian, France 24, DW, Euronews and others), official publisher accounts on Bluesky (including CNN, Reuters and AP), public Bluesky posts matching incident keywords, USGS earthquake data and GDACS multi-hazard alerts. Only items from the last ${snapshot.windowHours} hours are used.</p>

<h2>2. Classification</h2>
<p>Each headline and standfirst is matched against an explainable rule set that assigns a category, extracts reported casualty figures and sets a <strong>severity from 1 to 5</strong>. Retrospective items (anniversaries, trials, sentencing) are capped at severity 1. Commentary, sport and business stories are excluded.</p>
<div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Weight</th><th class="num">This edition</th></tr></thead><tbody>${catRows}</tbody></table></div>

<h2>3. Location</h2>
<p>Places named in the report are matched against a gazetteer of every country plus key cities and conflict hotspots. USGS and GDACS markers use exact coordinates; others sit on the city or country centre and are approximate.</p>

<h2>4. Corroboration</h2>
<p>Reports about the same event (same country, compatible category, within 36 hours, overlapping key terms) are merged into one incident. Independent coverage by several outlets raises confidence; social posts alone never do.</p>

<h2>5. Regional threat index</h2>
<p>Each incident contributes <code>severity weight × category weight × evidence weight × recency</code>. Severity weights are ${m.severityWeight.slice(1).join(', ')} for levels 1 to 5. Evidence weights are ${Object.entries(m.evidenceWeight).map(([k, v]) => `${k} ${v}`).join(', ')}. Recency halves every ${m.recencyHalfLifeHours} hours.</p>
<p>A region's score adds up its incidents, heaviest first, with diminishing returns: the second-heaviest incident counts at ${Math.round((m.diminishingReturns ?? 1) * 100)}% of its weight, the third at ${Math.round((m.diminishingReturns ?? 1) ** 2 * 100)}%, and so on. This stops a high volume of minor stories from outranking a few severe events. Levels are <strong>relative</strong>: the index is the square root of each region's score divided by the most active region's score, from 0 to 100. The square root keeps one extreme hotspot from flattening every other region.</p>
<ul>
<li><span class="lvl lvl-high">High</span> index ≥ ${Math.round(m.highRelative * 100)} and score ≥ ${m.highFloor}</li>
<li><span class="lvl lvl-medium">Medium</span> index ≥ ${Math.round(m.mediumRelative * 100)} and score ≥ ${m.mediumFloor}</li>
<li><span class="lvl lvl-low">Low</span> everything else</li>
</ul>
<p>The absolute floors stop a quiet news day from painting any region red. Because the index measures <em>reported</em> activity, regions with heavy media coverage can score higher than equally affected regions with less coverage.</p>

<h2>6. Limitations</h2>
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
