// Headline stock indices for the masthead ticker. One request to Yahoo Finance's public spark
// endpoint (no key) returns every index; quotes are delayed by up to 15 minutes at source.

import { fetchWithTimeout } from '../lib/http.js';

export const MARKETS = [
  { id: 'ftse', name: 'FTSE 100', symbol: '^FTSE' },
  { id: 'dow', name: 'Dow Jones', symbol: '^DJI' },
  { id: 'sp500', name: 'S&P 500', symbol: '^GSPC' },
];
const SPARK = 'https://query1.finance.yahoo.com/v8/finance/spark';
// A market whose last 5-minute bar is older than this is shown as closed.
const OPEN_WITHIN_MS = 20 * 60000;

export function parseSpark(data, now) {
  const out = [];
  for (const m of MARKETS) {
    const s = data?.[m.symbol];
    if (!s) continue;
    const bars = (s.timestamp || []).map((t, i) => [t * 1000, s.close?.[i]]).filter(([, c]) => Number.isFinite(c));
    const [time, last] = bars[bars.length - 1] || [];
    const price = Number.isFinite(s.fulldayPrice) ? s.fulldayPrice : last;
    const prev = s.chartPreviousClose ?? s.previousClose;
    if (!Number.isFinite(price) || !time) continue;
    const changePct = Number.isFinite(s.fulldayChangePercent) ? s.fulldayChangePercent : Number.isFinite(prev) && prev ? ((price - prev) / prev) * 100 : null;
    out.push({
      id: m.id,
      name: m.name,
      price: Math.round(price * 100) / 100,
      changePct: changePct === null ? null : Math.round(changePct * 100) / 100,
      time,
      open: now - time <= OPEN_WITHIN_MS,
    });
  }
  return out;
}

export async function fetchMarkets(now) {
  const symbols = MARKETS.map((m) => encodeURIComponent(m.symbol)).join(',');
  const res = await fetchWithTimeout(`${SPARK}?symbols=${symbols}&range=1d&interval=5m`, { timeoutMs: 8000, headers: { Accept: 'application/json' } });
  return parseSpark(await res.json(), now);
}
