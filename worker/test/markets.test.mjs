import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpark } from '../src/sources/markets.js';

const NOW = Date.parse('2026-11-13T15:42:00Z');
const t = (iso) => Date.parse(iso) / 1000;

test('spark data becomes price, daily change and open/closed state', () => {
  const data = {
    '^FTSE': { timestamp: [t('2026-11-13T15:30:00Z'), t('2026-11-13T15:35:00Z'), t('2026-11-13T15:40:00Z')], close: [10890, 10899.5, null], fulldayPrice: 10902.564, fulldayChangePercent: 0.3634, chartPreviousClose: 10863.1 },
    '^DJI': { timestamp: [t('2026-11-12T20:55:00Z')], close: [52347.55], chartPreviousClose: 52500 },
  };
  const [ftse, dow, ...rest] = parseSpark(data, NOW);
  assert.equal(rest.length, 0, 'missing symbols are skipped');
  assert.deepEqual(ftse, { id: 'ftse', name: 'FTSE 100', price: 10902.56, changePct: 0.36, time: Date.parse('2026-11-13T15:35:00Z'), open: true });
  assert.equal(dow.open, false);
  assert.equal(dow.changePct, -0.29, 'falls back to the previous close');
});

test('malformed spark data yields no markets', () => {
  assert.deepEqual(parseSpark(null, NOW), []);
  assert.deepEqual(parseSpark({ '^GSPC': { timestamp: [], close: [] } }, NOW), []);
});
