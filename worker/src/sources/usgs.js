import { fetchWithTimeout } from '../lib/http.js';
import { safeUrl } from '../lib/text.js';

function quakeSeverity(mag, alert, tsunami) {
  let s = mag >= 7.5 ? 5 : mag >= 7 ? 4 : mag >= 6.3 ? 3 : mag >= 5.5 ? 2 : 1;
  if (alert === 'yellow') s = Math.max(s, 3);
  if (alert === 'orange') s = Math.max(s, 4);
  if (alert === 'red') s = 5;
  if (tsunami) s = Math.min(5, s + 1);
  return s;
}

// Official USGS records. Only M5.0+ or PAGER-alerted events are kept so remote
// minor quakes do not flood the incident list.
export async function fetchUsgs(url, { now, windowMs }) {
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/geo+json, application/json' } });
  const data = await res.json();
  const features = Array.isArray(data.features) ? data.features : [];
  const items = [];
  let newest = 0;
  for (const f of features) {
    const p = f.properties || {};
    const mag = Number(p.mag) || 0;
    const time = Number(p.time) || 0;
    newest = Math.max(newest, time);
    if (!time || now - time > windowMs) continue;
    if (mag < 5 && !p.alert) continue;
    const [lon, lat] = f.geometry?.coordinates || [];
    items.push({
      sourceId: 'usgs',
      sourceName: 'USGS',
      type: 'official',
      title: `M${mag.toFixed(1)} earthquake — ${p.place || 'location unknown'}`,
      summary: [p.alert ? `USGS PAGER alert: ${p.alert}.` : '', p.tsunami ? 'Tsunami flag raised by USGS.' : '', p.felt ? `Felt reports: ${p.felt}.` : '']
        .filter(Boolean)
        .join(' '),
      url: safeUrl(p.url) || 'https://earthquake.usgs.gov/earthquakes/map/',
      time: Math.min(time, now),
      coords: Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null,
      placeHint: p.place || '',
      forced: { category: 'disaster', severity: quakeSeverity(mag, p.alert, p.tsunami) },
      dedupeKey: 'usgs:' + f.id,
    });
  }
  return { items, parsed: features.length, newest: newest || null };
}
