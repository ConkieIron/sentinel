import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountsFor, findBreaking, tick } from '../src/index.js';

test('wires are polled every minute and every other outlet within four minutes', () => {
  const start = Date.parse('2026-11-14T15:00:00Z');
  const runs = [0, 1, 2, 3].map((m) => accountsFor(start + m * 60000).map((a) => a.handle));
  for (const handles of runs) {
    assert.equal(handles.length, 5); // 3 wires + 2 rotating
    for (const wire of ['reuters.com', 'apnews.com', 'cnn.com']) assert.ok(handles.includes(wire));
  }
  const covered = new Set(runs.flat());
  for (const h of ['afp.com', 'nbcnews.com', 'theguardian.com', 'nytimes.com', 'washingtonpost.com', 'news.sky.com', 'aljazeera.com', 'wsj.com']) {
    assert.ok(covered.has(h), h);
  }
});

const NOW = Date.parse('2026-11-14T13:47:00Z');
const MIN = 60000;

function wire(key, title, minutesAgo = 2) {
  return { key, source: 'Reuters', title, time: NOW - minutesAgo * MIN, maxAgeMs: 30 * MIN };
}

function memoryKv(initial) {
  const store = new Map(initial ? [['state', JSON.stringify(initial)]] : []);
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function harness(items, live = []) {
  const calls = [];
  return {
    calls,
    deps: {
      fetchSources: async () => ({ items, live, errors: [] }),
      dispatchPublish: async (_env, reason) => {
        calls.push(reason);
        return { dryRun: false };
      },
    },
  };
}

test('only fresh, unseen, severe items count as breaking', () => {
  const items = [
    wire('a', 'Suicide bomber kills 30 at crowded market in Kabul'),
    wire('b', 'Central bank holds interest rates steady'),
    wire('c', 'Suicide bomber kills 30 at crowded market in Kabul', 45),
    wire('d', 'Gunmen kill 25 villagers in attack on village in Burkina Faso'),
    { key: 'q', source: 'USGS', title: 'M7.4 earthquake — off Japan', time: NOW - 20 * MIN, maxAgeMs: 90 * MIN, severity: 4 },
  ];
  const found = findBreaking(items, { now: NOW, seen: new Set(['d']) });
  assert.deepEqual(found.map((f) => f.key).sort(), ['a', 'q']);
});

test('classification work per run is capped, newest first', () => {
  const items = Array.from({ length: 6 }, (_, i) => wire(`cap${i}`, `Gunmen kill ${20 + i} villagers in attack on village`, i + 1));
  const first = findBreaking(items, { now: NOW, seen: new Set(), maxClassify: 2 });
  assert.deepEqual(first.map((f) => f.key).sort(), ['cap0', 'cap1']);
  const second = findBreaking(items, { now: NOW, seen: new Set(['cap0', 'cap1']), maxClassify: 2 });
  assert.deepEqual(second.map((f) => f.key).sort(), ['cap2', 'cap3']);
});

test('a new breaking story dispatches a publish and is remembered', async () => {
  const kv = memoryKv();
  const { calls, deps } = harness([wire('a', 'Suicide bomber kills 30 at crowded market in Kabul')]);
  const first = await tick({ WATCHER_KV: kv }, NOW + 30000, deps);
  assert.equal(first.action, 'breaking');
  assert.match(calls[0], /^Breaking \(Reuters\): Suicide bomber/);

  const second = await tick({ WATCHER_KV: kv }, NOW + 4 * MIN + 30000, deps);
  assert.equal(second.action, 'none');
  assert.equal(calls.length, 1);
});

test('breaking publishes are spaced out, and held stories are retried', async () => {
  const kv = memoryKv({ seen: [], lastBreakingAt: NOW - 30000 });
  const { calls, deps } = harness([wire('a', 'Suicide bomber kills 30 at crowded market in Kabul')]);
  assert.equal((await tick({ WATCHER_KV: kv }, NOW + 1000, deps)).action, 'none');
  assert.equal((await tick({ WATCHER_KV: kv }, NOW + MIN + 1000, deps)).action, 'breaking');
  assert.equal(calls.length, 1);
});

test('routine nudge fires on the configured minute boundary only', async () => {
  const { calls, deps } = harness([wire('b', 'Central bank holds interest rates steady')]);
  const env = { WATCHER_KV: memoryKv(), NUDGE_MINUTES: '5' };
  const onBoundary = Date.parse('2026-11-14T13:45:00Z');
  assert.equal((await tick(env, onBoundary, deps)).action, 'nudge');
  assert.equal((await tick(env, onBoundary + MIN, deps)).action, 'none');
  assert.deepEqual(calls, ['Routine check']);
});

const LIVE = [
  {
    id: 'faa',
    title: 'U.S. flights resume after hours-long outage as FAA lifts nationwide ground stop',
    topics: [{ terms: { faa: 3.9, lifts: 4.4, ground: 2.9, stop: 3.1, nation: 2.8, flight: 2.8, us: 1.8 }, phrases: ['ground~stop', 'flight~us', 'ground~nation'], minScore: 3.8 }],
  },
];

test('a wire update on a live story publishes straight away, once', async () => {
  const kv = memoryKv();
  const items = [
    wire('bsky:u1', 'Airlines cancel thousands more flights after nationwide ground stop'),
    wire('bsky:u2', 'Central bank holds interest rates steady'),
  ];
  const { calls, deps } = harness(items, LIVE);
  const first = await tick({ WATCHER_KV: kv }, NOW + 1000, deps);
  assert.equal(first.action, 'live-update');
  assert.deepEqual(calls, ['Live update (Reuters): Airlines cancel thousands more flights after nationwide ground stop']);
  assert.equal((await tick({ WATCHER_KV: kv }, NOW + 2 * MIN + 1000, deps)).action, 'none');
});

test('headlines that only share common words with a live story are ignored', async () => {
  const { calls, deps } = harness([wire('bsky:u3', 'Storm causes flight cancellations across southern Europe')], LIVE);
  assert.equal((await tick({ WATCHER_KV: memoryKv() }, NOW + 1000, deps)).action, 'none');
  assert.equal(calls.length, 0);
});

test('without KV, breaking detection is off but nudges continue', async () => {
  const { calls, deps } = harness([wire('a', 'Suicide bomber kills 30 at crowded market in Kabul')]);
  const result = await tick({}, Date.parse('2026-11-14T13:50:00Z'), deps);
  assert.equal(result.action, 'nudge');
  assert.ok(result.warning);
  assert.deepEqual(calls, ['Routine check']);
});
