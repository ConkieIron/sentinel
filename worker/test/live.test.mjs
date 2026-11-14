import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLiveStories, topicFeatures, topicMatches } from '../src/analysis/live.js';

const NOW = Date.parse('2026-11-14T14:00:00Z');
const H = 3600000;

let n = 0;
function report(sourceName, title, hoursAgo) {
  return { sourceName, title, summary: '', type: 'publisher', url: `https://news.example/${n++}`, time: NOW - hoursAgo * H };
}

function incident(title, hoursAgo, extra = {}) {
  return { id: `inc${n++}`, title, summary: '', category: 'infrastructure', severity: 3, evidence: 'multi', retrospective: false, time: NOW - hoursAgo * H, location: null, ...extra };
}

const FAA = [
  report('CNN', 'All flights in the United States are grounded until further notice', 16),
  report('Associated Press', 'Flights halted at airports across US due to air traffic control communications problems, FAA says', 16),
  report('CNA (Asia)', 'All departing US flights grounded due to communications problem', 15),
  report('France 24', 'FAA lifts nationwide ground stop on all US flights', 11),
  report('The Hindu', 'U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop', 11),
  report('BBC News', "What we know about the ground stop and what to do if you're affected", 6),
  report('Euronews', 'Passengers continue to face delays and cancellations after US lifts nationwide ground stop', 7),
  report('Africanews', 'United States nationwide ground stop lifted after longest shutdown since 2001', 4),
  report('Associated Press', 'What to know about flights after the US nationwide ground stop', 0.2),
];

// Unrelated news, including stories that share words with the FAA coverage or with each other.
const BACKGROUND = [
  'Russia and Ukraine trade drone strikes overnight as talks stall',
  'Ukraine says Russia launched missiles at power grid in Kharkiv',
  'Russia claims capture of village in eastern Ukraine',
  'Three killed in Russia as Ukraine claims US floated NATO membership option',
  'Ukraine, Russia race to build military satellite networks as war rages on',
  'US loses measles-free status after continued spread of the disease',
  'Underwater salt mine closure in Ohio raises safety and supply concerns for winter',
  'Storm Charles causes floods and flight cancellations across southern Europe',
  'Microsoft says services fully restored after global outage',
  'Central bank holds interest rates steady amid inflation worries',
  'Election officials in Brazil begin counting ballots',
  'Wildfire forces evacuations near Athens as temperatures soar',
  'Earthquake of magnitude 6.1 strikes off the coast of Japan',
  'Protesters march in Paris against pension changes',
  'Shipping firms reroute vessels away from Red Sea',
  'Oil prices rise as OPEC signals output cuts',
  'Measles cases climb in Texas as officials urge vaccination',
  'Train strike disrupts commuters across Germany',
  'Hospital in Gaza hit by strikes, health officials say',
  'Cyclone makes landfall in Bangladesh, thousands evacuated',
  'Tech shares slide as investors weigh AI spending',
  'Airline profits soar on record summer travel demand',
  'Police arrest suspect after stabbing in London',
  'Volcano erupts in Iceland, flights unaffected',
  'Floods in Spain leave dozens stranded',
  'Ceasefire talks resume in Cairo',
  'Heatwave grips India as power demand hits record',
  'New York subway delays after signal failure',
  'Chinese exports beat forecasts in October',
  'Football club fined over crowd trouble',
].map((t, i) => report(['Reuters', 'BBC News', 'Al Jazeera', 'The Guardian', 'DW'][i % 5], t, (i % 12) + 0.5));

test('a developing story collects every outlet, including headlines without its key acronym', () => {
  const incidents = [incident('U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop', 11)];
  const [story, ...rest] = findLiveStories(incidents, [...FAA, ...BACKGROUND], NOW);
  assert.equal(rest.length, 0);
  // The early AP headline shares no phrase with the story ("flights halted ... FAA says"); being
  // strict here is what keeps unrelated flight news out.
  assert.ok(story.reportCount >= FAA.length - 1, `${story.reportCount} of ${FAA.length}`);
  assert.ok(story.outlets.length >= 7);
  assert.ok(story.updates.some((u) => u.title.startsWith('What we know about the ground stop')));
  assert.ok(story.updates.some((u) => u.title.startsWith('All flights in the United States are grounded')));
  assert.equal(story.updates[0].title, 'What to know about flights after the US nationwide ground stop', 'newest first');
  for (const u of story.updates) assert.ok(!/Storm Charles|Airline profits|salt mine/.test(u.title), u.title);
});

test('two incidents describing the same story merge into one live story', () => {
  const incidents = [
    incident('U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop', 11),
    incident('FAA lifts nationwide ground stop on all US flights', 11),
  ];
  const stories = findLiveStories(incidents, [...FAA, ...BACKGROUND], NOW);
  assert.equal(stories.length, 1);
  assert.equal(stories[0].topics.length, 2);
});

test('common pairs like "Russia ... Ukraine" do not pull unrelated reports into a story', () => {
  const incidents = [incident('Ukraine: Russian drone attacks hit Kyiv hospital, leave two dead in Odesa', 2, { category: 'conflict' })];
  const reports = [
    ...BACKGROUND,
    report('Africanews', 'Ukraine: Russian drone attacks hit Kyiv hospital, leave two dead in Odesa', 2),
    report('Euronews', 'Russian drones hit Kyiv hospital overnight', 1),
  ];
  assert.deepEqual(findLiveStories(incidents, reports, NOW), [], 'two outlets is not enough, and general Ukraine news must not count');
});

test('a story with no recent reports is no longer live', () => {
  const old = FAA.map((r) => ({ ...r, time: r.time - 6 * H }));
  const incidents = [incident('U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop', 17)];
  assert.deepEqual(findLiveStories(incidents, [...old, ...BACKGROUND], NOW), []);
});

test('published topics match new wire headlines on the story and nothing else', () => {
  const incidents = [incident('U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop', 11)];
  const [story] = findLiveStories(incidents, [...FAA, ...BACKGROUND], NOW);
  const matches = (title) => story.topics.some((t) => topicMatches(topicFeatures(title), t));
  assert.ok(matches('Airlines cancel thousands more flights a day after nationwide ground stop'));
  assert.ok(matches('FAA chief says ageing systems caused nationwide ground stop'));
  assert.ok(!matches('Storm Charles causes flight cancellations across southern Europe'));
  assert.ok(!matches('Airline profits soar on record summer travel demand'));
});
