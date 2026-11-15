import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leanFor, leanLabel, LEAN } from '../src/data/mediaLean.js';

test('known outlets resolve to an editorial lean', () => {
  assert.equal(leanFor('Reuters'), 'wire');
  assert.equal(leanFor('Associated Press'), 'wire');
  assert.equal(leanFor('BBC News'), 'center');
  assert.equal(leanFor('The Guardian'), 'left');
  assert.equal(leanFor('The New York Times'), 'center-left');
  assert.equal(leanFor('The Times of Israel'), 'center-right');
  assert.equal(leanFor('The Wall Street Journal'), 'center-right');
  assert.equal(leanFor('The Telegraph'), 'center-right');
  assert.equal(leanFor('The Australian'), 'center-right');
  assert.equal(leanFor('Fox News'), 'right');
  assert.equal(leanFor('New York Post'), 'right');
  assert.equal(leanFor('Al Jazeera'), 'center-left');
  assert.equal(leanFor('Deutsche Welle'), 'state');
  assert.equal(leanFor('USGS'), 'official');
});

test('Bluesky and top-story suffixes still resolve', () => {
  assert.equal(leanFor('CNN (Bluesky)'), 'center-left');
  assert.equal(leanFor('BBC News (top stories)'), 'center');
  assert.equal(leanFor('Bluesky · @someone.bsky.social'), 'unrated');
});

test('lean labels are human-readable', () => {
  assert.equal(leanLabel('center-left'), 'Centre-left');
  assert.equal(leanLabel('wire'), 'Wire');
  assert.ok(LEAN.center);
});
