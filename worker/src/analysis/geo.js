// Gazetteer-based locator. Text is tokenised once and scanned with a longest-phrase-first
// lookup, so cost is linear in the number of words (important for Workers CPU limits).

import { COUNTRIES } from '../data/countries.js';
import { ALIASES, DEMONYMS, PLACES, WEAK_ALIASES } from '../data/aliases.js';
import { normaliseForMatch } from '../lib/text.js';

export const COUNTRY_BY_ISO = new Map(COUNTRIES.map((c) => [c.iso3, c]));

const PHRASES = new Map();
let MAX_TOKENS = 1;

function register(phrase, entry) {
  const key = normaliseForMatch(phrase);
  if (!key) return;
  MAX_TOKENS = Math.max(MAX_TOKENS, key.split(' ').length);
  PHRASES.set(key, entry);
}

for (const c of COUNTRIES) {
  for (const name of c.names) register(name, { iso3: c.iso3, precision: 'country' });
}
for (const [phrase, iso3] of DEMONYMS) {
  if (COUNTRY_BY_ISO.has(iso3)) register(phrase, { iso3, precision: 'country', factor: 0.5 });
}
for (const [phrase, iso3, lat, lon] of [...ALIASES, ...PLACES]) {
  if (iso3 && !COUNTRY_BY_ISO.has(iso3)) continue;
  register(phrase, {
    iso3,
    lat,
    lon,
    precision: Number.isFinite(lat) ? 'city' : 'country',
    factor: WEAK_ALIASES.has(phrase) ? 0.35 : 1,
    label: Number.isFinite(lat) ? phrase.replace(/\b\w/g, (ch) => ch.toUpperCase()) : null,
  });
}

function scan(text, weight, scores, offset, leadBonus = 0) {
  const tokens = normaliseForMatch(text).split(' ');
  let bonus = leadBonus;
  for (let i = 0; i < tokens.length; i++) {
    for (let n = Math.min(MAX_TOKENS, tokens.length - i); n >= 1; n--) {
      const hit = PHRASES.get(n === 1 ? tokens[i] : tokens.slice(i, i + n).join(' '));
      if (hit === undefined) continue;
      if (hit.iso3) {
        const s = scores.get(hit.iso3) || { score: 0, first: Infinity, city: null, cityScore: 0 };
        const w = weight * (hit.factor ?? 1);
        s.score += w;
        if (bonus && (hit.factor ?? 1) === 1) {
          s.score += bonus;
          bonus = 0;
        }
        s.first = Math.min(s.first, offset + i);
        if (hit.precision === 'city' && w > s.cityScore) {
          s.city = hit;
          s.cityScore = w;
        }
        scores.set(hit.iso3, s);
      }
      i += n - 1;
      break;
    }
  }
}

/** Events that affect many countries at once (cloud outages, etc.), not a single nation. */
const GLOBAL_SCOPE =
  /\b(?:worldwide|world[\s-]?wide|globally|(?:across|around) the (?:globe|world)|global (?:outage|outages|it\b|cloud|internet|service|services|disruption|disruptions|blackout|blackouts|failure|failures|shutdown|shutdowns))\b/i;

export const GLOBAL_LOCATION = {
  iso3: null,
  country: 'Global',
  region: null,
  precision: 'global',
};

export function isGlobalScope(title, summary = '') {
  return GLOBAL_SCOPE.test(String(title || '')) || GLOBAL_SCOPE.test(String(summary || ''));
}

/**
 * Resolve the most likely country (and city if named) for a report.
 * Worldwide/global-scope events return precision 'global' (country label "Global", no iso3).
 * @returns {null | {iso3:string|null, country:string, region:string|null, lat?:number, lon?:number, precision:'city'|'country'|'global', place?:string}}
 */
export function locate(title, summary = '', placeHint = '') {
  // Prefer Global over a HQ-country pin when the report itself says worldwide / global outage.
  if (isGlobalScope(title, summary)) return { ...GLOBAL_LOCATION };

  const scores = new Map();
  if (placeHint) scan(placeHint, 4, scores, 0);
  scan(title, 3, scores, 1000, 1);
  scan(summary, 1, scores, 100000);
  let best = null;
  for (const [iso3, s] of scores) {
    if (!best || s.score > best.s.score || (s.score === best.s.score && s.first < best.s.first)) best = { iso3, s };
  }
  if (!best || best.s.score < 0.9) return null;
  const c = COUNTRY_BY_ISO.get(best.iso3);
  const city = best.s.city;
  return {
    iso3: c.iso3,
    country: c.name,
    region: c.region,
    lat: city ? city.lat : c.lat,
    lon: city ? city.lon : c.lon,
    precision: city ? 'city' : 'country',
    place: city ? city.label : undefined,
  };
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

// For records with exact coordinates (USGS, GDACS) that name no country (e.g. offshore).
export function nearestCountry(lat, lon, maxKm = 1500) {
  let best = null;
  for (const c of COUNTRIES) {
    const d = distanceKm(lat, lon, c.lat, c.lon);
    if (!best || d < best.d) best = { c, d };
  }
  return best && best.d <= maxKm ? best.c : null;
}
