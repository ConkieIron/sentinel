import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clusterItems } from '../src/analysis/cluster.js';
import { classify } from '../src/analysis/classify.js';
import { locate } from '../src/analysis/geo.js';

const NOW = Date.parse('2026-11-14T12:00:00Z');

function item(sourceName, title, { type = 'publisher', minutesAgo = 30 } = {}) {
  return {
    sourceId: sourceName.toLowerCase(),
    sourceName,
    type,
    title,
    summary: '',
    url: `https://${sourceName.toLowerCase().replace(/\s/g, '')}.example/${encodeURIComponent(title)}`,
    time: NOW - minutesAgo * 60000,
    cls: classify(title),
    loc: locate(title),
  };
}

test('reports of the same event from different outlets merge into one incident', () => {
  const incidents = clusterItems([
    item('BBC', 'Suicide bombing at Mogadishu hotel kills 9'),
    item('Al Jazeera', 'Mogadishu hotel suicide bombing: nine killed, al-Shabab claims attack'),
    item('Bluesky', 'Huge blast at hotel in Mogadishu, suicide bombing reported', { type: 'social' }),
  ]);
  assert.equal(incidents.length, 1);
  const [inc] = incidents;
  assert.equal(inc.category, 'terrorism');
  assert.equal(inc.evidence, 'multi');
  assert.equal(inc.sourceCount, 2);
  assert.equal(inc.reportCount, 3);
  assert.equal(inc.location.iso3, 'SOM');
});

test('unrelated stories in the same country stay separate', () => {
  const incidents = clusterItems([
    item('BBC', 'Floods displace thousands in northern Nigeria'),
    item('Reuters', 'Gunmen kidnap 30 students from school in Nigeria'),
  ]);
  assert.equal(incidents.length, 2);
});

test('social-only incidents are capped at severity 3', () => {
  const [inc] = clusterItems([item('Bluesky', 'Explosion kills 50 at stadium in Karachi', { type: 'social' })]);
  assert.equal(inc.evidence, 'social');
  assert.ok(inc.severity <= 3);
});

test('sibling clusters about the same event are consolidated', () => {
  // Different social seeds and a cross-border outlet used to leave three incidents.
  const incidents = clusterItems([
    item('Bluesky', 'Senior Hamas commander killed in Israeli strike in Gaza', { type: 'social', minutesAgo: 600 }),
    item('Bluesky', 'Named Hamas commander killed in Israeli strike on Khan Younis', { type: 'social', minutesAgo: 400 }),
    item('Irish Times', 'Senior Hamas commander killed in Israeli strike in Gaza', { minutesAgo: 26 }),
    item('Middle East Eye', 'Hamas commander Samir Abu Younis killed in Israeli strike on Khan Younis', { minutesAgo: 270 }),
    item('Sky News', 'Hamas says senior commander killed in Israeli airstrike', { minutesAgo: 314 }),
  ]);
  assert.equal(incidents.length, 1);
  assert.ok(incidents[0].sourceCount >= 3);
});

test('cross-border reports of the same strike merge', () => {
  const incidents = clusterItems([
    item('France 24', 'Iran claims attack on US military airbase in Bahrain', { minutesAgo: 30 }),
    item('The Hindu', "Sirens sound in Bahrain as Iran's Guards claim drone attack", { minutesAgo: 290 }),
  ]);
  assert.equal(incidents.length, 1);
});

test('a worldwide outage stays Global even if a sibling headline names the US', () => {
  const incidents = clusterItems([
    item('The Guardian', 'Microsoft global outage: services restored after worldwide disruption', { minutesAgo: 20 }),
    item('CNN', 'Microsoft global outage hits US government agencies as services recover', { minutesAgo: 40 }),
  ]);
  assert.equal(incidents.length, 1);
  assert.equal(incidents[0].location?.precision, 'global');
  assert.equal(incidents[0].location?.country, 'Global');
  assert.equal(incidents[0].location?.iso3, null);
});
