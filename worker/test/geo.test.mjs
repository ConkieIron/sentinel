import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate, nearestCountry } from '../src/analysis/geo.js';

test('locates countries and cities from headlines', () => {
  assert.equal(locate('Floods displace thousands in Bangladesh')?.iso3, 'BGD');
  const city = locate('Explosion rocks Kabul neighbourhood');
  assert.equal(city?.iso3, 'AFG');
  assert.equal(city?.precision, 'city');
  assert.equal(city?.region, 'south-asia');
});

test('handles abbreviations and display-name overrides', () => {
  assert.equal(locate('U.S. issues travel warning after shooting in Texas')?.iso3, 'USA');
  assert.equal(locate('UK raises terror threat level')?.iso3, 'GBR');
  assert.equal(locate('Rebels advance in eastern DRC')?.iso3, 'COD');
});

test('places outrank nationality adjectives', () => {
  assert.equal(locate('Israeli strikes hit southern Lebanon')?.iso3, 'LBN');
});

test('region overrides apply', () => {
  assert.equal(locate('Protests spread across Iran')?.region, 'middle-east');
});

test('people sharing a place name are not located', () => {
  assert.equal(locate('Jordan Bardella speaks at rally'), null);
});

test('returns null when nothing is recognisable', () => {
  assert.equal(locate('Markets slide as investors weigh outlook'), null);
});

test('worldwide and global outages are Global, not a HQ country', () => {
  const outage = locate('Microsoft says services fully restored after global outage hits governments');
  assert.equal(outage?.precision, 'global');
  assert.equal(outage?.country, 'Global');
  assert.equal(outage?.iso3, null);
  assert.equal(outage?.region, null);

  const usCue = locate('US airlines disrupted as worldwide CrowdStrike outage grounds flights');
  assert.equal(usCue?.precision, 'global');
  assert.equal(usCue?.country, 'Global');

  // Ordinary national news must not become Global just because "world" appears elsewhere.
  assert.equal(locate('Floods displace thousands in Bangladesh')?.iso3, 'BGD');
  assert.equal(locate('Protests spread across Iran')?.iso3, 'IRN');
});

test('FAA and nationwide ground stops stay USA, even when a global outage is mentioned', () => {
  assert.equal(locate('FAA Lifts Ground Stop, Allowing Flights to Resume After Outage')?.iso3, 'USA');
  assert.equal(locate('Airlines cancel thousands more flights after nationwide ground stop')?.iso3, 'USA');
  const mixed = locate('FAA lifts nationwide ground stop after Microsoft global outage');
  assert.equal(mixed?.iso3, 'USA');
  assert.notEqual(mixed?.precision, 'global');
});

test('nearestCountry resolves coordinates', () => {
  assert.equal(nearestCountry(35.68, 139.69)?.iso3, 'JPN');
  assert.equal(nearestCountry(-40, -140), null);
});
