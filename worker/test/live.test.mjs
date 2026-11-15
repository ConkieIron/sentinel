import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLiveStories,
  topicFeatures,
  topicMatches,
  storyImage,
  sameTake,
  dedupeTakes,
  isLiveBlogItem,
  takeText,
  takeTokens,
} from '../src/analysis/live.js';

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
  report('Africanews', 'United States nationwide ground stop lifted after longest shutdown since 2001', 2.5),
  report('The Hindu', "U.S. FAA ground stop updates: Flights resume as hours-long halt lifted; Trump admin. blames 'overloaded' systems", 1.5),
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
  assert.equal(story.title, 'U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop', 'explainers never become the title');
  for (const u of story.updates) assert.ok(!/Storm Charles|Airline profits|salt mine/.test(u.title), u.title);
});

test('the story is titled with the newest straight headline, preferring major outlets', () => {
  const incidents = [incident('Why did a Brooklyn building collapse suddenly, killing eight?', 3)];
  const reports = [
    report('The Times of India', 'Why did a Brooklyn building collapse suddenly, killing eight?', 3),
    report('USA Today', 'Hazards and cracks preceded deadly Brooklyn building collapse, records show', 2.5),
    report('Dawn (Pakistan)', 'Brooklyn building collapse death toll rises to eight as search ends', 1.2),
    report('Associated Press', 'Brooklyn building collapse cause under criminal investigation, police say', 1.5),
    report('Associated Press', 'Brooklyn building collapse raises questions about city oversight', 1),
    report('CNN', 'What we know about the Brooklyn building collapse', 0.5),
    ...BACKGROUND,
  ];
  const [story] = findLiveStories(incidents, reports, NOW);
  assert.ok(story, 'story found');
  assert.equal(story.title, 'Brooklyn building collapse cause under criminal investigation, police say');
});

test('straight headlines exclude explainers, questions and live blogs', async () => {
  const { isStraightHeadline } = await import('../src/analysis/live.js');
  assert.ok(isStraightHeadline('FAA lifts nationwide ground stop on all US flights'));
  assert.ok(isStraightHeadline('U.S. flights resume after hours-long outage as FAA lifts ground stop'));
  for (const t of ['Why did a Brooklyn building collapse suddenly?', "What we know about the ground stop and what to do if you're affected", 'Live: flights resume across the US after outage', 'Analysis: the ground stop exposes ageing systems', 'Ground stop: how the outage unfolded, explained', 'A Brooklyn building fell in seconds. Grief reached around the world', 'Doorbell video captures harrowing moment building collapsed in NYC', 'Microsoft Outage updates: Global outage ends after tech giant restores services'])
    assert.ok(!isStraightHeadline(t), t);
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

test('"White House" and leader names do not pull unrelated reports into a story', () => {
  const incidents = [incident('Feds add D.C. terrorism charge for White House Correspondents’ Dinner gunman', 3, { category: 'terrorism' })];
  const reports = [
    ...BACKGROUND,
    report('NBC News', 'Feds add D.C. terrorism charge for White House Correspondents’ Dinner gunman', 3),
    report('CBS News', 'Trump, Putin, Xi Jinping to meet in first trilateral of its kind, White House says', 2),
    report('Sky News', 'Trump, Xi and Putin to hold unprecedented meeting, White House says', 2),
    report('Euronews', 'Trump, Xi and Putin to meet in China, White House says', 1),
    report('BBC News', 'Trump, Putin and Xi plan historic joint meeting in China next week, White House says', 1),
    report('The Japan Times', 'White House demanding Japan triple host-nation support for U.S. troops', 1),
    report('The Independent', 'Knives come out at the White House over Nvidia scandal', 0.5),
  ];
  assert.deepEqual(findLiveStories(incidents, reports, NOW), []);
});

test('a story with no recent reports is no longer live', () => {
  const old = FAA.map((r) => ({ ...r, time: r.time - 6 * H }));
  const incidents = [incident('U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop', 17)];
  assert.deepEqual(findLiveStories(incidents, [...old, ...BACKGROUND], NOW), []);
});

test('a day-old story is not kept live by later headlines that share a couple of its words', () => {
  const incidents = [incident('US air force responds to suspected drone activity over UK airbase', 20, { category: 'conflict' })];
  const DRONE = [
    report('CNA (Asia)', 'US air force responds to suspected drone activity over UK airbase', 20),
    report('CNN', 'US Air Force personnel at the RAF Lakenheath base in Britain responded to suspected unauthorized drone activity', 19.5),
    report('South China Morning Post', 'US Air Force responds to suspected drone activity over UK airbase', 18),
    report('The Kyiv Independent', 'US Air Force responds to suspected drone activity at military base in UK', 17.7),
    // A second take is what makes it live coverage rather than one announcement restated.
    report('BBC News', 'No aircraft damaged after US Air Force responds to drone activity at RAF Lakenheath', 17.5),
  ];
  const STRAYS = [
    report('CNA (Asia)', "US Air Force captain arrested in Japan's Okinawa for alleged drunk driving", 8),
    report('The Japan Times', 'U.S. Air Force captain arrested in Okinawa for alleged drunk driving', 8),
    report('The Independent', 'Called 911? A drone may now be the first response', 0.5),
  ];
  assert.deepEqual(findLiveStories(incidents, [...DRONE, ...STRAYS, ...BACKGROUND], NOW), []);
  // While it was developing, the same reports made a live story, without the strays.
  const then = NOW - 17 * H;
  const [story] = findLiveStories(incidents, [...DRONE, ...STRAYS.map((r) => ({ ...r, time: r.time - 17 * H }))], then + H);
  assert.ok(story, 'live while outlets were reporting it');
  assert.ok(story.takeCount >= 2);
  assert.ok(story.updates.length < DRONE.length, 'near-identical drone headlines collapsed');
});

test('one late report does not keep a story live', () => {
  const old = FAA.map((r) => ({ ...r, time: r.time - 6 * H }));
  const late = report('Dawn (Pakistan)', 'US flights resume after rare hours-long nationwide ground stop', 0.3);
  const incidents = [incident('U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop', 17)];
  assert.deepEqual(findLiveStories(incidents, [...old, late, ...BACKGROUND], NOW), []);
});

test('a story that has ended is not kept live by a couple of late re-reports', () => {
  const incidents = [incident("Microsoft announces service 'restored', global outage over", 0.2, { category: 'infrastructure' })];
  const MSFT = [
    report('Reuters', 'Microsoft cloud outage disrupts Teams, Outlook and Azure worldwide', 14),
    report('The Japan Times', 'Microsoft says services fully restored after outage roiled world', 12.8),
    report('BBC News', 'Microsoft says services fully restored after day-long global outage', 11),
    report('CBS News', 'Microsoft says it "restored service" after major worldwide outage', 10.2),
    report('CNA (Asia)', 'Microsoft restores service to Outlook and Teams after global outage', 9.7),
    report('The Hindu', 'Microsoft says services fully restored after hourslong global outage', 7.7),
    report('The Independent', 'Microsoft confirms services fully restored after major global outage', 6.5),
    report('Sky News', 'Microsoft confirms all services are restored after global outage', 2.8),
    report('Dawn (Pakistan)', "Microsoft announces service 'restored', global outage over", 0.2),
  ];
  const background = BACKGROUND.filter((r) => !/Microsoft/.test(r.title));
  assert.deepEqual(findLiveStories(incidents, [...MSFT, ...background], NOW), []);
  // Three outlets restating "restored" is not a new development.
  const busy = [...MSFT, report('Reuters', 'Microsoft says services are fully restored after global outage', 1)];
  assert.deepEqual(findLiveStories(incidents, [...busy, ...background], NOW), []);
  // A genuine later development (cause identified) keeps it live alongside recent restored coverage.
  const moving = [
    ...MSFT,
    report('Associated Press', 'Microsoft says faulty software update caused global outage as services return', 1),
    report('CNN', 'Microsoft blames configuration change for worldwide outage after services restored', 0.8),
  ];
  assert.equal(findLiveStories(incidents, [...moving, ...background], NOW).length, 1);
});

test('the same announcement from many outlets is not a live story', () => {
  const incidents = [incident('Jordan sentences 3 men to death for October church attack that killed 9', 1, { category: 'terrorism', severity: 4 })];
  const reports = [
    report('The Times of India', 'Jordan sentences 3 men to death for October church attack that killed 9', 1.2),
    report('The Hindu', 'Jordan sentences three men to death over church attack', 1),
    report('France 24', 'Three sentenced to death over Jordan church attack', 0.9),
    report('Al Jazeera', 'Jordan sentences three men to death by hanging after deadly church attack', 0.5),
    ...BACKGROUND,
  ];
  assert.deepEqual(findLiveStories(incidents, reports, NOW), []);
  assert.ok(sameTake(reports[0].title, reports[1].title));
  assert.equal(dedupeTakes(reports.slice(0, 4)).length, 1);
});

test('paraphrases of one strike collapse; a condemnation and an alert stay separate', () => {
  // Iran/Iranian must share a place token; "attack" is a clustering stopword but must count here.
  assert.ok(takeTokens('Iranian strikes').includes('irn'));
  assert.ok(takeTokens('Iranian aerial attacks').includes('attack'));

  const titles = [
    'Jordan condemns Iranian drone strike on Bahrain',
    'Iran says it targets US radar in Bahrain. What do we know?',
    'Bahrain says it intercepted Iranian strikes, Tehran targets U.S. assets',
    'Bahraini defence forces say several Iranian aerial attacks intercepted',
    'Bahrain issues first threat alerts since September as Iran says it attacked US base',
    'US radar facility at Bahrain base attacked with six drones, IRGC claims',
    "Bahrain's interior ministry issues alerts of potential threats",
  ];
  assert.ok(sameTake(titles[1], titles[2]), 'radar target ≈ intercepted strikes');
  assert.ok(sameTake(titles[2], titles[3]), 'intercepted strikes ≈ aerial attacks intercepted');
  assert.ok(sameTake(titles[1], titles[5]), 'radar target ≈ radar facility attacked');
  assert.ok(!sameTake(titles[0], titles[1]), 'condemnation is a new development');
  assert.ok(!sameTake(titles[1], titles[6]), 'alerts-only is not the strike take');

  const reports = titles.map((title, i) => report('Outlet', title, i));
  const kept = dedupeTakes(reports);
  assert.equal(kept.length, 3, 'strike cluster + Jordan condemnation + alerts');
  assert.ok(kept.some((r) => /condemns/i.test(r.title)));
  assert.ok(kept.some((r) => /alerts of potential threats/i.test(r.title)));
  assert.ok(kept.some((r) => /radar|intercept|attack/i.test(r.title)));
});

test('a summary that adds facts counts as a new take, and live-blog items are preferred', () => {
  assert.ok(isLiveBlogItem({ title: 'FAA ground stop updates: flights resume', url: 'https://www.bbc.co.uk/news/live/abc' }));
  assert.ok(isLiveBlogItem({ title: 'Live: Bahrain intercepts Iranian drones', url: 'https://www.reuters.com/world/bahrain' }));
  assert.ok(!isLiveBlogItem({ title: 'Bahrain intercepts Iranian drones', url: 'https://www.reuters.com/world/bahrain-intercepts' }));

  const headline = 'FAA lifts nationwide ground stop on all US flights after outage';
  const oneShot = {
    ...report('Sky News', headline, 1),
    summary: 'The FAA has lifted its nationwide ground stop on flights.',
  };
  const liveBlog = {
    ...report('BBC News', headline, 0.9),
    url: 'https://www.bbc.co.uk/news/live/faa-ground-stop',
    summary: 'The FAA has lifted its nationwide ground stop on flights after an hours-long communications failure.',
  };
  assert.ok(isLiveBlogItem(liveBlog));
  assert.ok(sameTake(oneShot, liveBlog));
  const [kept] = dedupeTakes([oneShot, liveBlog].sort((a, b) => b.time - a.time));
  assert.equal(kept.url, liveBlog.url, 'live-blog tick preferred over the one-shot restatement');

  const risingToll = [
    {
      ...report('Reuters', 'Brooklyn building collapse kills eight', 2),
      summary: 'Eight people were killed when a Brooklyn building collapsed.',
    },
    {
      ...report('Associated Press', 'Brooklyn building collapse kills eight', 1),
      summary: 'The death toll from the Brooklyn building collapse has risen to twelve as rescuers continue to search the rubble.',
    },
  ];
  assert.ok(takeText(risingToll[1]).includes('twelve') || takeText(risingToll[1]).includes('rubble'));
  assert.ok(!sameTake(risingToll[0], risingToll[1]), 'same headline, new toll in the dek');
  assert.equal(dedupeTakes(risingToll).length, 2);
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

test('a story picture comes from its lead report, else a major outlet, never from a Bluesky card', () => {
  const img = (url, width) => ({ url, width });
  const lead = { ...report('The Hindu', 'U.S. flights resume after FAA lifts nationwide ground stop', 1), image: img('https://img.example/small.jpg', 300) };
  const all = [
    lead,
    { ...report('Sky News', 'FAA lifts nationwide ground stop on all US flights', 1.5), via: 'Bluesky', image: img('https://img.example/card.jpg', 1200) },
    { ...report('Africanews', 'United States nationwide ground stop lifted after long shutdown', 2), image: img('https://img.example/africa.jpg', 1200) },
    { ...report('BBC News', 'All US flights grounded by air traffic control outage', 3), image: img('https://img.example/bbc.jpg', 976) },
  ];
  assert.deepEqual(storyImage(all, lead), { url: 'https://img.example/bbc.jpg', source: 'BBC News', link: all[3].url, title: all[3].title });
  assert.equal(storyImage(all, { ...lead, image: img('https://img.example/big.jpg', 1024) }).url, 'https://img.example/big.jpg');
  assert.equal(storyImage([lead], lead).url, 'https://img.example/small.jpg', 'a small picture beats none');
  const plain = report('CNN', 'All flights in the United States are grounded', 1);
  assert.equal(storyImage([plain], plain), undefined);
});
