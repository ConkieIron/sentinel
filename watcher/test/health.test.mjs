import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tick } from '../src/index.js';
import { ALERT_REPEAT_MS, FORCE_GAP_MS } from '../src/health.js';

const MIN = 60000;
// Health checks run two minutes past each five-minute mark.
const CHECK = Date.parse('2026-11-14T14:02:00Z');
const env = (kv) => ({ WATCHER_KV: kv, SITE_URL: 'https://site.example', GITHUB_REPO: 'me/sentinel', NTFY_TOPIC: 'topic' });

function memoryKv() {
  const store = new Map();
  let writes = 0;
  return {
    store,
    get writes() {
      return writes;
    },
    async get(key, type) {
      const v = store.get(key);
      return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      writes++;
      store.set(key, value);
    },
  };
}

function harness({ editionAt, dispatchError = null } = {}) {
  const calls = { dispatch: [], alerts: [] };
  const deps = {
    fetchSources: async () => ({ items: [], live: [], errors: [] }),
    dispatchPublish: async (_env, reason, opts = {}) => {
      calls.dispatch.push({ reason, force: Boolean(opts.force) });
      if (dispatchError) throw new Error(dispatchError);
      return { dryRun: false };
    },
    siteAge: async () => {
      if (editionAt instanceof Error) throw editionAt;
      return editionAt;
    },
    notify: async (_env, title, message) => {
      calls.alerts.push({ title, message });
      return true;
    },
  };
  return { calls, deps };
}

test('a fresh site needs no action and writes nothing', async () => {
  const kv = memoryKv();
  const { calls, deps } = harness({ editionAt: CHECK - 20 * MIN });
  const result = await tick(env(kv), CHECK, deps);
  assert.deepEqual(result.site.actions, []);
  assert.equal(calls.dispatch.length, 0);
  assert.equal(calls.alerts.length, 0);
  assert.equal(kv.writes, 0);
});

test('a stale site forces a rebuild and alerts, without repeating every check', async () => {
  const kv = memoryKv();
  const h = harness({ editionAt: CHECK - 2 * 3600000 });
  const first = await tick(env(kv), CHECK, h.deps);
  assert.deepEqual(first.site.actions, ['forced-rebuild', 'alert']);
  assert.deepEqual(h.calls.dispatch, [{ reason: 'Stale site: The last edition was published 2 hours ago', force: true }]);
  assert.equal(h.calls.alerts[0].title, 'SENTINEL has stopped updating');
  assert.match(h.calls.alerts[0].message, /github\.com\/me\/sentinel\/actions/);

  const second = await tick(env(kv), CHECK + 5 * MIN, h.deps);
  assert.deepEqual(second.site.actions, [], 'no repeat within the gaps');

  const later = await tick(env(kv), CHECK + FORCE_GAP_MS, h.deps);
  assert.deepEqual(later.site.actions, ['forced-rebuild'], 'rebuild retried, alert not repeated yet');
  const muchLater = await tick(env(kv), CHECK + ALERT_REPEAT_MS, h.deps);
  assert.ok(muchLater.site.actions.includes('alert'), 'reminder after the repeat interval');
});

test('an all-clear is sent once the site updates again', async () => {
  const kv = memoryKv();
  await tick(env(kv), CHECK, harness({ editionAt: CHECK - 2 * 3600000 }).deps);
  const h = harness({ editionAt: CHECK + 3 * MIN });
  const result = await tick(env(kv), CHECK + 5 * MIN, h.deps);
  assert.deepEqual(result.site.actions, ['all-clear']);
  assert.equal(h.calls.alerts[0].title, 'SENTINEL is updating again');
  assert.deepEqual(JSON.parse(kv.store.get('state')).health, {});
});

test('an unreachable site is only reported after a grace period', async () => {
  const kv = memoryKv();
  const h = harness({ editionAt: new Error('Timed out after 8000ms') });
  assert.deepEqual((await tick(env(kv), CHECK, h.deps)).site.actions, []);
  assert.deepEqual((await tick(env(kv), CHECK + 5 * MIN, h.deps)).site.actions, []);
  const third = await tick(env(kv), CHECK + 10 * MIN, h.deps);
  assert.deepEqual(third.site.actions, ['forced-rebuild', 'alert']);
  assert.match(h.calls.alerts[0].message, /could not be reached \(Timed out/);
});

test('a refused publish request alerts once, with token advice, then an all-clear', async () => {
  const kv = memoryKv();
  const nudge = Date.parse('2026-11-14T14:05:00Z');
  const failing = harness({ dispatchError: 'GitHub dispatch failed: HTTP 401 Bad credentials' });
  await assert.rejects(tick(env(kv), nudge, failing.deps));
  await assert.rejects(tick(env(kv), nudge + 5 * MIN, failing.deps));
  assert.equal(failing.calls.alerts.length, 1, 'not repeated every nudge');
  assert.equal(failing.calls.alerts[0].title, 'SENTINEL cannot start publishes');
  assert.match(failing.calls.alerts[0].message, /wrangler secret put GITHUB_TOKEN/);

  const working = harness({});
  assert.equal((await tick(env(kv), nudge + 10 * MIN, working.deps)).action, 'nudge');
  assert.equal(working.calls.alerts[0].title, 'SENTINEL publishes are working again');
  assert.equal(JSON.parse(kv.store.get('state')).health.dispatchFailingSince, undefined);
});
