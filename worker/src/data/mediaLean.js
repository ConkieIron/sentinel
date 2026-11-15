// Approximate editorial lean of known outlets. This is a transparency aid for readers, not a
// factual-accuracy score. Ratings are a curated SENTINEL summary of commonly cited placements
// (e.g. AllSides / Ad Fontes style charts and public-broadcaster status). Contested outlets are
// labelled conservatively. Unlisted and social accounts are unrated.

export const LEAN = {
  left: 'Left',
  'center-left': 'Centre-left',
  center: 'Centre',
  'center-right': 'Centre-right',
  right: 'Right',
  state: 'State-funded',
  wire: 'Wire',
  official: 'Official',
  unrated: 'Unrated',
};

/** @type {Record<string, keyof typeof LEAN>} */
const BY_NAME = {
  // Wires
  'Associated Press': 'wire',
  Reuters: 'wire',
  AFP: 'wire',

  // Public / international broadcasters (government-funded, not partisan party press)
  'BBC News': 'center',
  'Deutsche Welle': 'state',
  'France 24': 'state',
  RFI: 'state',
  'CNA (Asia)': 'state',
  'ABC News (Australia)': 'state',
  Euronews: 'center',
  Africanews: 'center',

  // Centre / centre-right / centre-left / right commercial
  'Sky News': 'center',
  Bloomberg: 'center',
  'USA Today': 'center',
  'Al Jazeera': 'center-left',
  NPR: 'center-left',
  CNN: 'center-left',
  'NBC News': 'center-left',
  'CBS News': 'center-left',
  'ABC News (US)': 'center-left',
  Politico: 'center-left',
  'The New York Times': 'center-left',
  'The Washington Post': 'center-left',
  'Los Angeles Times': 'center-left',
  'The Guardian': 'left',
  'The Independent': 'left',
  'The Irish Times': 'center-left',
  'The Sydney Morning Herald': 'center-left',
  'The Hindu': 'center-left',
  'The Times of India': 'center',
  'Dawn (Pakistan)': 'center',
  'South China Morning Post': 'center',
  'The Japan Times': 'center',
  'The Kyiv Independent': 'center',
  'The Times of Israel': 'center-right',
  'The Wall Street Journal': 'center-right',
  'The Telegraph': 'center-right',
  'The Australian': 'center-right',
  'Fox News': 'right',
  'New York Post': 'right',
  'Middle East Eye': 'left',
  'Premium Times (Nigeria)': 'center',

  // Official data
  USGS: 'official',
  'USGS Earthquakes': 'official',
  'GDACS (UN/EC)': 'official',
  'GDACS Disaster Alerts': 'official',
};

/**
 * Resolve a lean key for a source display name (handles "CNN (Bluesky)" and top-story labels).
 * @param {string} name
 * @returns {keyof typeof LEAN}
 */
export function leanFor(name) {
  const raw = String(name || '').trim();
  if (!raw) return 'unrated';
  if (/^Bluesky\b/i.test(raw)) return 'unrated';
  const base = raw.replace(/\s*\((?:Bluesky|top stories)\)\s*$/i, '').trim();
  return BY_NAME[base] || BY_NAME[raw] || 'unrated';
}

export function leanLabel(key) {
  return LEAN[key] || LEAN.unrated;
}
