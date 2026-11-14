import { esc, fmtUtc } from './util.js';

const NAV = [
  ['/', 'Home', 'home'],
  ['/#map', 'Threat map', 'map'],
  ['/regions/', 'Regions', 'regions'],
  ['/terrorism/', 'Suspected terrorism', 'terrorism'],
  ['/#latest', 'Latest', 'latest'],
  ['/about/', 'Methodology & sources', 'about'],
];

export function layout({ title, description, path, body, ctx, active = '' }) {
  const { snapshot, site, assets } = ctx;
  const generated = Date.parse(snapshot.generatedAt);
  const fullTitle = title ? `${title} · SENTINEL` : 'SENTINEL · Global Incident & Threat Monitor';
  const canonical = site.url.replace(/\/$/, '') + path;
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
<meta name="twitter:card" content="summary">
<meta name="sentinel-generated" content="${esc(snapshot.generatedAt)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="${esc(assets.css)}">
<script src="${esc(assets.js)}" defer></script>
</head>
<body>
<a class="skip" href="#content">Skip to content</a>
<div class="utility"><div class="wrap">
<span>${esc(fmtUtc(generated, { withYear: true }))}</span>
<span class="utility-right"><span class="u-long">Static edition · checked for news every ~${esc(String(site.publishMinutes))} min · </span><a href="/about/#sources">${snapshot.stats.sourcesOnline}/${snapshot.stats.sourcesTotal} sources online</a></span>
</div></div>
<header class="masthead"><div class="wrap">
<a class="brand" href="/" aria-label="SENTINEL home">
<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="4"/><circle cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="3.5"/><path d="M16 3v6M16 23v6M3 16h6M23 16h6"/></svg>
<span class="brand-text"><strong>SENTINEL</strong><small>Global Incident &amp; Threat Monitor</small></span>
</a>
</div></header>
<nav class="nav" aria-label="Sections"><div class="wrap"><ul>${nav}</ul></div></nav>
<div class="update-banner" role="status" hidden><a href="" data-reload><span data-banner-text>New updates published</span> · Refresh</a></div>
<main id="content">
${body}
</main>
<footer class="footer"><div class="wrap">
<div class="footer-brand"><strong>SENTINEL</strong> · Open-source situational awareness</div>
<p>SENTINEL automatically aggregates public reporting from news publishers, official hazard agencies and public social posts. Headlines are links to original reporting; classifications, locations and threat levels are automated heuristics, not verified intelligence or official advice. In an emergency follow guidance from local authorities.</p>
<p class="small">Edition generated ${esc(fmtUtc(generated, { withYear: true }))} from a ${snapshot.windowHours}-hour window · Map data: Natural Earth (public domain) · Seismic data: USGS · Hazard alerts: GDACS · Content © respective publishers.</p>
<ul class="footer-links"><li><a href="/about/">Methodology</a></li><li><a href="/about/#sources">Sources</a></li><li><a href="/regions/">All regions</a></li><li><a href="/data/snapshot.json">Data (JSON)</a></li></ul>
</div></footer>
</body>
</html>`;
}
