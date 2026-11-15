// Thin display helpers over the gatherer's media-lean map.
import { leanFor, leanLabel as labelFor, LEAN } from '../../worker/src/data/mediaLean.js';

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
