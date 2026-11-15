import { esc, fmtUtc, clockTag } from './util.js';

const NAV = [
  ['/', 'Home', 'home'],
  ['/#latest', 'Latest', 'latest'],
  ['/local/', 'Local', 'local'],
  ['/regions/', 'Incident map', 'regions'],
  ['/terrorism/', 'Global terror', 'terrorism'],
  ['/about/', 'Methodology', 'about'],
];

const price = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Masthead ticker: one index at a time. Open markets first so the rotator leads with live quotes. */
function marketTicker(markets = []) {
  const list = [...(markets || [])].filter((m) => Number.isFinite(m.price));
  if (!list.length) return '';
  list.sort((a, b) => Number(b.open) - Number(a.open));
  const items = list.map((m, i) => {
    const dir = m.changePct > 0 ? 'up' : m.changePct < 0 ? 'down' : 'flat';
    const change = m.changePct === null ? '' : `<span class="tk-${dir}">${dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'} ${Math.abs(m.changePct).toFixed(2)}%</span>`;
    const status = `<span class="tk-status">${change ? ' · ' : ''}${m.open ? clockTag(m.time) : 'Closed'}</span>`;
    return `<span class="wc-face" data-ticker-item${i ? ' hidden' : ''}><span class="wc-city">${esc(m.name)}</span><span class="wc-time">${price.format(m.price)}</span><span class="wc-meta">${change}${status}</span></span>`;
  });
  return `<button type="button" class="ticker rotator" data-ticker aria-label="Stock markets, show the next index">${items.join('')}</button>`;
}

function editionAge(generated) {
  if (!Number.isFinite(generated)) return '';
  return `<span class="edition-age" data-edition-age datetime="${esc(new Date(generated).toISOString())}" title="Edition generated ${esc(fmtUtc(generated, { withYear: true }))}">As of …</span>`;
}

/** Persistent Breaking strip; the full-screen flash is the first hit for a brand-new lead. */
function breakingKicker(breaking) {
  if (!breaking) return '';
  return `<div class="breaking-kicker" data-breaking-kicker role="status">
<a class="bk-link" data-bk-link href="/live/${esc(breaking.id)}/"><span class="bk-label">Breaking</span> <span data-bk-title>${esc(breaking.title)}</span></a>
<button type="button" class="bk-dismiss" data-bk-dismiss aria-label="Dismiss breaking alert">Dismiss</button>
</div>`;
}

export function layout({ title, description, path, body, ctx, active = '' }) {
  const { snapshot, site, assets } = ctx;
  const generated = Date.parse(snapshot.generatedAt);
  const breaking = snapshot.live?.[0];
  const fullTitle = title ? `${title} · SENTINEL` : 'SENTINEL · Global Incident & Threat Monitor';
  const canonical = site.url.replace(/\/$/, '') + path;
  // Browsers keep favicons in a cache of their own, keyed by URL, so a changed icon gets a new URL.
  const iconV = assets.icons ? `?v=${esc(assets.icons)}` : '';
  const nav = NAV.map(
    ([href, label, key]) => `<li><a href="${href}"${key === active ? ' aria-current="page"' : ''}>${esc(label)}</a></li>`,
  ).join('');

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#0b2545">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SENTINEL">
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(site.url.replace(/\/$/, ''))}/icon-512.png">
<meta property="og:image:alt" content="SENTINEL logo">
<meta name="twitter:card" content="summary">
<meta name="sentinel-generated" content="${esc(snapshot.generatedAt)}">
${breaking ? `<meta name="sentinel-breaking" content="${esc(breaking.id)}">` : ''}
<link rel="icon" href="/favicon.ico${iconV}" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon-32.png${iconV}" type="image/png" sizes="32x32">
<link rel="icon" href="/favicon.svg${iconV}" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png${iconV}">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="${esc(assets.css)}">
<script src="${esc(assets.js)}" defer></script>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<header class="masthead"><div class="wrap">
<div class="masthead-lead">
<a class="brand" href="/" aria-label="SENTINEL home">
<span class="brand-text"><img class="brand-word" src="/sentinel-wordmark.png${iconV}" alt="SENTINEL — Global Incident and Threat Monitor" width="720" height="107"><span class="brand-badges" aria-label="Release status"><span class="brand-badge brand-beta">Beta</span>${site.version ? `<span class="brand-badge brand-version">v${esc(site.version)}</span>` : ''}</span></span>
</a>
${editionAge(generated)}
</div>
<a class="brand-mark-link" href="/" tabindex="-1" aria-hidden="true">
<svg class="brand-mark" viewBox="0 0 240 240" aria-hidden="true"><rect width="240" height="240" rx="42" fill="#1c2753"/><path d="M20 119.5A129.7 129.7 0 0 1 219 119.5A129.7 129.7 0 0 1 20 119.5Z" fill="none" stroke="#fff" stroke-width="10" stroke-linejoin="round"/><circle cx="119.5" cy="119.5" r="44.25" fill="#1c2753" stroke="#0078ff" stroke-width="9.5"/><ellipse cx="119.5" cy="119.5" rx="17.5" ry="44.25" fill="none" stroke="#0078ff" stroke-width="8"/><path d="M75 119.5H164" stroke="#0078ff" stroke-width="9"/></svg>
</a>
<div class="masthead-tools">
${marketTicker(snapshot.markets)}
<button type="button" class="world-clock rotator" data-world-clock hidden aria-label="World clock, show the next city"><span class="wc-face"><span class="wc-city"></span><span class="wc-time"></span><span class="wc-meta"></span></span></button>
</div>
</div></header>
<nav class="nav" aria-label="Sections"><div class="wrap"><ul>${nav}</ul></div></nav>
${breakingKicker(breaking)}
<div class="update-banner" role="status" hidden><a href="" data-reload><span data-banner-text>New updates published</span> · Refresh</a></div>
<div class="breaking-flash" data-breaking-flash hidden role="dialog" aria-modal="true" aria-labelledby="breaking-flash-title">
<div class="bf-bars" aria-hidden="true"><span></span><span></span><span></span></div>
<div class="bf-panel">
<p class="bf-kicker">Breaking</p>
<h2 id="breaking-flash-title" data-bf-title></h2>
<div class="bf-actions">
<a class="bf-go" data-bf-link href="/">Follow live coverage</a>
<button type="button" class="bf-dismiss" data-bf-dismiss>Dismiss</button>
</div>
</div>
</div>
<main id="content">
${body}
</main>
<footer class="footer"><div class="wrap">
<div class="footer-brand"><strong>SENTINEL</strong> · Open-source situational awareness</div>
<p>SENTINEL automatically aggregates public reporting from news publishers, official hazard agencies and public social posts. Headlines are links to original reporting; classifications, locations and threat levels are automated heuristics, not verified intelligence or official advice. In an emergency follow guidance from local authorities.</p>
<p class="small">Edition generated ${esc(fmtUtc(generated, { withYear: true }))} from a ${snapshot.windowHours}-hour window · Map data: Natural Earth (public domain) · Seismic data: USGS · Hazard alerts: GDACS · Content © respective publishers.</p>
<ul class="footer-links"><li><a href="/about/">Methodology</a></li><li><a href="/about/#sources">Sources</a></li><li><a href="/regions/">All regions</a></li><li><a href="/countries/">Countries</a></li><li><a href="/data/snapshot.json">Data (JSON)</a></li></ul>
</div></footer>
</body>
</html>`;
}
