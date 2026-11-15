#!/usr/bin/env node
// One-off generator: converts public-domain Natural Earth country data into
//   worker/src/data/countries.js   (gazetteer: names, label points, region)
//   publisher/src/data/basemap.js  (projected, simplified SVG country paths)
// Re-run only when regions or map detail change: `node tools/build-geodata.mjs`

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regionForSubregion } from '../worker/src/data/regions.js';
import { project, MAP_WIDTH, MAP_HEIGHT, SOUTH_LIMIT } from '../publisher/src/projection.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(root, 'tools', '.cache');
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

const CODE_FIXES = { SOL: 'SOM', CYN: 'CYP', KOS: 'XKX', PSX: 'PSE', SAH: 'ESH', SDS: 'SSD' };
const SKIP = new Set(['ATA', 'IOA', 'ATC', 'KAS', 'ATF', 'HMD', 'SGS', 'BVT']);
const MERGED_INTO_OTHERS = new Set(['SOL', 'CYN']);
const DISPLAY_NAMES = { USA: 'United States', COD: 'DR Congo', COG: 'Republic of the Congo', PSE: 'Palestine', CZE: 'Czechia' };

async function load(name) {
  await mkdir(cacheDir, { recursive: true });
  const file = join(cacheDir, name);
  if (!existsSync(file)) {
    console.log(`Downloading ${name}…`);
    const res = await fetch(NE + name);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${name}`);
    await writeFile(file, await res.text());
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

function codeOf(p) {
  const adm = p.ADM0_A3;
  if (CODE_FIXES[adm]) return CODE_FIXES[adm];
  if (p.ISO_A3 && p.ISO_A3 !== '-99') return p.ISO_A3;
  if (p.ISO_A3_EH && p.ISO_A3_EH !== '-99') return p.ISO_A3_EH;
  return adm;
}

const normalise = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function buildCountries(geo) {
  const out = [];
  for (const f of geo.features) {
    const p = f.properties;
    if (SKIP.has(p.ADM0_A3) || MERGED_INTO_OTHERS.has(p.ADM0_A3)) continue;
    const iso3 = codeOf(p);
    const region = regionForSubregion(iso3, p.SUBREGION);
    if (!region) continue;
    const names = new Set();
    for (const n of [p.NAME, p.NAME_LONG, p.ADMIN, p.NAME_EN, p.BRK_NAME, p.GEOUNIT, p.SUBUNIT, p.NAME_SORT]) {
      const v = normalise(n);
      if (v.length >= 3 && !/\b(?:is|rep|dem|st|fr|br|s)\b/.test(v)) names.add(v);
    }
    out.push({
      iso3,
      name: DISPLAY_NAMES[iso3] || p.NAME_EN || p.NAME,
      region,
      lat: +Number(p.LABEL_Y).toFixed(2),
      lon: +Number(p.LABEL_X).toFixed(2),
      names: [...names],
    });
  }
  return out.sort((a, b) => a.iso3.localeCompare(b.iso3));
}

// Ramer–Douglas–Peucker on projected points.
function simplify(points, tolerance) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > t2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(points) {
  let s = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    s += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(s / 2);
}

function ringToPath(ring) {
  let prev = null;
  let d = '';
  for (const [x, y] of ring) {
    const rx = Math.round(x * 2) / 2;
    const ry = Math.round(y * 2) / 2;
    if (!prev) d += `M${rx} ${ry}`;
    else {
      const dx = +(rx - prev[0]).toFixed(1);
      const dy = +(ry - prev[1]).toFixed(1);
      if (dx === 0 && dy === 0) continue;
      d += `l${dx} ${dy}`.replace(/ -/g, '-');
    }
    prev = [rx, ry];
  }
  return d + 'z';
}

function buildBasemap(geo) {
  const shapes = new Map();
  for (const f of geo.features) {
    const p = f.properties;
    if (SKIP.has(p.ADM0_A3)) continue;
    const iso3 = codeOf(p);
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    const rings = [];
    for (const poly of polys) {
      for (const ring of poly) {
        if (ring.every(([, lat]) => lat < SOUTH_LIMIT)) continue;
        const projected = simplify(ring.map(([lon, lat]) => project(lon, lat)), 0.45);
        if (projected.length < 4 || ringArea(projected) < 1.2) continue;
        rings.push(projected);
      }
    }
    if (!rings.length) continue;
    const entry = shapes.get(iso3) || { id: iso3, d: '', b: [Infinity, Infinity, -Infinity, -Infinity] };
    for (const r of rings) {
      entry.d += ringToPath(r);
      for (const [x, y] of r) {
        entry.b[0] = Math.min(entry.b[0], x);
        entry.b[1] = Math.min(entry.b[1], y);
        entry.b[2] = Math.max(entry.b[2], x);
        entry.b[3] = Math.max(entry.b[3], y);
      }
    }
    shapes.set(iso3, entry);
  }
  return [...shapes.values()].map((s) => ({ ...s, b: s.b.map((v) => Math.round(v)) }));
}

const header = '// GENERATED by tools/build-geodata.mjs from Natural Earth (public domain). Do not edit by hand.\n';

const geo50 = await load('ne_50m_admin_0_countries.geojson');
const geo110 = await load('ne_110m_admin_0_countries.geojson');

const countries = buildCountries(geo50);
await writeFile(
  join(root, 'worker/src/data/countries.js'),
  header + 'export const COUNTRIES = [\n' + countries.map((c) => '  ' + JSON.stringify(c)).join(',\n') + '\n];\n',
);

const basemap = buildBasemap(geo110);
await mkdir(join(root, 'publisher/src/data'), { recursive: true });
await writeFile(
  join(root, 'publisher/src/data/basemap.js'),
  header +
    `export const WIDTH = ${MAP_WIDTH};\nexport const HEIGHT = ${MAP_HEIGHT};\n` +
    'export const SHAPES = [\n' + basemap.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n];\n',
);

const bytes = basemap.reduce((n, s) => n + s.d.length, 0);
console.log(`countries.js: ${countries.length} countries · basemap.js: ${basemap.length} shapes, ${(bytes / 1024).toFixed(0)} KB of path data`);
