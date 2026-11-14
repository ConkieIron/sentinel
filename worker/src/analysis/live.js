// Major developing stories ("live" coverage). A story is live when at least minOutlets different
// publishers have reported it and the latest report is recent. Every publisher report on the
// story is collected as an update, including follow-ups the incident classifier ignores and
// reports the stricter incident clustering kept apart (the same event told from another country).
//
// Matching weights each word by how rare it is across everything gathered, so "FAA" counts for
// far more than "flights". A report must share at least three words with the story, two of them
// as a pair ("ground stop", "global outage"), which stops unrelated headlines that happen to
// reuse a stock phrase or a few common words. Two shared words are enough only for one of the
// story's core phrases, and only close in time to a stronger match: "drone ... response" in a
// feature published a day later is not news about the airbase drones.

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
  // A story is still developing only while this many outlets have reported it in activeHours;
  // once it is matureHours old it needs matureOutlets, so late re-reports of a story that has
  // ended ("services restored") don't keep it live.
  activeOutlets: 2,
  matureHours: 12,
  matureOutlets: 3,
  // A two-word match must fall this close to a stronger match on the same story.
  weakMatchHours: 4,
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
  return matchStrength(features, topic) > 0;
}

/** 2: three or more shared words including a phrase; 1: two words forming a core phrase; 0: no match. */
export function matchStrength(features, topic) {
  let shared = 0;
  let score = 0;
  for (const t of features.terms) {
    if (topic.terms[t] === undefined) continue;
    shared++;
    score += topic.terms[t];
  }
  if (shared < 2 || score < topic.minScore) return 0;
  if (shared === 2) return (topic.core || []).some((p) => features.pairs.has(p)) ? 1 : 0;
  return topic.phrases.some((p) => features.pairs.has(p)) ? 2 : 0;
}

/** Reports on a topic; two-word matches count only near a strong one. */
function matchReports(pool, topic) {
  const hits = [];
  const strong = [];
  for (const r of pool) {
    const s = matchStrength(r.features, topic);
    if (!s) continue;
    hits.push([r, s]);
    if (s === 2) strong.push(r.time);
  }
  const near = LIVE.weakMatchHours * 3600000;
  return hits.filter(([r, s]) => s === 2 || strong.some((t) => Math.abs(t - r.time) <= near)).map(([r]) => r);
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

const HEADLINE_OUTLETS = new Set([
  'BBC News', 'Reuters', 'Associated Press', 'AFP', 'Sky News', 'The Guardian', 'CNN', 'Al Jazeera', 'NBC News',
  'CBS News', 'ABC News (US)', 'The New York Times', 'The Washington Post', 'The Independent', 'France 24',
  'Deutsche Welle', 'Euronews', 'NPR', 'Bloomberg', 'USA Today', 'Politico',
]);
const NOT_HEADLINE_START =
  /^(?:why|how|what|who|when|where|which|is|are|was|were|can|could|should|would|will|does|do|did|inside|analysis|opinion|comment|explainer|explained|watch|listen|video|live|in pictures|timeline|the latest|here'?s|here is|everything|a look|[0-9]+ things|follow)\b/i;
const NOT_HEADLINE =
  /\?|\bupdates?:|\b(?:what we know|what to know|what you need|live updates?|live blog|explained|in pictures|key takeaways|timeline|podcast|newsletter|opinion|analysis|explainer|as it happened|the latest|raises questions|demands? answers|follow (?:our|live)|(?:video|footage|photos?|images?) (?:shows?|captures?)|captures? (?:the )?(?:\w+ )?moments?|moment (?:a|an|the)|in their own words)\b/i;

/** A straight news headline: a statement of what happened, not an explainer, question or blog. */
export function isStraightHeadline(title) {
  const t = (title || '').trim();
  // "A building fell in seconds. Grief reached around the world": two sentences mark a feature
  // or a social post, while "U.S." and "D.C." don't trip this.
  return t.length >= 25 && t.length <= 120 && !NOT_HEADLINE_START.test(t) && !NOT_HEADLINE.test(t) && !/[a-z]{2}\.\s+[A-Z]/.test(t);
}

/**
 * The newest straight headline from a major outlet in the last couple of hours, else from anyone,
 * so the story title follows events ("flights resume") rather than an early or analytical take.
 */
function leadHeadline(all, fallback) {
  const recent = all.filter((r) => all[0].time - r.time <= 2 * 3600000 && isStraightHeadline(r.title));
  return recent.find((r) => HEADLINE_OUTLETS.has(r.sourceName)) || recent[0] || (isStraightHeadline(fallback.title) ? fallback : null) || all.find((r) => isStraightHeadline(r.title)) || fallback;
}

// Bluesky link cards often describe a different article from the post, so the standfirst comes
// from the newest website report with one.
function leadSummary(all, lead, inc) {
  const good = (r) => r && !r.via && r.summary && r.summary.length >= 40 && !r.summary.startsWith(r.title);
  const pick = good(lead) ? lead : all.find(good);
  return pick ? truncate(pick.summary, 300) : inc.summary;
}

/**
 * A picture for the story from its own coverage, sharpest first: at each size the lead report's,
 * else the newest from a major outlet, then from anyone. Website reports only, since Bluesky link
 * cards often show a different article.
 */
export function storyImage(all, lead) {
  const usable = (r) => r && !r.via && r.image?.url && isStraightHeadline(r.title);
  let pick = null;
  for (const min of [900, 600, 0]) {
    const ok = (r) => usable(r) && (!r.image.width || r.image.width >= min);
    pick = (ok(lead) && lead) || all.find((r) => ok(r) && HEADLINE_OUTLETS.has(r.sourceName)) || all.find(ok);
    if (pick) break;
  }
  return pick ? { url: pick.image.url, source: pick.sourceName, link: pick.url, title: pick.title } : undefined;
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
    let matched = matchReports(pool, topic);
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
    matched = matchReports(pool, topic);
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
      const lead = leadHeadline(all, inc);
      return {
        // Keyed on the earliest report, so the page address survives a change of lead headline.
        id: hashId(all[all.length - 1].url),
        title: lead.title,
        summary: leadSummary(all, lead, inc),
        image: storyImage(all, lead),
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
        new Set(s.updates.filter((u) => now - u.time <= LIVE.activeHours * 3600000).map((u) => u.source)).size >=
          (now - s.startedAt >= LIVE.matureHours * 3600000 ? LIVE.matureOutlets : LIVE.activeOutlets),
    )
    .sort((a, b) => b.outlets.length - a.outlets.length || b.updatedAt - a.updatedAt)
    .slice(0, LIVE.maxStories);
}
