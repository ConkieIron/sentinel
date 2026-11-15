import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactHeadline, truncate } from '../src/lib/text.js';

test('short headlines are left alone', () => {
  assert.equal(compactHeadline('FAA lifts nationwide ground stop on all US flights'), 'FAA lifts nationwide ground stop on all US flights');
});

test('lede-style titles are compacted to the buried news clause', () => {
  const lede =
    'Travelers at airports around the country were stuck in limbo for hours after a “temporary telecommunications outage” led the Federal Aviation Administration to declare a nationwide ground stop on Nov. 13. : Reuters…';
  const out = compactHeadline(lede);
  assert.ok(out.length <= 110, `too long: ${out.length} ${out}`);
  assert.match(out, /Federal Aviation Administration.*nationwide ground stop/i);
  assert.doesNotMatch(out, /stuck in limbo|Reuters/i);
});

test('wire attribution tails are stripped', () => {
  assert.equal(compactHeadline('Blast hits port city : Reuters…'), 'Blast hits port city');
});

test('truncate still cuts on a word boundary', () => {
  assert.equal(truncate('one two three four five', 12), 'one two…');
});

test('eventTimeFromTitle reads on Nov. 13 and effectiveItemTime prefers it over a later post', async () => {
  const { eventTimeFromTitle, effectiveItemTime } = await import('../src/lib/text.js');
  const now = Date.parse('2026-11-15T12:00:00Z');
  const event = eventTimeFromTitle(
    'Travelers stuck in limbo after a temporary outage led the FAA to declare a nationwide ground stop on Nov. 13.',
    now,
  );
  assert.equal(event, Date.UTC(2026, 10, 13, 12, 0, 0));
  const published = Date.parse('2026-11-15T11:20:00Z');
  assert.equal(effectiveItemTime('FAA ground stop on Nov. 13', published, now), event);
  assert.equal(
    effectiveItemTime('FAA lifts nationwide ground stop on all US flights', published, now),
    published,
    'no calendar day → keep publish time',
  );
});
