import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from '../src/sources/rss.js';

test('parses RSS 2.0 items with CDATA and entities', () => {
  const xml = `<?xml version="1.0"?><rss><channel><title>Feed</title>
    <item><title><![CDATA[Blast hits &amp; damages port]]></title>
      <link>https://example.com/a?x=1&amp;y=2</link>
      <description>&lt;p&gt;Several &lt;b&gt;injured&lt;/b&gt;&lt;/p&gt;</description>
      <pubDate>Sat, 14 Nov 2026 10:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const [item] = parseFeed(xml);
  assert.equal(item.title, 'Blast hits & damages port');
  assert.equal(item.url, 'https://example.com/a?x=1&y=2');
  assert.equal(item.summary, 'Several injured');
  assert.equal(item.time, Date.parse('2026-11-14T10:00:00Z'));
  assert.equal(item.coords, null);
});

test('parses Atom entries and georss points', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Cyclone nears coast</title>
      <link rel="alternate" href="https://example.org/c"/>
      <updated>2026-11-14T08:30:00Z</updated>
      <summary>Landfall expected</summary>
      <georss:point>12.5 80.25</georss:point></entry></feed>`;
  const [item] = parseFeed(xml);
  assert.equal(item.url, 'https://example.org/c');
  assert.deepEqual(item.coords, [12.5, 80.25]);
});

test('rejects non-http links', () => {
  const [item] = parseFeed('<rss><item><title>x</title><link>javascript:alert(1)</link></item></rss>');
  assert.equal(item.url, null);
});
