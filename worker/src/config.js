// Source registry and tunable model parameters for the SENTINEL data gatherer.
// All sources are free, public and require no API key.

export const RSS_FEEDS = [
  { id: 'bbc', name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', home: 'https://www.bbc.co.uk/news/world' },
  { id: 'aljazeera', name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', home: 'https://www.aljazeera.com' },
  { id: 'skynews', name: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/world.xml', home: 'https://news.sky.com/world' },
  { id: 'guardian', name: 'The Guardian', url: 'https://www.theguardian.com/world/rss', home: 'https://www.theguardian.com/world' },
  { id: 'france24', name: 'France 24', url: 'https://www.france24.com/en/rss', home: 'https://www.france24.com/en/' },
  { id: 'dw', name: 'Deutsche Welle', url: 'https://rss.dw.com/xml/rss-en-world', home: 'https://www.dw.com/en/' },
  { id: 'euronews', name: 'Euronews', url: 'https://www.euronews.com/rss?format=mrss&level=theme&name=news', home: 'https://www.euronews.com' },
  { id: 'nyt', name: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', home: 'https://www.nytimes.com/section/world' },
  { id: 'npr', name: 'NPR', url: 'https://feeds.npr.org/1004/rss.xml', home: 'https://www.npr.org/sections/world/' },
  { id: 'wapo', name: 'The Washington Post', url: 'https://feeds.washingtonpost.com/rss/world', home: 'https://www.washingtonpost.com/world/' },
  { id: 'abcau', name: 'ABC News (Australia)', url: 'https://www.abc.net.au/news/feed/2942460/rss.xml', home: 'https://www.abc.net.au/news' },
  { id: 'cna', name: 'CNA (Asia)', url: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6311', home: 'https://www.channelnewsasia.com/world' },
  { id: 'rfi', name: 'RFI', url: 'https://www.rfi.fr/en/rss', home: 'https://www.rfi.fr/en/' },
  { id: 'africanews', name: 'Africanews', url: 'https://www.africanews.com/feed/rss', home: 'https://www.africanews.com' },
  { id: 'thehindu', name: 'The Hindu', url: 'https://www.thehindu.com/news/international/feeder/default.rss', home: 'https://www.thehindu.com/news/international/' },
  // Top-story feeds carry major domestic incidents the world feeds leave out. They share the
  // outlet name so a story is not counted as two outlets; `label` names them on the sources list.
  { id: 'bbc-top', name: 'BBC News', label: 'BBC News (top stories)', url: 'https://feeds.bbci.co.uk/news/rss.xml', home: 'https://www.bbc.co.uk/news' },
  { id: 'skynews-top', name: 'Sky News', label: 'Sky News (top stories)', url: 'https://feeds.skynews.com/feeds/rss/home.xml', home: 'https://news.sky.com' },
  { id: 'independent', name: 'The Independent', url: 'https://www.independent.co.uk/news/world/rss', home: 'https://www.independent.co.uk/news/world' },
  { id: 'irishtimes', name: 'The Irish Times', url: 'https://www.irishtimes.com/arc/outboundfeeds/feed-world/?outputType=xml', home: 'https://www.irishtimes.com/world/' },
  { id: 'cbs', name: 'CBS News', url: 'https://www.cbsnews.com/latest/rss/world', home: 'https://www.cbsnews.com/world/' },
  { id: 'abcus', name: 'ABC News (US)', url: 'https://abcnews.go.com/abcnews/internationalheadlines', home: 'https://abcnews.go.com/International' },
  { id: 'latimes', name: 'Los Angeles Times', url: 'https://www.latimes.com/world-nation/rss2.0.xml', home: 'https://www.latimes.com/world-nation' },
  { id: 'kyivindependent', name: 'The Kyiv Independent', url: 'https://kyivindependent.com/news-archive/rss/', home: 'https://kyivindependent.com' },
  { id: 'timesofisrael', name: 'The Times of Israel', url: 'https://www.timesofisrael.com/feed/', home: 'https://www.timesofisrael.com' },
  { id: 'mee', name: 'Middle East Eye', url: 'https://www.middleeasteye.net/rss', home: 'https://www.middleeasteye.net' },
  { id: 'dawn', name: 'Dawn (Pakistan)', url: 'https://www.dawn.com/feeds/home', home: 'https://www.dawn.com' },
  { id: 'toi', name: 'The Times of India', url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', home: 'https://timesofindia.indiatimes.com/world' },
  { id: 'scmp', name: 'South China Morning Post', url: 'https://www.scmp.com/rss/91/feed', home: 'https://www.scmp.com/news/world' },
  { id: 'japantimes', name: 'The Japan Times', url: 'https://www.japantimes.co.jp/feed/', home: 'https://www.japantimes.co.jp' },
  { id: 'smh', name: 'The Sydney Morning Herald', url: 'https://www.smh.com.au/rss/world.xml', home: 'https://www.smh.com.au/world' },
  { id: 'premiumtimes', name: 'Premium Times (Nigeria)', url: 'https://www.premiumtimesng.com/feed', home: 'https://www.premiumtimesng.com' },
];

// Official news-organisation accounts on Bluesky. Treated as publisher reports, not social claims.
// CNN's public RSS feeds stopped updating in 2023, so CNN coverage comes from its official account.
export const BLUESKY_PUBLISHERS = [
  { id: 'bsky-cnn', handle: 'cnn.com', name: 'CNN' },
  { id: 'bsky-reuters', handle: 'reuters.com', name: 'Reuters' },
  { id: 'bsky-ap', handle: 'apnews.com', name: 'Associated Press' },
  { id: 'bsky-afp', handle: 'afp.com', name: 'AFP' },
  { id: 'bsky-nbc', handle: 'nbcnews.com', name: 'NBC News' },
  { id: 'bsky-bloomberg', handle: 'bloomberg.com', name: 'Bloomberg' },
  { id: 'bsky-usatoday', handle: 'usatoday.com', name: 'USA Today' },
  { id: 'bsky-politico', handle: 'politico.com', name: 'Politico' },
];

// Keyword searches across public Bluesky posts. Results are labelled UNVERIFIED and are
// down-weighted heavily; they can never trigger the breaking banner on their own.
export const BLUESKY_SEARCHES = [
  'terror attack',
  'suicide bombing',
  'explosion killed',
  'gunmen attack',
  'airstrike killed',
  'mass shooting',
];

export const USGS_FEED = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson';
export const GDACS_FEED = 'https://www.gdacs.org/xml/rss.xml';

export const MODEL = {
  windowHours: 72,
  maxItemsPerFeed: 40,
  maxIncidents: 400,
  maxSocialIncidents: 40,
  recencyHalfLifeHours: 24,
  // Weight of a single incident by severity (1–5). Super-linear so major events dominate.
  severityWeight: [0, 1, 2, 4, 7, 11],
  categoryWeight: {
    terrorism: 1.6,
    conflict: 1.4,
    attack: 1.3,
    unrest: 1.0,
    disaster: 0.9,
    infrastructure: 0.8,
    health: 0.8,
    transport: 0.6,
    strategic: 0.55,
  },
  evidenceWeight: { official: 1.0, multi: 1.25, publisher: 1.0, social: 0.25 },
  // Within a region, the n-th heaviest incident counts diminishingReturns^(n-1), so many minor
  // stories (a function of media volume) cannot outweigh a few severe ones.
  diminishingReturns: 0.88,
  // Regions are levelled relative to the most active region: index = √(score / top score).
  // 0.75 ≈ 56% of the top score; 0.4 ≈ 16% of the top score.
  highRelative: 0.75,
  mediumRelative: 0.4,
  // …but must also clear absolute floors so a quiet world is not painted red.
  highFloor: 14,
  mediumFloor: 4,
  historyHours: 24 * 7,
};

export const USER_AGENT = 'SentinelGlobalNews/1.0 (+https://sentinelglobalnews.pages.dev; public incident monitor)';
