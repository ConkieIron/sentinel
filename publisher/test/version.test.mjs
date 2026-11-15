import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumpPatch } from '../src/version.js';

test('bumpPatch adds 0.0.1', () => {
  assert.equal(bumpPatch('1.1.0'), '1.1.1');
  assert.equal(bumpPatch('1.1.9'), '1.1.10');
  assert.equal(bumpPatch('v2.0.0'), '2.0.1');
  assert.equal(bumpPatch('0.0.0'), '0.0.1');
});
