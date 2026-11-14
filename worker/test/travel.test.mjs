import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFcdo, parseUsAdvisories, refreshTravelAdvice, travelForSnapshot, TRAVEL_REFRESH_MS } from '../src/sources/travel.js';

const child = (name, slug, synonyms = []) => ({
  base_path: `/foreign-travel-advice/${slug}`,
  public_updated_at: '2026-10-02T08:30:25Z',
  details: { change_description: `Update for ${name}`, country: { name, slug, synonyms } },
});

test('FCDO pages map to countries by exact name before any looser match', () => {
  const out = parseFcdo({
    links: {
      children: [
        child('Congo', 'congo'),
        child('Democratic Republic of the Congo', 'democratic-republic-of-the-congo'),
        child('St Kitts and Nevis', 'st-kitts-and-nevis'),
        child('Antarctica/British Antarctic Territory', 'antarctica-british-antarctic-territory'),
        child('Ukraine', 'ukraine'),
      ],
    },
  });
  assert.equal(out.COG.url, 'https://www.gov.uk/foreign-travel-advice/congo');
  assert.equal(out.COD.url, 'https://www.gov.uk/foreign-travel-advice/democratic-republic-of-the-congo');
  assert.equal(out.KNA.url, 'https://www.gov.uk/foreign-travel-advice/st-kitts-and-nevis');
  assert.equal(out.UKR.change, 'Update for Ukraine');
  assert.equal(out.GBR, undefined, 'no FCDO advice for the UK itself');
});

test('US advisories are read from the feed, keyed by the code in each link', () => {
  const xml = `<rss><channel>
<item><title>Iran - Level 4: Do Not Travel</title><link>https://travel.state.gov/content/x/destination.irn.html</link><pubDate>Fri, 23 Oct 2026</pubDate></item>
<item><title>Israel, the West Bank and Gaza - Level 3: Reconsider Travel</title><link>https://travel.state.gov/content/x/destination.isr.html</link></item>
<item><title>Tonga - Level 1: Exercise Normal Precautions</title><link>https://travel.state.gov/content/x/tonga-travel-advisory.html</link></item>
<item><title>Not an advisory</title><link>https://travel.state.gov/content/x/other.html</link></item>
</channel></rss>`;
  const out = parseUsAdvisories(xml);
  assert.deepEqual(Object.keys(out).sort(), ['IRN', 'ISR', 'TON']);
  assert.equal(out.IRN.level, 4);
  assert.equal(out.IRN.label, 'Do Not Travel');
  assert.equal(out.TON.level, 1);
});

test('cached advice is reused until it is due a refresh', async () => {
  const now = Date.parse('2026-11-14T12:00:00Z');
  const cached = { fetchedAt: now - TRAVEL_REFRESH_MS + 60000, fcdo: {}, us: {} };
  assert.equal(await refreshTravelAdvice(cached, now), cached);
});

test('the snapshot carries advice for countries in the news and US "Do not travel" countries', () => {
  const advice = {
    fcdo: { FRA: { url: 'https://www.gov.uk/foreign-travel-advice/france' }, NOR: { url: 'https://www.gov.uk/foreign-travel-advice/norway' } },
    us: { FRA: { level: 2, label: 'Exercise Increased Caution' }, YEM: { level: 4, label: 'Do Not Travel' }, NOR: { level: 1, label: 'Exercise Normal Precautions' } },
  };
  const out = travelForSnapshot(advice, [{ location: { iso3: 'FRA' } }, { location: null }]);
  assert.deepEqual(Object.keys(out).sort(), ['FRA', 'YEM']);
  assert.equal(out.FRA.name, 'France');
  assert.ok(out.FRA.region);
});
