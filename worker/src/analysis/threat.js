// Regional threat index.
//
// Each incident contributes  severityWeight × categoryWeight × evidenceWeight × recencyDecay.
// A region's score sums its incidents with diminishing returns (the n-th heaviest incident is
// multiplied by diminishingReturns^(n-1)). Levels are RELATIVE: regions are compared with
// the most active region on a square-root scale (so one extreme hotspot does not flatten everyone
// else), and must also clear absolute floors so a quiet news cycle does not produce "High" anywhere.

import { REGIONS } from '../data/regions.js';
import { COUNTRIES } from '../data/countries.js';

export function incidentWeight(inc, now, model) {
  const ageH = Math.max(0, (now - inc.time) / 3600000);
  const decay = Math.pow(0.5, ageH / model.recencyHalfLifeHours);
  const w =
    model.severityWeight[inc.severity] *
    (model.categoryWeight[inc.category] ?? 0.5) *
    (model.evidenceWeight[inc.evidence] ?? 1) *
    (inc.retrospective ? 0.3 : 1) *
    decay;
  return Math.round(w * 100) / 100;
}

export function levelFor(score, maxScore, model) {
  const relative = maxScore > 0 ? Math.sqrt(score / maxScore) : 0;
  let level = 'low';
  if (relative >= model.highRelative && score >= model.highFloor) level = 'high';
  else if (relative >= model.mediumRelative && score >= model.mediumFloor) level = 'medium';
  return { level, index: Math.round(relative * 100) };
}

function trendFor(regionId, score, history, now) {
  const past = history.filter((h) => now - h.t >= 18 * 3600000 && now - h.t <= 30 * 3600000);
  if (!past.length) return 'new';
  const prev = past.reduce((s, h) => s + (h.s[regionId] || 0), 0) / past.length;
  if (score > prev * 1.25 + 1) return 'rising';
  if (score < prev * 0.8 - 1) return 'falling';
  return 'steady';
}

/** Counted as suspected terrorism: reported by an outlet or official source, and not a look back. */
export const isReportedTerror = (inc) => inc.category === 'terrorism' && inc.evidence !== 'social' && !inc.retrospective;

export function scoreRegions(incidents, now, model, history = []) {
  const countriesByRegion = new Map(REGIONS.map((r) => [r.id, []]));
  for (const c of COUNTRIES) countriesByRegion.get(c.region)?.push(c.iso3);

  const acc = new Map(
    REGIONS.map((r) => [r.id, { score: 0, incidents: 0, terrorism: 0, severe: 0, killed: 0, byCountry: {}, top: [] }]),
  );
  // Heaviest incidents first so diminishing returns discount the long tail of minor stories,
  // which tracks media volume more than actual threat.
  for (const inc of [...incidents].sort((x, y) => y.weight - x.weight)) {
    const a = inc.location && acc.get(inc.location.region);
    if (!a) continue;
    a.score += inc.weight * Math.pow(model.diminishingReturns, a.incidents);
    a.incidents++;
    if (isReportedTerror(inc)) a.terrorism++;
    if (inc.severity >= 4) a.severe++;
    a.killed += inc.evidence === 'social' ? 0 : inc.casualties.killed;
    a.byCountry[inc.location.iso3] = (a.byCountry[inc.location.iso3] || 0) + 1;
    a.top.push(inc);
  }

  const maxScore = Math.max(0, ...[...acc.values()].map((a) => a.score));
  return REGIONS.map((r) => {
    const a = acc.get(r.id);
    const score = Math.round(a.score * 10) / 10;
    const { level, index } = levelFor(score, maxScore, model);
    return {
      id: r.id,
      name: r.name,
      level,
      index,
      score,
      trend: trendFor(r.id, score, history, now),
      incidents: a.incidents,
      terrorism: a.terrorism,
      severe: a.severe,
      reportedDeaths: a.killed,
      countries: countriesByRegion.get(r.id),
      hotspots: Object.entries(a.byCountry)
        .sort((x, y) => y[1] - x[1])
        .slice(0, 5)
        .map(([iso3, count]) => ({ iso3, name: COUNTRIES.find((c) => c.iso3 === iso3)?.name || iso3, count })),
      topIncidentIds: a.top
        .sort((x, y) => y.weight - x.weight)
        .slice(0, 5)
        .map((i) => i.id),
    };
  }).sort((x, y) => y.score - x.score);
}

// Breaking is the newest major story: severity 4–5, first reported within BREAKING_HOURS. Age is
// measured from the first report, so a late follow-up does not make an old story "breaking".
const BREAKING_HOURS = 3;

export function pickBreaking(incidents, now) {
  const eligible = incidents.filter(
    (i) =>
      i.evidence !== 'social' &&
      !i.retrospective &&
      i.severity >= 4 &&
      now - (i.firstSeen ?? i.time) <= BREAKING_HOURS * 3600000,
  );
  eligible.sort((a, b) => (b.firstSeen ?? b.time) - (a.firstSeen ?? a.time) || b.severity - a.severity);
  return eligible[0]?.id || null;
}
