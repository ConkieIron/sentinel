import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestCountry } from '../src/localGeo.js';
import { COUNTRIES } from '../../worker/src/data/countries.js';
import { CATCH_KM, DEFAULT_CATCH_KM } from '../src/localGeo.js';

const geo = COUNTRIES.map((c) => ({
  ...c,
  catchKm: CATCH_KM[c.iso3] ?? DEFAULT_CATCH_KM,
}));

test('mainland UK cities match the United Kingdom, not Jersey or Guernsey', () => {
  assert.equal(nearestCountry(51.5, -0.12, geo)?.iso3, 'GBR', 'London');
  assert.equal(nearestCountry(50.9, -1.4, geo)?.iso3, 'GBR', 'Southampton');
  assert.equal(nearestCountry(50.82, -0.14, geo)?.iso3, 'GBR', 'Brighton');
  assert.equal(nearestCountry(53.48, -2.24, geo)?.iso3, 'GBR', 'Manchester');
  assert.equal(nearestCountry(51.13, 1.3, geo)?.iso3, 'GBR', 'Dover');
});

test('St Helier still matches Jersey', () => {
  assert.equal(nearestCountry(49.18, -2.1, geo)?.iso3, 'JEY');
});

test('French Channel coast matches France, not Jersey or the UK', () => {
  assert.equal(nearestCountry(49.38, -1.8, geo)?.iso3, 'FRA', 'Carteret');
});
