import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paraphraseSnapshot, templateParaphrase, PARA_MODEL } from '../src/analysis/paraphrase.js';

function memoryKv(store = {}) {
  return {
    async get(key, type) {
      const v = store[key];
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store[key] = value;
    },
    store,
  };
}

const baseIncident = {
  id: 'a1',
  title: 'Blast rocks capital as officials confirm rising toll',
  summary: 'Emergency crews are searching rubble after an explosion in the city centre.',
  category: 'attack',
  severity: 4,
  location: { country: 'Testland', place: 'Testville' },
};

test('templateParaphrase never echoes publisher wording', () => {
  const out = templateParaphrase(baseIncident);
  assert.match(out.title, /Violent attack/i);
  assert.match(out.title, /Testville/);
  assert.doesNotMatch(out.title, /Blast rocks/);
  assert.doesNotMatch(out.summary, /searching rubble/);
});

test('without AI, publisher copy is replaced by templates', async () => {
  const snapshot = {
    incidents: [{ ...baseIncident }],
    live: [],
  };
  const kv = memoryKv();
  const stats = await paraphraseSnapshot(snapshot, { SENTINEL_KV: kv });
  assert.equal(stats.paraphrased, 1);
  assert.ok(stats.paraphraseSkipped >= 1);
  assert.doesNotMatch(snapshot.incidents[0].title, /Blast rocks/);
  assert.doesNotMatch(snapshot.incidents[0].summary, /searching rubble/);
  // Templates are not cached when AI is off, so enabling AI later can rewrite immediately.
  assert.equal(Object.keys(kv.store).length, 0);
});

test('AI rewrite replaces title and summary and is cached', async () => {
  const snapshot = {
    incidents: [{ ...baseIncident }],
    live: [],
  };
  const kv = memoryKv();
  let calls = 0;
  const env = {
    SENTINEL_KV: kv,
    AI: {
      async run(model, { messages }) {
        calls++;
        assert.equal(model, PARA_MODEL);
        assert.ok(messages.some((m) => m.role === 'system'));
        return { response: '{"title":"Explosion reported in Testville","summary":"An explosion was reported in the city centre."}' };
      },
    },
  };
  const first = await paraphraseSnapshot(snapshot, env);
  assert.equal(first.paraphrased, 1);
  assert.equal(first.paraphraseCacheHits, 0);
  assert.equal(calls, 1);
  assert.equal(snapshot.incidents[0].title, 'Explosion reported in Testville');
  assert.equal(snapshot.incidents[0].summary, 'An explosion was reported in the city centre.');

  const again = {
    incidents: [{ ...baseIncident }],
    live: [],
  };
  const second = await paraphraseSnapshot(again, env);
  assert.equal(second.paraphraseCacheHits, 1);
  assert.equal(calls, 1);
  assert.equal(again.incidents[0].title, 'Explosion reported in Testville');
});

test('AI failure falls back to template, not the original summary', async () => {
  const snapshot = {
    incidents: [{ ...baseIncident }],
    live: [],
  };
  const stats = await paraphraseSnapshot(snapshot, {
    SENTINEL_KV: memoryKv(),
    AI: {
      async run() {
        throw new Error('boom');
      },
    },
  });
  assert.equal(stats.paraphraseErrors, 1);
  assert.doesNotMatch(snapshot.incidents[0].title, /Blast rocks/);
  assert.doesNotMatch(snapshot.incidents[0].summary, /searching rubble/);
  assert.match(snapshot.incidents[0].summary, /Severity 4\/5/);
});

test('live story titles are paraphrased; update rows are left for now', async () => {
  const snapshot = {
    incidents: [],
    live: [
      {
        id: 'live1',
        title: 'Exclusive: dramatic scenes as fire spreads downtown',
        summary: 'Witnesses describe chaos as flames leap between buildings.',
        category: 'disaster',
        severity: 4,
        location: { country: 'Testland', place: 'Downtown' },
        updates: [
          {
            title: 'LIVE blog: firefighters battle blaze hour by hour',
            summary: 'Our reporter is on the scene with minute-by-minute updates.',
            source: 'BBC News',
            url: 'https://example.com/1',
            time: 1,
          },
        ],
      },
    ],
  };
  await paraphraseSnapshot(snapshot, {
    SENTINEL_KV: memoryKv(),
    AI: {
      async run() {
        return { response: '{"title":"Fire spreads in downtown Testland","summary":"A fire was reported spreading between buildings."}' };
      },
    },
  });
  assert.equal(snapshot.live[0].title, 'Fire spreads in downtown Testland');
  assert.doesNotMatch(snapshot.live[0].summary, /Witnesses describe chaos/);
  assert.equal(snapshot.live[0].updates[0].title, 'LIVE blog: firefighters battle blaze hour by hour');
});
