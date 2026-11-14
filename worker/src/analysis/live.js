// Major developing stories ("live" coverage). A story is live when at least minOutlets different
// publishers have reported it and the latest report is recent. Every publisher report on the
// story is collected as an update, including follow-ups the incident classifier ignores and
// reports the stricter incident clustering kept apart (the same event told from another country).
//
// Matching weights each word by how rare it is across everything gathered, so "FAA" counts for
// far more than "flights". A report must share at least three words with the story, two of them
// as a pair ("ground stop", "global outage"), which stops unrelated headlines that happen to
// reuse a stock phrase or a few common words.

import { STOP } from './cluster.js';
import { truncate, hashId } from '../lib/text.js';
import { COUNTRIES } from '../data/countries.js';
import { ALIASES, DEMONYMS, PLACES } from '../data/aliases.js';

export const LIVE = {
  maxStories: 3,
  candidates: 40,
  minOutlets: 3,
  minReports: 4,
  activeHours: 3,
  lookbackHours: 36,
  maxUpdates: 60,
  maxTerms: 14,
  maxPhrases: 24,
  // Shared terms must be worth this share of the story's three strongest terms.
  matchShare: 0.3,
  // Share of the rarer word's appearances in which the pair appears together.
  phraseCohesion: 0.4,
};

const ACRONYM_STOP = new Set(['THE', 'AND', 'FOR', 'BBC', 'CNN', 'NPR', 'LIVE', 'NEWS', 'WATCH', 'VIDEO', 'UPDATE', 'BREAKING', 'OF', 'IN', 'ON', 'TO', 'AT', 'BY', 'AS', 'IS', 'IT', 'A', 'I']);
const PAIR_WINDOW = 2;

/** Headline words in order: acronyms (FAA, US, NATO) and significant words stemmed to 6 letters. */
export function orderedTokens(text) {
  const words = String(text || '')
    .replace(/\bU\.S\.A?\.?|\bUnited States(?: of America)?\b/gi, 'US')
    .replace(/\bU\.K\.?|\bUnited Kingdom\b/gi, 'UK')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/);
  const out = [];
  for (const w of words) {
    if (/^[A-Z][A-Z0-9]{1,5}$/.test(w)) {
      if (!ACRONYM_STOP.has(w)) out.push(w.toLowerCase());
      continue;
    }
    const l = w.toLowerCase();
    if (l.length > 3 && !STOP.has(l)) out.push(l.length > 6 ? l.slice(0, 6) : l);
  }
  return out;
}

// Countries, nationalities, cities, seats of government and the most-reported leaders. A pair made
// only of these ("Russia ... Ukraine", "White House", "Trump ... Putin") is background to a lot of
// unrelated news, so it never counts as a phrase.
const BACKGROUND_TERMS = new Set(['us', 'uk', 'un', 'eu', 'nato']);
for (const name of [
  ...COUNTRIES.flatMap((c) => [c.name, ...c.names]),
  ...[...ALIASES, ...DEMONYMS, ...PLACES].map(([p]) => p),
  'White House', 'Kremlin', 'Downing Street', 'Pentagon', 'Capitol', 'Congress', 'Senate', 'Parliament',
  'Trump', 'Putin', 'Zelenskiy', 'Zelensky', 'Netanyahu', 'Starmer', 'Macron', 'Modi', 'Erdogan',
]) {
  for (const t of orderedTokens(name)) BACKGROUND_TERMS.add(t);
}

/** Unique terms and nearby word pairs ("ground~stop") of a headline. */
export function topicFeatures(text) {
  const seq = orderedTokens(text);
  const terms = new Set(seq);
  const pairs = new Set();
  for (let i = 0; i < seq.length; i++) {
    for (let j = i + 1; j <= i + PAIR_WINDOW && j < seq.length; j++) {
      if (seq[i] === seq[j] || (BACKGROUND_TERMS.has(seq[i]) && BACKGROUND_TERMS.has(seq[j]))) continue;
      pairs.add(seq[i] < seq[j] ? `${seq[i]}~${seq[j]}` : `${seq[j]}~${seq[i]}`);
    }
  }
  return { terms, pairs };
}

/**
 * Does a headline's features match a topic ({terms: {term: weight}, phrases: [...], core: [...],
 * minScore})? Two shared words are enough only when they are one of the story's core phrases,
 * the ones its coverage keeps repeating ("ground stop"); otherwise a stock phrase in the lead
 * headline ("demand answers", "raises questions") would pull in unrelated reports.
 */
export function topicMatches(features, topic) {
  let shared = 0;
  let score = 0;
  for (const t of features.terms) {
    if (topic.terms[t] === undefined) continue;
    shared++;
    score += topic.terms[t];
  }
  if (shared < 2 || score < topic.minScore) return false;
  if (shared === 2) return (topic.core || []).some((p) => features.pairs.has(p));
  return topic.phrases.some((p) => features.pairs.has(p));
}

function buildTopic(seed, weightOf, isPhrase, extraTerms = [], extraPairs = []) {
  const terms = [...new Set([...seed.terms, ...extraTerms])]
    .map((t) => [t, weightOf(t)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIVE.maxTerms);
  const kept = new Set(terms.map(([t]) => t));
  const phrases = [...new Set([...seed.pairs, ...extraPairs])]
    .filter((p) => isPhrase(p) && p.split('~').every((t) => kept.has(t)))
    .slice(0, LIVE.maxPhrases);
  const strongest = terms.slice(0, 3).reduce((n, [, w]) => n + w, 0);
  return {
    terms: Object.fromEntries(terms.map(([t, w]) => [t, Math.round(w * 100) / 100])),
    phrases,
    core: phrases.filter((p) => extraPairs.includes(p)),
    minScore: Math.round(strongest * LIVE.matchShare * 100) / 100,
  };
}

/**
 * @param incidents  scored incidents, most important first
 * @param reports    every publisher report gathered this run ({title, summary, url, sourceName, via, time})
 */
export function findLiveStories(incidents, reports, now) {
  const lookback = LIVE.lookbackHours * 3600000;
  const pool = reports
    .filter((r) => r.title && now - r.time <= lookback)
    .map((r) => ({ ...r, features: topicFeatures(r.title) }));
  if (!pool.length) return [];

  const df = new Map();
  const pairDf = new Map();
  for (const r of pool) {
    for (const t of r.features.terms) df.set(t, (df.get(t) || 0) + 1);
    for (const p of r.features.pairs) pairDf.set(p, (pairDf.get(p) || 0) + 1);
  }
  const weightOf = (t) => Math.log((pool.length + 1) / ((df.get(t) || 0) + 1));
  // A pair is a phrase when its words mostly appear together: "ground stop" does, while
  // "Russia ... Ukraine" turns up in all sorts of unrelated stories.
  const isPhrase = (p) => {
    const n = pairDf.get(p) || 0;
    const [a, b] = p.split('~');
    return n >= 2 && n >= LIVE.phraseCohesion * Math.min(df.get(a) || 0, df.get(b) || 0);
  };

  const candidates = incidents
    .filter((i) => i.evidence !== 'social' && !i.retrospective && i.severity >= 2 && now - i.time <= lookback)
    .slice(0, LIVE.candidates);

  const stories = [];
  for (const inc of candidates) {
    const seed = topicFeatures(inc.title);
    if (seed.terms.size < 2) continue;
    let topic = buildTopic(seed, weightOf, isPhrase);
    let matched = pool.filter((r) => topicMatches(r.features, topic));
    if (matched.length < 2) continue;

    // One round of expansion: terms and pairs that most matched reports share join the topic, so
    // later headlines that word the story differently are still picked up.
    const need = Math.max(2, Math.ceil(matched.length * 0.4));
    const count = (key) => {
      const m = new Map();
      for (const r of matched) for (const x of r.features[key]) m.set(x, (m.get(x) || 0) + 1);
      return [...m].filter(([, c]) => c >= need).map(([x]) => x);
    };
    topic = buildTopic(seed, weightOf, isPhrase, count('terms'), count('pairs'));
    matched = pool.filter((r) => topicMatches(r.features, topic));
    if (!matched.length) continue;

    // Candidates that pick up any of the same reports are the same story told differently
    // ("Microsoft outage" and "Microsoft restores services"): merge them.
    const urls = new Set(matched.map((r) => r.url));
    const existing = stories.find((s) => [...s.reports.keys()].some((u) => urls.has(u)));
    if (existing) {
      for (const r of matched) existing.reports.set(r.url, r);
      existing.topics.push(topic);
    } else {
      stories.push({ inc, topics: [topic], reports: new Map(matched.map((r) => [r.url, r])) });
    }
  }

  return stories
    .map(({ inc, topics, reports: byUrl }) => {
      const all = [...byUrl.values()].sort((a, b) => b.time - a.time);
      const outlets = [...new Set(all.map((r) => r.sourceName))];
      return {
        // Keyed on the earliest report, so the page address survives a change of lead headline.
        id: hashId(all[all.length - 1].url),
        title: inc.title,
        summary: inc.summary,
        category: inc.category,
        severity: inc.severity,
        location: inc.location,
        startedAt: all[all.length - 1].time,
        updatedAt: all[0].time,
        outlets,
        reportCount: all.length,
        topics: topics.slice(0, 4),
        updates: all.slice(0, LIVE.maxUpdates).map((r) => ({
          title: r.title,
          summary: truncate(r.summary || '', 300),
          url: r.url,
          source: r.sourceName,
          via: r.via || undefined,
          time: r.time,
        })),
      };
    })
    .filter(
      (s) =>
        s.outlets.length >= LIVE.minOutlets &&
        s.reportCount >= LIVE.minReports &&
        now - s.updatedAt <= LIVE.activeHours * 3600000,
    )
    .sort((a, b) => b.outlets.length - a.outlets.length || b.updatedAt - a.updatedAt)
    .slice(0, LIVE.maxStories);
}
