import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL } from '../src/config.js';
import { incidentWeight, levelFor, scoreRegions, pickBreaking } from '../src/analysis/threat.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const H = 3600000;

function incident(id, region, { severity = 3, category = 'conflict', evidence = 'publisher', ageH = 1, retrospective = false } = {}) {
  const inc = {
    id,
    category,
    severity,
    evidence,
    retrospective,
    time: NOW - ageH * H,
    sourceCount: 1,
    casualties: { killed: 0, injured: 0 },
    location: { region, iso3: 'XXX' },
  };
  inc.weight = incidentWeight(inc, NOW, MODEL);
  return inc;
}

test('incident weight decays by half every half-life', () => {
  const fresh = incident('a', 'oceania', { ageH: 0 }).weight;
  const day = incident('b', 'oceania', { ageH: MODEL.recencyHalfLifeHours }).weight;
  assert.ok(Math.abs(day - fresh / 2) < 0.02);
});

test('social and retrospective reports weigh less', () => {
  const base = incident('a', 'oceania').weight;
  assert.ok(incident('b', 'oceania', { evidence: 'social' }).weight < base / 3);
  assert.ok(incident('c', 'oceania', { retrospective: true }).weight < base / 3);
});

test('levels are relative to the busiest region and respect floors', () => {
  assert.equal(levelFor(100, 100, MODEL).level, 'high');
  assert.equal(levelFor(30, 100, MODEL).level, 'medium');
  assert.equal(levelFor(10, 100, MODEL).level, 'low');
  // Busiest region in a quiet cycle stays below High.
  assert.equal(levelFor(5, 5, MODEL).level, 'medium');
  assert.equal(levelFor(2, 2, MODEL).level, 'low');
});

test('scoreRegions ranks regions and applies diminishing returns', () => {
  const incidents = [
    ...Array.from({ length: 6 }, (_, i) => incident(`me${i}`, 'middle-east', { severity: 5 })),
    incident('eu', 'western-europe', { severity: 2 }),
  ];
  const regions = scoreRegions(incidents, NOW, MODEL);
  assert.equal(regions[0].id, 'middle-east');
  assert.equal(regions[0].level, 'high');
  assert.equal(regions.find((r) => r.id === 'western-europe').level, 'low');
  const plainSum = incidents.filter((i) => i.location.region === 'middle-east').reduce((s, i) => s + i.weight, 0);
  assert.ok(regions[0].score < plainSum);
  assert.equal(regions.length, 16);
});

test('trend compares with history from 18-30h ago', () => {
  const incidents = [incident('a', 'oceania', { severity: 5 })];
  const history = [{ t: NOW - 24 * H, s: { oceania: 1 } }];
  assert.equal(scoreRegions(incidents, NOW, MODEL, history).find((r) => r.id === 'oceania').trend, 'rising');
  assert.equal(scoreRegions(incidents, NOW, MODEL, []).find((r) => r.id === 'oceania').trend, 'new');
});

test('breaking excludes social, retrospective, minor and old incidents', () => {
  const list = [
    incident('social', 'oceania', { severity: 5, evidence: 'social' }),
    incident('retro', 'oceania', { severity: 5, retrospective: true }),
    incident('minor', 'oceania', { severity: 3 }),
    incident('old', 'oceania', { severity: 5, ageH: 4 }),
  ];
  assert.equal(pickBreaking(list, NOW), null);
  list.push(incident('real', 'oceania', { severity: 4 }));
  assert.equal(pickBreaking(list, NOW), 'real');
});

test('breaking is the newest major story, not the most severe or a late follow-up', () => {
  const severeEarlier = { ...incident('severe', 'oceania', { severity: 5 }), firstSeen: NOW - 2 * H };
  const newer = { ...incident('newer', 'oceania', { severity: 4 }), firstSeen: NOW - 20 * 60000 };
  const followUp = { ...incident('followup', 'oceania', { severity: 5 }), firstSeen: NOW - 30 * H, time: NOW - 5 * 60000 };
  assert.equal(pickBreaking([severeEarlier, newer, followUp], NOW), 'newer');
  assert.equal(pickBreaking([followUp], NOW), null);
});
