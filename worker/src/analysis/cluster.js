// Groups reports that describe the same event (same country, compatible category,
// close in time, overlapping headline vocabulary) into a single incident.

import { hashId } from '../lib/text.js';

export const STOP = new Set(
  ('says said after amid over into with from that this have been were their about what more than will would could ' +
    'year years first last week weeks people news live latest update updates report reports reported officials ' +
    'official government minister president country countries world global least least killed kill kills dead ' +
    'attack attacks injured wounded near during against while where which there here them they other since').split(' '),
);

function stemToken(w) {
  let s = w.length > 6 ? w.slice(0, 6) : w;
  // claim/claims, strike/strikes: keep a singular form so outlets still match.
  if (s.length > 4 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

export function significantTokens(text) {
  const out = new Set();
  for (const w of String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/)) {
    if (w.length > 3 && !STOP.has(w)) out.add(stemToken(w));
  }
  return out;
}

const FAMILY = { terrorism: 'violence', attack: 'violence', conflict: 'violence' };
const family = (c) => FAMILY[c] || c;
const TYPE_RANK = { official: 3, publisher: 2, social: 1 };

export function similar(a, b) {
  if (Math.abs(a.time - b.time) > 36 * 3600000) return false;
  if (family(a.cls.category) !== family(b.cls.category)) return false;
  if (a.dedupeKey && b.dedupeKey) return a.dedupeKey === b.dedupeKey;
  if (a.type === 'official' || b.type === 'official') {
    const other = a.type === 'official' ? b : a;
    const official = a.type === 'official' ? a : b;
    return (
      other.type !== 'official' &&
      official.sourceId === 'usgs' &&
      /\b(?:earthquake|quake|tremor)\b/i.test(other.title) &&
      Math.abs(a.time - b.time) < 24 * 3600000
    );
  }
  let shared = 0;
  for (const t of a.tokens) if (b.tokens.has(t)) shared++;
  if (shared < 2) return false;
  const overlap = shared / Math.max(1, Math.min(a.tokens.size, b.tokens.size));
  // Same or missing country: slightly lower bar. Cross-border matches need a clearer overlap
  // so "Iran … Bahrain" can join "Bahrain … Iran" without merging unrelated regional stories.
  const samePlace = !a.loc?.iso3 || !b.loc?.iso3 || a.loc.iso3 === b.loc.iso3;
  return overlap >= (samePlace ? (a.loc && b.loc ? 0.42 : 0.5) : 0.55);
}

function hardMembers(members) {
  const hard = members.filter((m) => m.type !== 'social');
  return hard.length ? hard : members;
}

function clustersMatch(a, b) {
  const poolA = hardMembers(a.members);
  const poolB = hardMembers(b.members);
  return poolA.some((x) => poolB.some((y) => similar(x, y)));
}

/** Merge sibling clusters that the greedy country pass left apart (cross-border, social seeds). */
function consolidate(clusters) {
  const out = clusters.map((c) => ({ members: [...c.members] }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (!clustersMatch(out[i], out[j])) continue;
        out[i].members.push(...out[j].members);
        out.splice(j, 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return out;
}

export function clusterItems(items) {
  const buckets = new Map();
  const clusters = [];
  const sorted = [...items].sort((a, b) => a.time - b.time);
  for (const item of sorted) {
    item.tokens = significantTokens(item.title);
    const key = item.loc?.iso3 || 'none';
    const bucket = buckets.get(key) || [];
    let target = null;
    for (const c of bucket) {
      if (c.members.some((m) => similar(m, item))) {
        target = c;
        break;
      }
    }
    if (target) target.members.push(item);
    else {
      const c = { members: [item] };
      bucket.push(c);
      clusters.push(c);
    }
    buckets.set(key, bucket);
  }
  return consolidate(clusters).map(toIncident);
}

function toIncident({ members }) {
  const hard = members.filter((m) => m.type !== 'social');
  const pool = hard.length ? hard : members;
  const maxSev = Math.max(...pool.map((m) => m.cls.severity));
  const lead = [...pool].sort(
    (a, b) => TYPE_RANK[b.type] - TYPE_RANK[a.type] || b.cls.severity - a.cls.severity || b.time - a.time,
  )[0];

  const terrorVotes = pool.filter((m) => m.cls.category === 'terrorism').length;
  const category = terrorVotes > 0 && family(lead.cls.category) === 'violence' ? 'terrorism' : lead.cls.category;

  const sourceNames = new Set(hard.map((m) => m.sourceName));
  const evidence = members.some((m) => m.type === 'official') ? 'official' : sourceNames.size >= 2 ? 'multi' : hard.length ? 'publisher' : 'social';

  const byPrecision = (p) => members.find((m) => m.loc?.precision === p)?.loc;
  const loc = byPrecision('exact') || byPrecision('city') || lead.loc || members.find((m) => m.loc)?.loc || null;

  const seen = new Set();
  const sources = [];
  for (const m of [...members].sort((a, b) => TYPE_RANK[b.type] - TYPE_RANK[a.type] || a.time - b.time)) {
    if (seen.has(m.sourceName)) continue;
    seen.add(m.sourceName);
    sources.push({ name: m.sourceName, url: m.url, type: m.type, time: m.time, via: m.via });
  }

  const first = members.reduce((a, b) => (a.time <= b.time ? a : b));
  return {
    id: hashId(first.url + '|' + first.title),
    title: lead.title,
    summary: lead.summary || '',
    url: lead.url,
    category,
    severity: hard.length ? maxSev : Math.min(3, maxSev),
    evidence,
    casualties: {
      killed: Math.max(0, ...pool.map((m) => m.cls.casualties.killed)),
      injured: Math.max(0, ...pool.map((m) => m.cls.casualties.injured)),
    },
    retrospective: pool.every((m) => m.cls.retrospective),
    time: Math.max(...members.map((m) => m.time)),
    firstSeen: first.time,
    location: loc,
    sources: sources.slice(0, 12),
    sourceCount: sourceNames.size || 1,
    reportCount: members.length,
  };
}
