// Static SVG threat map. Regions are coloured by threat level; incident pins link to the
// incident card on the same page (works without JavaScript; app.js adds tap pop-ups).

import { SHAPES, WIDTH, HEIGHT } from './data/basemap.js';
import { project } from './projection.js';
import { esc, safeHref, LEVEL_LABEL, fmtUtc } from './util.js';

// Lon/lat framing for region pages.
const REGION_VIEW = {
  'north-america': [-170, 14, -50, 76],
  'central-america': [-118, 6, -58, 33],
  'south-america': [-86, -56, -33, 13],
  'western-europe': [-26, 42, 36, 71],
  'southern-europe': [-12, 33, 32, 48],
  'eastern-europe': [18, 40, 180, 76],
  'middle-east': [25, 11, 64, 44],
  'north-africa': [-18, 8, 40, 38],
  'west-africa': [-18, 3, 17, 26],
  'east-africa': [21, -27, 52, 19],
  'central-southern-africa': [8, -35, 34, 24],
  'central-asia': [45, 34, 90, 56],
  'south-asia': [59, 4, 98, 39],
  'east-asia': [72, 17, 147, 55],
  'southeast-asia': [91, -12, 142, 29],
  oceania: [110, -48, 180, 1],
};

function viewBoxFor(regionId) {
  const b = REGION_VIEW[regionId];
  if (!b) return `0 0 ${WIDTH} ${HEIGHT}`;
  const [w, s, e, n] = b;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const lon = w + ((e - w) * i) / 8;
    const lat = s + ((n - s) * i) / 8;
    pts.push(project(lon, s), project(lon, n), project(w, lat), project(e, lat));
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.max(0, Math.min(...xs) - 8);
  const y0 = Math.max(0, Math.min(...ys) - 8);
  const x1 = Math.min(WIDTH, Math.max(...xs) + 8);
  const y1 = Math.min(HEIGHT, Math.max(...ys) + 8);
  return `${x0.toFixed(0)} ${y0.toFixed(0)} ${(x1 - x0).toFixed(0)} ${(y1 - y0).toFixed(0)}`;
}

const SHAPE_BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

export function renderMap(snapshot, { incidents = [], focusRegion = null, caption = '' } = {}) {
  const assigned = new Set();
  const regionPaths = snapshot.regions
    .map((r) => {
      let d = '';
      for (const iso of r.countries) {
        const shape = SHAPE_BY_ID.get(iso);
        if (shape) {
          d += shape.d;
          assigned.add(iso);
        }
      }
      if (!d) return '';
      const dim = focusRegion && focusRegion !== r.id ? ' dim' : '';
      const label = `${r.name}: ${LEVEL_LABEL[r.level]} threat (index ${r.index})`;
      return `<a href="/region/${esc(r.id)}/" class="rg lvl-${esc(r.level)}${dim}" aria-label="${esc(label)}"><title>${esc(label)}</title><path d="${d}"/></a>`;
    })
    .join('');
  const other = SHAPES.filter((s) => !assigned.has(s.id))
    .map((s) => s.d)
    .join('');

  const scale = focusRegion ? 0.55 : 1;
  const pins = incidents
    .filter((i) => i.location && Number.isFinite(i.location.lat) && Number.isFinite(i.location.lon))
    .sort((a, b) => a.severity - b.severity)
    .map((i) => {
      const [x, y] = project(i.location.lon, i.location.lat);
      const r = ((2.2 + i.severity * 0.9) * scale).toFixed(1);
      const place = [i.location.place, i.location.country].filter(Boolean).join(', ');
      const meta = `${snapshot.categories[i.category]} · ${place} · ${fmtUtc(i.time)}`;
      const shape =
        i.category === 'terrorism'
          ? `<rect x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${(r * 2).toFixed(1)}" height="${(r * 2).toFixed(1)}" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>`
          : `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`;
      return `<a href="#i-${esc(i.id)}" class="pin pin-${esc(i.category)} ev-${esc(i.evidence)}${i.location.precision === 'country' ? ' approx' : ''}" data-title="${esc(i.title)}" data-meta="${esc(meta)}" data-id="${esc(i.id)}" data-region="${esc(i.location.region || '')}" data-url="${esc(safeHref(i.url))}"><title>${esc(i.title)}</title>${shape}</a>`;
    })
    .join('');

  return `<figure class="map${focusRegion ? ' map-region' : ''}">
<svg viewBox="${viewBoxFor(focusRegion)}" role="img" aria-label="Map of regional threat levels and incident locations" preserveAspectRatio="xMidYMid meet">
<rect class="sea" x="0" y="0" width="${WIDTH}" height="${HEIGHT}"/>
<path class="land-other" d="${other}"/>
<g class="regions">${regionPaths}</g>
<g class="pins">${pins}</g>
</svg>
<div class="map-popup" hidden></div>
<figcaption>
<ul class="legend">
<li><span class="sw lvl-high"></span>High</li><li><span class="sw lvl-medium"></span>Medium</li><li><span class="sw lvl-low"></span>Low</li>
<li><span class="pin-key terror"></span>Suspected terrorism</li><li><span class="pin-key"></span>Other incident</li>
</ul>
${caption ? `<p>${caption}</p>` : ''}
</figcaption>
</figure>`;
}

export function sparkline(history, regionId) {
  const pts = history.map((h) => h.s[regionId] ?? 0);
  if (pts.length < 2) return '<p class="muted small">Trend line appears after a few hours of collection.</p>';
  const max = Math.max(1, ...pts);
  const w = 300;
  const h = 60;
  const step = w / (pts.length - 1);
  const coords = pts.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 6) - 3).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Threat score over the last ${Math.round((history[history.length - 1].t - history[0].t) / 3600000)} hours"><polyline points="${coords}"/></svg>`;
}
