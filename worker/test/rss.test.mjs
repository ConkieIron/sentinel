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
  assert.equal(item.time, Date.parse('2026-11-14T08:30:00Z'));
  assert.equal(item.updated, Date.parse('2026-11-14T08:30:00Z'));
  assert.equal(item.published, null);
  assert.deepEqual(item.coords, [12.5, 80.25]);
});

test('Atom published stays separate from a later updated time', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Toll rises after blast</title>
      <link rel="alternate" href="https://example.org/blast"/>
      <published>2026-11-14T06:00:00Z</published>
      <updated>2026-11-14T10:00:00Z</updated>
    </entry></feed>`;
  const [item] = parseFeed(xml);
  assert.equal(item.published, Date.parse('2026-11-14T06:00:00Z'));
  assert.equal(item.updated, Date.parse('2026-11-14T10:00:00Z'));
  assert.equal(item.time, Date.parse('2026-11-14T10:00:00Z'));
});

test('rejects non-http links', () => {
  const [item] = parseFeed('<rss><item><title>x</title><link>javascript:alert(1)</link></item></rss>');
  assert.equal(item.url, null);
});

test('feed items carry their widest https picture', () => {
  const xml = `<rss><channel>
<item><title>BBC story</title><link>https://www.bbc.co.uk/news/1</link><pubDate>Sat, 14 Nov 2026 12:00:00 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/a/live/b.jpg"/></item>
<item><title>Guardian story</title><link>https://www.theguardian.com/world/2</link><pubDate>Sat, 14 Nov 2026 12:00:00 GMT</pubDate>
<media:content width="140" url="https://i.guim.co.uk/img/x.jpg?width=140&amp;s=1"/><media:content width="460" url="https://i.guim.co.uk/img/x.jpg?width=460&amp;s=2"/></item>
<item><title>Video and insecure picture</title><link>https://news.example/3</link><pubDate>Sat, 14 Nov 2026 12:00:00 GMT</pubDate>
<enclosure url="https://news.example/clip.mp4" type="video/mp4"/><media:content medium="image" url="http://news.example/p.jpg"/><media:content url="javascript:alert(1)"/></item>
</channel></rss>`;
  const [bbc, guardian, other] = parseFeed(xml);
  assert.deepEqual(bbc.image, { url: 'https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/a/live/b.jpg', width: 976 });
  assert.deepEqual(guardian.image, { url: 'https://i.guim.co.uk/img/x.jpg?width=460&s=2', width: 460 });
  assert.equal(other.image, null);
});
