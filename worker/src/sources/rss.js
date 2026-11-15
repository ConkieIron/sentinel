// Minimal RSS 2.0 / RDF / Atom parser. Workers have no DOMParser, and feeds are small,
// so a tolerant regex extractor is faster and dependency-free.

import { fetchWithTimeout } from '../lib/http.js';
import { stripHtml, safeUrl, parseTime, truncate, decodeEntities } from '../lib/text.js';

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function attr(block, name, attribute) {
  const re = new RegExp(`<${name}\\b[^>]*\\b${attribute}=["']([^"']+)["'][^>]*>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function atomLink(block) {
  const links = block.match(/<link\b[^>]*>/gi) || [];
  for (const l of links) {
    if (/rel=["'](?!alternate)/i.test(l)) continue;
    const href = l.match(/href=["']([^"']+)["']/i);
    if (href) return href[1];
  }
  return '';
}

/**
 * The item's picture from media:content, media:thumbnail or an image enclosure: the widest one,
 * https only. BBC thumbnails are 240px wide, so the larger rendition of the same image is used.
 */
export function feedImage(block) {
  let best = null;
  for (const el of block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/gi) || []) {
    const get = (a) => el.match(new RegExp(`\\b${a}=["']([^"']*)["']`, 'i'))?.[1] || '';
    const type = get('type');
    const medium = get('medium');
    if ((type && !/^image\//i.test(type)) || (medium && medium !== 'image')) continue;
    let url = safeUrl(decodeEntities(get('url')));
    if (!url || !url.startsWith('https://')) continue;
    if (!type && !medium && !/^<media:thumbnail/i.test(el) && !/\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(url) && !/[?&]format=|auto=format/i.test(url)) continue;
    let width = Number(get('width')) || 0;
    if (/^https:\/\/ichef\.bbci\.co\.uk\/ace\/standard\/\d+\//.test(url)) {
      url = url.replace(/\/ace\/standard\/\d+\//, '/ace/standard/976/');
      width = 976;
    }
    if (!best || width > best.width) best = { url, width };
  }
  return best;
}

export function parseFeed(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const rawLink = stripHtml(tag(b, 'link')) || atomLink(b) || stripHtml(tag(b, 'guid'));
    const point = stripHtml(tag(b, 'georss:point')).split(/\s+/).map(Number);
    const lat = Number(stripHtml(tag(b, 'geo:lat'))) || (point.length === 2 ? point[0] : NaN);
    const lon = Number(stripHtml(tag(b, 'geo:long'))) || (point.length === 2 ? point[1] : NaN);
    return {
      title: stripHtml(tag(b, 'title')),
      url: safeUrl(rawLink),
      summary: truncate(stripHtml(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')), 400),
      time: parseTime(stripHtml(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))),
      coords: Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? [lat, lon] : null,
      image: feedImage(b),
      extra: {
        alertLevel: stripHtml(tag(b, 'gdacs:alertlevel')),
        eventType: stripHtml(tag(b, 'gdacs:eventtype')),
        country: stripHtml(tag(b, 'gdacs:country')),
        isCurrent: stripHtml(tag(b, 'gdacs:iscurrent')),
      },
    };
  });
}

/** Google News (and some aggregators) append " - Outlet Name" to titles; strip for clustering. */
function cleanFeedTitle(title, feedName) {
  let t = String(title || '').trim();
  if (!feedName) return t;
  const escaped = feedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  t = t.replace(new RegExp(`\\s*[-–—|]\\s*${escaped}\\s*$`, 'i'), '').trim();
  return t || String(title || '').trim();
}

export async function fetchRss(feed, { now, windowMs, maxItems }) {
  const res = await fetchWithTimeout(feed.url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' } });
  const xml = await res.text();
  const parsed = parseFeed(xml);
  const items = [];
  let newest = 0;
  for (const p of parsed) {
    if (!p.title || !p.url) continue;
    const time = p.time && p.time <= now + 3600000 ? Math.min(p.time, now) : null;
    if (time) newest = Math.max(newest, time);
    if (!time || now - time > windowMs) continue;
    items.push({
      sourceId: feed.id,
      sourceName: feed.name,
      type: 'publisher',
      title: cleanFeedTitle(p.title, feed.name),
      summary: p.summary,
      url: p.url,
      time,
      image: p.image || undefined,
    });
    if (items.length >= maxItems) break;
  }
  return { items, parsed: parsed.length, newest: newest || null };
}

// GDACS: official UN/EC multi-hazard alerts. Only current Orange/Red alerts are kept;
// earthquakes are skipped because USGS is the primary seismic source.
const GDACS_TYPES = { TC: 'Tropical cyclone', FL: 'Flood', VO: 'Volcanic eruption', DR: 'Drought', WF: 'Wildfire', TS: 'Tsunami' };

export async function fetchGdacs(url, { now, windowMs }) {
  const res = await fetchWithTimeout(url);
  const parsed = parseFeed(await res.text());
  const items = [];
  let newest = 0;
  for (const p of parsed) {
    const level = p.extra.alertLevel.toLowerCase();
    if (p.time) newest = Math.max(newest, p.time);
    if (!GDACS_TYPES[p.extra.eventType] || !['orange', 'red'].includes(level)) continue;
    if (p.extra.isCurrent && p.extra.isCurrent.toLowerCase() === 'false') continue;
    if (!p.time || now - p.time > windowMs || !p.url) continue;
    items.push({
      sourceId: 'gdacs',
      sourceName: 'GDACS (UN/EC)',
      type: 'official',
      title: p.title,
      summary: p.summary,
      url: p.url,
      time: Math.min(p.time, now),
      coords: p.coords,
      placeHint: p.extra.country,
      forced: { category: 'disaster', severity: level === 'red' ? 5 : 4 },
    });
  }
  return { items, parsed: parsed.length, newest: newest || null };
}
