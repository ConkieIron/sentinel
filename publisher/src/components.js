import { esc, safeHref, timeTag, trim, fmtUtc, LEVEL_LABEL, TREND, EVIDENCE } from './util.js';

export function levelBadge(level) {
  return `<span class="lvl lvl-${esc(level)}">${esc(LEVEL_LABEL[level])}</span>`;
}

export function indexBar(index, level) {
  return `<svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="track" width="100" height="8"/><rect class="fill lvl-${esc(level)}" width="${Math.max(2, index)}" height="8"/></svg>`;
}

export function trendTag(trend) {
  const [icon, label] = TREND[trend] || TREND.new;
  return `<span class="trend trend-${esc(trend)}" title="Compared with the same time yesterday"><span aria-hidden="true">${icon}</span> ${esc(label)}</span>`;
}

function casualtyText(c, evidence) {
  if (!c || evidence === 'social') return '';
  const parts = [];
  if (c.killed) parts.push(`${c.killed.toLocaleString('en-GB')} killed`);
  if (c.injured) parts.push(`${c.injured.toLocaleString('en-GB')} injured`);
  return parts.length ? `<span class="toll">${parts.join(', ')} reported</span>` : '';
}

function regionLink(inc, regionNames) {
  const loc = inc.location;
  if (!loc) return '<span>Location unclear</span>';
  const place = [loc.place, loc.country].filter(Boolean).join(', ');
  const region = loc.region && regionNames[loc.region];
  return `${region ? `<a href="/region/${esc(loc.region)}/">${esc(region)}</a> · ` : ''}<span>${esc(place)}</span>`;
}

function sourceSummary(sources) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const social = sources.filter((s) => s.type === 'social').length;
  const other = sources.length - social;
  if (!social) return plural(other, 'source');
  if (!other) return plural(social, 'social post');
  return `${plural(other, 'source')} + ${plural(social, 'social post')}`;
}

export function primarySource(inc) {
  return inc.sources.find((s) => s.url === inc.url) || inc.sources[0];
}

// The headline link covers the whole card (see .headline a::after), so a tap anywhere on the
// card opens the original article.
function headline(inc, tag) {
  const via = primarySource(inc)?.name || 'the original article';
  return `<${tag} class="headline"><a href="${esc(safeHref(inc.url))}" target="_blank" rel="noopener noreferrer">${esc(inc.title)}<span class="vh"> (opens ${esc(via)} in a new tab)</span></a></${tag}>`;
}

// Dek length per variant; 0 hides the summary.
const DEK = { lead: 320, tile: 150, item: 200, row: 0, compact: 0 };

/**
 * Variants: lead (front-page splash), tile (headline grid), row (latest-updates feed),
 * item (full card for region/terrorism lists), compact (headline only).
 */
export function incidentCard(inc, ctx, { variant = 'item', anchor = true } = {}) {
  const { snapshot, now, regionNames } = ctx;
  const sources = inc.sources
    .map(
      (s) =>
        `<li><a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>${s.via ? ` <span class="muted">via ${esc(s.via)}</span>` : ''} · ${esc(fmtUtc(s.time))}</li>`,
    )
    .join('');
  const evidenceLabel = inc.evidence === 'multi' ? `${EVIDENCE.multi} (${inc.sourceCount})` : EVIDENCE[inc.evidence];
  const brief = variant === 'tile' || variant === 'row';
  const showSev = !brief || inc.severity >= (variant === 'tile' ? 4 : 3);
  const showEv = !brief || inc.evidence !== 'publisher';
  const showSources = variant !== 'tile' && inc.sources.length > 1;
  const src = primarySource(inc);
  const dekLen = DEK[variant] ?? 200;

  const meta = [
    variant === 'row' ? '' : timeTag(inc.time, now),
    src ? `<span class="src">${esc(src.name)}</span>` : '',
    showSev ? `<span class="sev sev-${inc.severity}" title="Severity ${inc.severity} of 5">Severity ${inc.severity}/5</span>` : '',
    showEv ? `<span class="ev ev-${esc(inc.evidence)}">${esc(evidenceLabel)}</span>` : '',
    casualtyText(inc.casualties, inc.evidence),
    inc.retrospective ? '<span class="muted">Background / retrospective</span>' : '',
  ].join('');

  const body = `<div class="kicker"><span class="cat cat-${esc(inc.category)}">${esc(snapshot.categories[inc.category])}</span>${regionLink(inc, regionNames)}</div>
${headline(inc, 'h3')}
${inc.summary && dekLen ? `<p class="dek">${esc(trim(inc.summary, dekLen))}</p>` : ''}
<div class="meta">${meta}</div>
${showSources ? `<details class="sources"><summary>${sourceSummary(inc.sources)}</summary><ul>${sources}</ul></details>` : ''}`;

  return `<article class="story story-${variant}"${anchor ? ` id="i-${esc(inc.id)}"` : ''} data-cat="${esc(inc.category)}" data-ev="${esc(inc.evidence)}">
${variant === 'row' ? `<div class="row-time">${timeTag(inc.time, now)}</div><div class="row-body">${body}</div>` : body}
</article>`;
}

export function regionRow(r, rank) {
  return `<li class="region-row">
<a href="/region/${esc(r.id)}/">
<span class="rank">${rank}</span>
<span class="rname">${esc(r.name)}</span>
${levelBadge(r.level)}
<span class="rbar">${indexBar(r.index, r.level)}<span class="rindex">${r.index}</span></span>
<span class="rstats">${r.incidents} incident${r.incidents === 1 ? '' : 's'}${r.terrorism ? ` · <strong>${r.terrorism} suspected terrorism</strong>` : ''}</span>
${trendTag(r.trend)}
</a>
</li>`;
}

export function sectionHead(title, { id, more } = {}) {
  return `<header class="section-head"${id ? ` id="${esc(id)}"` : ''}><h2>${esc(title)}</h2>${more ? `<a class="more" href="${esc(more.href)}">${esc(more.label)} →</a>` : ''}</header>`;
}

export function filterChips(snapshot, incidents) {
  const counts = {};
  for (const i of incidents) counts[i.category] = (counts[i.category] || 0) + 1;
  const chips = Object.entries(snapshot.categories)
    .filter(([k]) => counts[k])
    .map(([k, label]) => `<button type="button" class="chip" data-filter="${esc(k)}" aria-pressed="false">${esc(label)} <span>${counts[k]}</span></button>`)
    .join('');
  return `<div class="chips" role="toolbar" aria-label="Filter incidents by category" hidden><button type="button" class="chip" data-filter="all" aria-pressed="true">All <span>${incidents.length}</span></button>${chips}<button type="button" class="chip chip-alt" data-filter="verified" aria-pressed="false">Hide unverified social</button></div>`;
}

export function incidentList(list, ctx, { filterable = false, pageSize = 25, variant = 'item', empty = 'No incidents in this window.' } = {}) {
  if (!list.length) return `<p class="empty">${esc(empty)}</p>`;
  return `${filterable ? filterChips(ctx.snapshot, list) : ''}<div class="story-list" data-page-size="${pageSize}">${list.map((i) => incidentCard(i, ctx, { variant })).join('')}</div>`;
}

export function sourceTable(sources, now) {
  const rows = sources
    .map(
      (s) =>
        `<tr><td><a href="${esc(safeHref(s.home))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a><div class="muted small">${esc(
          { rss: 'News RSS', 'bluesky-publisher': 'Publisher on Bluesky', official: 'Official data', social: 'Social (unverified)' }[s.kind] || s.kind,
        )}</div></td><td>${s.ok ? `<span class="ok">● Online</span>` : `<span class="down" title="${esc(s.error || '')}">● Unavailable</span>`}</td><td class="num">${s.items}</td><td class="small">${
          s.newest ? timeTag(s.newest, now) : '—'
        }</td></tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table class="sources-table"><thead><tr><th>Source</th><th>Status</th><th class="num">Items</th><th>Latest</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function evidenceGuide() {
  return `<dl class="guide">
<dt><span class="ev ev-official">Official record</span></dt><dd>Published by an authority such as USGS or GDACS. Confirms the measured hazard, not every reported impact.</dd>
<dt><span class="ev ev-multi">Multiple outlets</span></dt><dd>Two or more independent publishers describe a matching event. They may share upstream sources.</dd>
<dt><span class="ev ev-publisher">Single outlet</span></dt><dd>One established publisher reports it. Not independently verified by SENTINEL.</dd>
<dt><span class="ev ev-social">Unverified social</span></dt><dd>Public Bluesky posts. Heavily down-weighted; can never trigger the breaking banner or a High rating alone.</dd>
</dl>`;
}
