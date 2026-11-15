import { esc, safeHref, timeTag, clockTag, trim, compactHeadline, usefulUpdateDek, fmtUtc, filterCategory, LEVEL_LABEL, TREND, EVIDENCE } from './util.js';
import { countriesOf, countryPath } from './countries.js';
import { leanTag } from './lean.js';

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

function regionLink(inc, ctx) {
  const loc = inc.location;
  if (!loc) return '<span>Location unclear</span>';
  const href = countryPath(ctx, loc.iso3);
  const country = href ? `<a href="${esc(href)}">${esc(loc.country)}</a>` : esc(loc.country);
  // Country (and city/place when known) only — readers do not need the SENTINEL region name here.
  return `<span>${loc.place ? `<span class="k-place">${esc(loc.place)}, </span>` : ''}${country}</span>`;
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
  const title = compactHeadline(inc.title);
  return `<${tag} class="headline"><a href="${esc(safeHref(inc.url))}" target="_blank" rel="noopener noreferrer">${esc(title)}<span class="vh"> (opens ${esc(via)} in a new tab)</span></a></${tag}>`;
}

// Dek length per variant; 0 hides the summary. Latest rows use usefulUpdateDek for sev ≥ 3.
const DEK = { lead: 320, tile: 150, item: 200, row: 0, compact: 0 };

/**
 * Variants: lead (front-page splash), tile (headline grid), row (latest-updates feed),
 * item (full card for region/terrorism lists), compact (headline only).
 */
export function incidentCard(inc, ctx, { variant = 'item', anchor = true, className = '' } = {}) {
  const { snapshot, now } = ctx;
  const sources = inc.sources
    .map(
      (s) =>
        `<li><a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>${leanTag(s.lean || s.name, snapshot)}${s.via ? ` <span class="muted">via ${esc(s.via)}</span>` : ''} · ${esc(fmtUtc(s.time))}</li>`,
    )
    .join('');
  const evidenceLabel = EVIDENCE[inc.evidence];
  const brief = variant === 'tile' || variant === 'row';
  const showSev = !brief || inc.severity >= (variant === 'tile' ? 4 : 3);
  // Skip "Multiple outlets" on cards — the source list already shows corroboration.
  const showEv = inc.evidence !== 'multi' && (!brief || inc.evidence !== 'publisher');
  const showSources = variant !== 'tile' && inc.sources.length > 1;
  const src = primarySource(inc);
  const dekLen = DEK[variant] ?? 200;
  const live = ctx.liveFor?.(inc);
  const rowDek = variant === 'row' && inc.severity >= 3 ? usefulUpdateDek(inc, 180) : '';
  const dekHtml =
    rowDek
      ? `<p class="dek">${esc(rowDek)}</p>`
      : inc.summary && dekLen
        ? `<p class="dek">${esc(trim(inc.summary, dekLen))}</p>`
        : '';

  const meta = [
    live ? `<a class="live-link" href="/live/${esc(live.id)}/">${livePill(live, ctx)} Follow coverage</a>` : '',
    variant === 'row' ? '' : timeTag(inc.time, now),
    src ? `<span class="src">${esc(src.name)}</span>${leanTag(src.lean || src.name, snapshot)}` : '',
    showSev ? `<span class="sev sev-${inc.severity}" title="Severity ${inc.severity} of 5">Severity ${inc.severity}/5</span>` : '',
    showEv && evidenceLabel ? `<span class="ev ev-${esc(inc.evidence)}">${esc(evidenceLabel)}</span>` : '',
    casualtyText(inc.casualties, inc.evidence),
    inc.retrospective ? '<span class="muted">Background / retrospective</span>' : '',
  ].join('');

  const body = `<div class="kicker"><span class="cat cat-${esc(inc.category)}">${esc(snapshot.categories[inc.category])}</span>${regionLink(inc, ctx)}</div>
${headline(inc, 'h3')}
${dekHtml}
<div class="meta">${meta}</div>
${showSources ? `<details class="sources"><summary>${sourceSummary(inc.sources)}</summary><ul>${sources}</ul></details>` : ''}`;

  return `<article class="story story-${variant}${className ? ` ${esc(className)}` : ''}"${anchor ? ` id="i-${esc(inc.id)}"` : ''} data-cat="${esc(filterCategory(inc))}" data-ev="${esc(inc.evidence)}">
${variant === 'row' ? `<div class="row-time">${timeTag(inc.time, now)}</div><div class="row-body">${body}</div>` : body}
</article>`;
}

/** The leading developing story is tagged Breaking; the others are Live. */
export function livePill(story, ctx) {
  const label = ctx.snapshot.live?.[0]?.id === story.id ? 'Breaking' : 'Live';
  return `<span class="live-pill">${label}</span>`;
}

function liveHeadline(u) {
  return `<a href="${esc(safeHref(u.url))}" target="_blank" rel="noopener noreferrer">${esc(compactHeadline(u.title))}<span class="vh"> (opens ${esc(u.source)} in a new tab)</span></a>`;
}

/**
 * A live story's picture, shown from the publisher's own servers and credited to it. The image
 * links to `href` (the live page from the front page, else the article it came from); the
 * figure hides itself if the image fails to load.
 */
export function storyFigure(story, { href, className = '' } = {}) {
  const img = story.image;
  const src = img && safeHref(img.url);
  if (!src || !src.startsWith('https://')) return '';
  const external = !href;
  const link = href || safeHref(img.link);
  return `<figure class="story-figure ${esc(className)}" data-hide-on-error>
<a href="${esc(link)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''} tabindex="-1" aria-hidden="true"><img src="${esc(src)}" alt="" width="976" height="549" decoding="async" referrerpolicy="no-referrer"></a>
<figcaption>Picture: <a href="${esc(safeHref(img.link))}" target="_blank" rel="noopener noreferrer">${esc(img.source)}<span class="vh"> (opens the article in a new tab)</span></a></figcaption>
</figure>`;
}

/** Front-page teaser for a live story: the newest updates, then a link to the full coverage. */
export function liveTeaser(story, ctx, { main = false } = {}) {
  const kicker = `<p class="live-kicker">${livePill(story, ctx)}<span>${story.outlets.length} outlets · updated ${timeTag(story.updatedAt, ctx.now)}</span></p>`;
  if (!main) {
    return `<article class="live-teaser live-teaser-more">${kicker}<h3 class="live-title"><a href="/live/${esc(story.id)}/">${esc(compactHeadline(story.title))}</a></h3></article>`;
  }
  const figure = storyFigure(story, { href: `/live/${story.id}/`, className: 'live-teaser-figure' });
  return `<article class="live-teaser live-teaser-main${figure ? ' has-figure' : ''}">
${figure}
<div class="live-teaser-body">
${kicker}
<h3 class="live-title"><a href="/live/${esc(story.id)}/">${esc(compactHeadline(story.title))}</a></h3>
<ul class="live-latest">${story.updates
    .slice(0, 2)
    .map((u) => `<li>${clockTag(u.time)}<span class="src">${esc(u.source)}</span>${leanTag(u.lean || u.source, ctx.snapshot)}${liveHeadline(u)}</li>`)
    .join('')}</ul>
<a class="live-more" href="/live/${esc(story.id)}/">Follow live coverage: ${story.reportCount} update${story.reportCount === 1 ? '' : 's'} →</a>
</div>
</article>`;
}

/** One post in a live-coverage timeline. The whole post opens the original article. */
export function liveUpdate(u, now, snapshot) {
  const dek = usefulUpdateDek(u);
  return `<li class="live-post${u.liveBlog ? ' is-liveblog' : ''}">
<div class="live-time">${clockTag(u.time)}${timeTag(u.time, now)}</div>
<article class="story live-update">
<p class="live-src"><span class="src">${esc(u.source)}</span>${leanTag(u.lean || u.source, snapshot)}${u.liveBlog ? ' <span class="live-blog-tag">Live blog</span>' : ''}${u.via ? ` <span class="muted">via ${esc(u.via)}</span>` : ''}</p>
<h3 class="headline">${liveHeadline(u)}</h3>
${dek ? `<p class="dek">${esc(dek)}</p>` : ''}
</article>
</li>`;
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

export function filterChips(snapshot, incidents, adviceCount = 0) {
  const counts = {};
  for (const i of incidents) counts[filterCategory(i)] = (counts[filterCategory(i)] || 0) + 1;
  const chips = Object.entries(snapshot.categories)
    .filter(([k]) => counts[k])
    .map(([k, label]) => `<button type="button" class="chip" data-filter="${esc(k)}" aria-pressed="false">${esc(label)} <span>${counts[k]}</span></button>`)
    .join('');
  const advice = adviceCount ? `<button type="button" class="chip" data-filter="advice" aria-pressed="false">Travel advice <span>${adviceCount}</span></button>` : '';
  return `<div class="chips" role="toolbar" aria-label="Filter incidents by category" hidden><button type="button" class="chip" data-filter="all" aria-pressed="true">All <span>${incidents.length + adviceCount}</span></button>${chips}${advice}<button type="button" class="chip chip-alt" data-filter="verified" aria-pressed="false">Hide unverified social</button></div>`;
}

/** A change to official travel advice, as a row in the Latest feed. */
export function adviceRow(change, ctx) {
  const country = countriesOf(ctx).get(change.iso3);
  const region = country && ctx.regionNames[country.region];
  const gov = change.gov === 'us' ? 'US State Department' : 'UK Foreign Office';
  return `<article class="story story-row story-advice${change.raised ? ' advice-raised' : ''}" data-cat="advice" data-ev="official">
<div class="row-time">${timeTag(change.time, ctx.now)}</div><div class="row-body"><div class="kicker"><span class="cat cat-advice">Travel advice</span>${region ? `<a href="/region/${esc(country.region)}/">${esc(region)}</a> · ` : ''}${country ? `<a href="${esc(country.path)}">${esc(country.name)}</a>` : ''}</div>
<h3 class="headline"><a href="${esc(safeHref(change.url))}" target="_blank" rel="noopener noreferrer">${esc(change.title)}<span class="vh"> (opens the ${esc(gov)} in a new tab)</span></a></h3>
<div class="meta"><span class="src">${esc(gov)}</span>${change.summary ? `<span class="muted">${esc(trim(change.summary, 160))}</span>` : ''}</div>
</div>
</article>`;
}

/** Incidents, optionally interleaved with travel advice changes, newest first. */
export function incidentList(list, ctx, { filterable = false, pageSize = 25, variant = 'item', empty = 'No incidents in this window.', advice = [], leadId } = {}) {
  if (!list.length && !advice.length) return `<p class="empty">${esc(empty)}</p>`;
  const rows = [...list.map((i) => ({ time: i.time, html: () => incidentCard(i, ctx, { variant, className: i.id === leadId ? 'is-lead' : '' }) })), ...advice.map((c) => ({ time: c.time, html: () => adviceRow(c, ctx) }))];
  if (advice.length) rows.sort((a, b) => b.time - a.time);
  return `${filterable ? filterChips(ctx.snapshot, list, advice.length) : ''}<div class="story-list" data-page-size="${pageSize}">${rows.map((r) => r.html()).join('')}</div>`;
}

export function sourceTable(sources, now, snapshot) {
  const rows = sources
    .map(
      (s) =>
        `<tr><td><a href="${esc(safeHref(s.home))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>${leanTag(s.lean || s.name, snapshot)}<div class="muted small">${esc(
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
<dt><span class="ev ev-social">Unverified social</span></dt><dd>Public Bluesky posts. Heavily down-weighted; can never lead the headlines or cause a High rating alone.</dd>
</dl>`;
}
