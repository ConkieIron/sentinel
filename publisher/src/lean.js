// Thin display helpers over the gatherer's media-lean map.
import { leanFor, leanLabel as labelFor, LEAN } from '../../worker/src/data/mediaLean.js';

/** Spectrum order for multi-source lean ranges (Wire/State/Official sit at centre). */
const LEAN_ORDER = ['left', 'center-left', 'center', 'wire', 'state', 'official', 'center-right', 'right'];

export function leanKey(nameOrLean) {
  if (!nameOrLean) return null;
  if (LEAN[nameOrLean] && nameOrLean !== 'unrated') return nameOrLean;
  const key = leanFor(nameOrLean);
  return key !== 'unrated' ? key : null;
}

export function leanLabel(key, snapshot) {
  if (!key) return '';
  return snapshot?.leans?.[key] || labelFor(key) || '';
}

/** Small tag next to an outlet name. Approximate editorial lean, not accuracy. */
export function leanTag(nameOrLean, snapshot) {
  const key = leanKey(typeof nameOrLean === 'object' ? nameOrLean.lean || nameOrLean.name : nameOrLean);
  if (!key) return '';
  const label = leanLabel(key, snapshot);
  if (!label) return '';
  return `<span class="lean lean-${key}" title="Approximate editorial lean of the outlet, not an accuracy rating">${label}</span>`;
}

/**
 * Compact Left–Right / Wire range from an incident's sources, for multi-outlet cards.
 * Returns '' when there is only one rated lean.
 */
export function leanSpread(sources, snapshot) {
  const keys = [...new Set((sources || []).map((s) => leanKey(s.lean || s.name)).filter(Boolean))];
  if (keys.length < 2) return '';
  const ranked = keys
    .map((k) => ({ key: k, i: LEAN_ORDER.indexOf(k) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i);
  if (ranked.length < 2) return '';
  const left = leanLabel(ranked[0].key, snapshot);
  const right = leanLabel(ranked[ranked.length - 1].key, snapshot);
  if (!left || !right || left === right) return '';
  const title = 'Approximate span of outlet leans covering this story, not an accuracy rating';
  return `<span class="lean lean-spread" title="${title}">${left}–${right}</span>`;
}

/** One-line caveat shown near the first lean tags a reader sees. */
export function leanCaveat() {
  return `<p class="lean-caveat small muted">Lean tags (Left–Right, Wire, State-funded, Official) are approximate editorial placements, not accuracy scores. BBC is rated Centre as a public broadcaster; DW, France 24, RFI, ABC Australia and CNA are marked State-funded as government international services.</p>`;
}
