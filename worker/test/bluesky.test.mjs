import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUsableSocialPost } from '../src/sources/bluesky.js';

test('eyewitness-style reports pass the social filter', () => {
  assert.ok(isUsableSocialPost('Explosion reported near the central station in Lyon, police have closed the surrounding streets and ambulances are arriving.', {}));
});

test('satire, jokes and satire accounts are kept out', () => {
  const ok = 'Police say three people were hurt in an explosion near the central station this morning, with roads closed nearby.';
  assert.ok(!isUsableSocialPost(ok, {}, 'theonion.com'));
  for (const text of [
    'Americans unable to determine whether Terror Attack, AI Deployment, Or Crumbling infrastructure cause of current catastrophe.',
    'In what may have been the largest cyber terror attack in American history, no one could track down the president today.',
    'Area man declares war on the leaf blower next door after third early morning attack this week, police say.',
    'Huge explosion downtown as the city council finally approves the new bus lane after six years of fighting /s',
  ])
    assert.ok(!isUsableSocialPost(text, {}), text);
});
