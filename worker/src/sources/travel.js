// Official travel advice: the UK FCDO index (GOV.UK content API) and the US State Department's
// advisory feed. Two requests cover every country; advice changes slowly, so callers cache it.

import { fetchWithTimeout } from '../lib/http.js';
import { decodeEntities, normaliseForMatch, parseTime } from '../lib/text.js';
import { COUNTRY_BY_ISO, locate } from '../analysis/geo.js';
import { COUNTRIES } from '../data/countries.js';

const FCDO_INDEX = 'https://www.gov.uk/api/content/foreign-travel-advice';
const US_FEED = 'https://travel.state.gov/_res/rss/TAsTWs.xml';
export const TRAVEL_REFRESH_MS = 6 * 3600000;

const nameKey = (s) => normaliseForMatch(s).replace(/^st /, 'saint ').replace(/ st /g, ' saint ');
const EXACT = new Map();
for (const c of COUNTRIES) for (const n of [c.name, ...c.names]) if (!EXACT.has(nameKey(n))) EXACT.set(nameKey(n), c.iso3);

// Exact names first, so "Congo" can't claim DR Congo before its own page is seen; the gazetteer
// only places names it otherwise wouldn't know.
const countryFor = (name, taken) => {
  const exact = EXACT.get(nameKey(name));
  if (exact) return exact;
  const guess = locate(name)?.iso3;
  return guess && !taken[guess] ? guess : null;
};

/** @returns {Record<string, {url:string, updated:number|null, change:string|null}>} keyed by ISO3 */
export function parseFcdo(data) {
  const out = {};
  const entries = (data?.links?.children || []).filter((c) => c.details?.country?.name && c.base_path);
  const exactFirst = [...entries.filter((c) => EXACT.has(nameKey(c.details.country.name))), ...entries.filter((c) => !EXACT.has(nameKey(c.details.country.name)))];
  for (const c of exactFirst) {
    const iso3 = countryFor(c.details.country.name, out);
    // The FCDO has no advice for the UK itself; its "British" territories would land there.
    if (!iso3 || iso3 === 'GBR' || out[iso3]) continue;
    out[iso3] = {
      url: `https://www.gov.uk${c.base_path}`,
      updated: parseTime(c.public_updated_at),
      change: c.details?.change_description || null,
    };
  }
  return out;
}

/** @returns {Record<string, {level:number, label:string, url:string, updated:number|null}>} keyed by ISO3 */
export function parseUsAdvisories(xml) {
  const out = {};
  for (const [, item] of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const title = decodeEntities(item.match(/<title>([^<]*)<\/title>/)?.[1] || '').trim();
    const url = item.match(/<link>([^<]*)<\/link>/)?.[1]?.trim();
    const m = title.match(/^(.+?)\s+-\s+Level\s+([1-4]):\s*(.+)$/);
    if (!m || !url?.startsWith('https://')) continue;
    const code = url.match(/destination\.([a-z]{3})\.html/)?.[1]?.toUpperCase();
    const iso3 = code && COUNTRY_BY_ISO.has(code) ? code : countryFor(m[1], out);
    if (!iso3 || out[iso3]) continue;
    out[iso3] = { level: Number(m[2]), label: m[3].trim(), url, updated: parseTime(item.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1]) };
  }
  return out;
}

/**
 * Re-fetches when the cached copy is older than TRAVEL_REFRESH_MS; if a source fails, its previous
 * advice is kept so the region pages never lose their links to a temporary outage.
 */
export async function refreshTravelAdvice(cached, now) {
  if (cached?.fetchedAt && now - cached.fetchedAt < TRAVEL_REFRESH_MS) return cached;
  const [fcdo, us] = await Promise.all([
    fetchWithTimeout(FCDO_INDEX, { timeoutMs: 10000, headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then(parseFcdo)
      .catch(() => null),
    fetchWithTimeout(US_FEED, { timeoutMs: 10000, headers: { Accept: 'application/rss+xml, application/xml' } })
      .then((r) => r.text())
      .then(parseUsAdvisories)
      .catch(() => null),
  ]);
  const ok = (m) => m && Object.keys(m).length > 20;
  return {
    // A partial failure retries in half an hour rather than waiting for the next full refresh.
    fetchedAt: ok(fcdo) && ok(us) ? now : now - TRAVEL_REFRESH_MS + 30 * 60000,
    fcdo: ok(fcdo) ? fcdo : cached?.fcdo || {},
    us: ok(us) ? us : cached?.us || {},
  };
}

/** The advice the site needs: countries in this edition's news, plus every US "Do not travel" country. */
export function travelForSnapshot(advice, incidents) {
  const wanted = new Set(incidents.map((i) => i.location?.iso3).filter(Boolean));
  for (const [iso3, a] of Object.entries(advice?.us || {})) if (a.level === 4) wanted.add(iso3);
  const out = {};
  for (const iso3 of wanted) {
    const fcdo = advice?.fcdo?.[iso3];
    const us = advice?.us?.[iso3];
    const c = COUNTRY_BY_ISO.get(iso3);
    if (c && (fcdo || us)) out[iso3] = { name: c.name, region: c.region, ...(fcdo && { fcdo }), ...(us && { us }) };
  }
  return out;
}
