# SENTINEL — Global Incident & Threat Monitor

A public, mobile-first news site that tracks world incidents and suspected terrorism, with a
map of regional threat levels (Low / Medium / High). The site is plain static HTML, rebuilt on a
schedule. Nothing is served from a database at request time.

```
           every 15 min                          every ~2 h (or on breaking news)
┌───────────────────────────┐   deploy hook   ┌──────────────────────────────┐
│  worker/  (Cloudflare     │ ──────────────▶ │  publisher/  (Cloudflare     │
│  Worker: data gatherer)   │                 │  Pages: static HTML build)   │
│                           │ ◀────────────── │                              │
│  RSS · Bluesky · USGS ·   │  GET /snapshot  │  node build.mjs → dist/      │
│  GDACS → classify → geo → │      .json      │  home · regions · terrorism  │
│  cluster → threat index   │                 │  · methodology · 404         │
│  KV: snapshot + history   │                 │                              │
└───────────────────────────┘                 └──────────────────────────────┘
```

The two components only share one contract: the snapshot JSON (`schema: 1`). Each can be run
and tested on its own.

## Repository layout

| Path | What it is |
| --- | --- |
| `worker/` | Cloudflare Worker. Cron gathers feeds, scores regions, stores the snapshot in KV, triggers a Pages rebuild. |
| `publisher/` | Dependency-free Node build that turns a snapshot into static HTML in `publisher/dist`. |
| `publisher/fixtures/sample-snapshot.json` | A real snapshot for offline builds and tests. |
| `watcher/` | Tiny Cloudflare Worker that starts the GitHub publish workflow within a minute of major breaking news. |
| `tools/build-geodata.mjs` | One-off generator for the country gazetteer and SVG basemap (Natural Earth, public domain). |
| `.github/workflows/publish-pages.yml` | Optional scheduled build + Direct Upload deploy. |
| `data/` | Local gather output (git-ignored). |

## Sources

- **RSS:** BBC News (world and top stories), Al Jazeera, Sky News (world and top stories),
  The Guardian, France 24, Deutsche Welle, Euronews, The New York Times, NPR, The Washington Post,
  ABC News (Australia), CNA, RFI, Africanews, The Hindu, The Independent, The Irish Times,
  CBS News, ABC News (US), Los Angeles Times, The Kyiv Independent, The Times of Israel,
  Middle East Eye, Dawn (Pakistan), The Times of India, South China Morning Post, The Japan Times,
  The Sydney Morning Herald and Premium Times (Nigeria).
- **Bluesky:** official accounts of CNN, Reuters, AP, AFP, NBC News, Bloomberg, USA Today and
  Politico. These outlets have no usable public RSS feed for world news, so their accounts are
  used instead. There is also a filtered public search,
  which is treated as unverified and weighted at a quarter.
- **Official:** USGS earthquakes (M5+ or PAGER alert) and GDACS Orange/Red disaster alerts.
- **Markets (masthead ticker):** FTSE 100, Dow Jones and S&P 500 from Yahoo Finance's public
  chart data (no key, one request per gather, quotes delayed up to 15 minutes at source). While a
  market is open the site republishes at least every 15 minutes; if the request fails the ticker
  is simply left out. Indices are listed in `worker/src/sources/markets.js`.

- **Official travel advice (region pages):** the UK FCDO index from the GOV.UK content API and
  the US State Department's advisory feed. Two requests cover every country, re-fetched every
  6 hours and cached in the gatherer's state. Each region page lists the countries in its news,
  plus any the US rates Level 4 "Do not travel", with links to both governments' pages. Code is
  in `worker/src/sources/travel.js`.

Public Bluesky search posts that read as satire or jokes ("news at 11", "area man", satire
accounts) are dropped. The Global terror page lists only reports from news outlets and official
sources; unverified social posts and anniversaries or trials appear in collapsed sections below.

Add or remove feeds in `worker/src/config.js`. An outlet with two feeds (BBC, Sky) uses the same
`name` on both, so a story is counted once per outlet; `label` tells them apart on the sources
list. Repeat headlines from the same outlet are dropped.

## How the threat index works

1. Every report is classified by its headline into one of eight categories: Suspected terrorism,
   Violent attack, Armed conflict, Civil unrest, Natural disaster, Cyber & infrastructure,
   Health emergency, Major accident. Each report gets a severity from 1 to 5 based on reported
   casualties and escalation language.
2. Reports are located with a gazetteer (countries, cities, aliases) and clustered into
   incidents across outlets.
3. Each incident gets a weight: severity × category × evidence (official, multiple outlets,
   single outlet, unverified social) × 24-hour recency half-life.
4. Each region's score sums its incidents, heaviest first, with diminishing returns. This stops
   heavy media coverage of one country from inflating its region.
5. Levels are **relative**. Each region is compared with the busiest region on a square-root
   scale. High needs ≥ 0.75 of the busiest region and a score of at least 14. Medium needs ≥ 0.4
   and a score of at least 4. The absolute floors stop a quiet news day from showing High anywhere.

All weights and thresholds are in `MODEL` in `worker/src/config.js`. The site's
Methodology page explains the model to readers.

## Live coverage of developing stories

`worker/src/analysis/live.js` picks up to three major developing stories, such as a nationwide
flight ground stop. A story qualifies when at least 3 outlets have reported it and the newest
report is under 3 hours old. Each story gets a BBC-style page at `/live/<id>/` with every outlet's
report, newest first, each linking to the original article. The front page shows these stories at
the top, above the headlines. The leading one is tagged "Breaking" and the others "Live"; there is
no separate breaking-news banner.

A story's title is the newest straight news headline from the last two hours, preferring major
outlets (BBC, Reuters, AP, Sky, Guardian, CNN and others). So it follows events ("flights resume")
rather than the first report. Explainers, questions, "what we know", live-blog and video teasers,
and two-sentence feature headlines never become the title. The standfirst comes from an outlet's
website, because Bluesky link cards often describe a different article.

Reports are matched by vocabulary, not by the incident classifier, so follow-ups like "airlines
clear backlog" are included:
- Words are weighted by how rare they are across everything gathered, so "FAA" counts for far more
  than "flights".
- A report must also share a word pair with the story ("ground stop", "global outage"), plus a
  third word unless the pair is one the story's coverage keeps repeating. That stops a stock
  phrase in the lead headline ("demand answers") from pulling in unrelated reports.
- Pairs made only of place names, seats of government or the most-reported leaders
  ("Russia … Ukraine", "White House", "Trump … Putin") never count, because they appear in a lot
  of unrelated news.
- Stories that pick up the same reports are merged.

Every new report on a live story counts as a new edition, so it publishes on the next run. The
watcher (below) also starts a run as soon as one of the outlets it follows posts a matching update. Open live
pages check for a new edition every minute and show a "3 new updates · Refresh" button.
Thresholds are in `LIVE` in `worker/src/analysis/live.js`.

## Local testing

Requires Node 20+. On this machine Node is installed at `~/.local/node`:

```bash
export PATH="$HOME/.local/node/bin:$PATH"
```

### Quick start (no Cloudflare tooling)

```bash
npm test             # unit tests for both components
npm run gather       # runs the Worker pipeline in Node → data/snapshot.json
npm run build        # publisher → publisher/dist
npm run serve        # http://localhost:8788
```

`npm run local` runs all three. `npm run build:sample` builds from the bundled fixture without
any network access.

### Worker in the real Workers runtime

```bash
cd worker
npm install
cp .dev.vars.example .dev.vars
npm run dev                       # wrangler dev on http://localhost:8787 (simulated KV)
npm run trigger                   # fires the cron handler once
curl localhost:8787/health        # per-source status
curl -X POST -H "Authorization: Bearer local-dev-token" localhost:8787/run
```

Then build the publisher straight from the local Worker:

```bash
SNAPSHOT_URL=http://127.0.0.1:8787/snapshot.json npm --prefix publisher run build
```

`npm --prefix publisher run preview` serves `dist/` with `wrangler pages dev`, so `_headers`
(CSP and caching) are applied as on Cloudflare.

### Worker endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /snapshot.json` | Latest snapshot (the publisher's input). Returns 503 until the first gather. |
| `GET /health` | Last run time, duration, publish status and per-source results. |
| `POST /run` | Runs a gather now. Requires `Authorization: Bearer $RUN_TOKEN`; disabled if the secret is unset. |

## Deploying to Cloudflare

### 1. Worker (data gatherer)

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create SENTINEL_KV   # paste the id into wrangler.toml
npx wrangler secret put RUN_TOKEN              # any long random string
npm run deploy
```

**Plan:** the gatherer parses about 600 reports every run. That needs a few hundred
milliseconds of CPU, well above the Workers Free limit of 10 ms per invocation. Use **Workers
Paid** ($5/month, 30 s CPU per invocation by default). If you want to stay on the free plan,
skip the Worker and use the GitHub Action in step 3 in "gather here" mode.

### 2. Pages (publisher), Git-connected

1. Push this repo to GitHub or GitLab.
2. In Cloudflare go to Workers & Pages → Create → Pages → Connect to Git.
3. Use these build settings:
   - Root directory: `publisher`
   - Build command: `node build.mjs`
   - Build output: `dist`
4. Add these environment variables:
   - `SNAPSHOT_URL` = `https://sentinel-gatherer.<your-subdomain>.workers.dev/snapshot.json`
   - `SITE_URL` = your site URL (optional)
5. Go to Settings → Builds → Deploy hooks and create a hook for the `main` branch. Give it to
   the Worker:

   ```bash
   cd worker && npx wrangler secret put PAGES_DEPLOY_HOOK
   ```

The Worker gathers every 15 minutes. It calls the deploy hook at most every
`PUBLISH_INTERVAL_MINUTES` (default 120). A new severity-4 or severity-5 breaking incident can
publish early, but no more often than every `BREAKING_PUBLISH_MINUTES` (default 20). This keeps
the site within the Pages Free limit of 500 builds a month.

If a build can't fetch a valid snapshot, or the snapshot is more than 12 hours old, the build
fails. Pages then keeps serving the last good deployment.

### 3. Free alternative: GitHub Action with Direct Upload

`.github/workflows/publish-pages.yml` runs every 5 minutes. That is GitHub's minimum, and runs can
be delayed when GitHub is busy. Each run gathers and builds, then
`publisher/scripts/should-deploy.mjs` compares the new edition's fingerprint (region levels,
severity-3+ incidents, reports on live stories) with the live `/data/meta.json`. It uploads only when that
changed, or when the live edition is older than `HEARTBEAT_MINUTES` (default 60). Uploads made with
Wrangler don't count toward the Pages build limit. A build where fewer than half the sources
answered is refused, so a network blip can't publish an empty site.

Use a public repository, where Actions minutes are unlimited; a private repo would use up its
2,000 free minutes within days. GitHub turns off scheduled workflows after 60 days with no repo
activity. Re-enable them from the Actions tab. To force a deploy, run the workflow manually with
"Deploy even if nothing changed" ticked.

To use it:

1. Add the secrets `CLOUDFLARE_API_TOKEN` (with "Cloudflare Pages: Edit") and
   `CLOUDFLARE_ACCOUNT_ID`.
2. Set the variable `SNAPSHOT_URL` to build from the Worker.
3. Or leave `SNAPSHOT_URL` unset to run the gatherer inside the Action ("gather here" mode).
   This needs no Worker at all, and the trend history is kept in the Actions cache.
4. Optionally set `PAGES_PROJECT` and `SITE_URL`.

This works with both Direct Upload and Git-connected Pages projects. If your project is
Git-connected, turn off its automatic builds so they don't compete with the Action. You can also
run `npm run pages:deploy` locally after `npm run build`.

### 4. Breaking-news watcher (optional, free)

GitHub's 5-minute schedule is a minimum and is often late. `watcher/` is a separate Worker that
runs every minute on the Workers Free plan. It reads the latest Reuters, AP and CNN posts on Bluesky
every minute, plus two of AFP, NBC News, The Guardian, The New York Times, The Washington Post,
Sky News and Al Jazeera in rotation (each every 3–4 minutes, which keeps a run within the free
plan's 10ms CPU limit), and USGS earthquakes from the last hour. Any new headline goes through the
shared classifier.
When something rates severity 4 or above (`BREAKING_MIN_SEVERITY`), it starts the publish workflow
straight away through GitHub's `workflow_dispatch` API, so major news is live in about 2 minutes.
It does the same when a new wire post matches a story the site is covering live. It reads those
stories' topics from the published `SITE_URL/data/live.json`. Every `NUDGE_MINUTES` (5) it also
starts a routine run, which keeps the cadence steady when GitHub's schedule slips. The workflow
still deploys only when the edition changed.

Fast publishes (breaking or live) are at least 90 seconds apart. KV remembers which posts already
triggered one, and is written only when that happens, well inside the free 1,000 writes a day.
Each run classifies at most 20 new headlines, so it stays within the 10ms CPU limit.

To set it up, run these in `watcher/`:

1. Create a fine-grained GitHub token (Settings → Developer settings → Fine-grained tokens) for
   this repository only, with the permission **Actions: Read and write** and nothing else.
2. Run `npx wrangler@4 login`.
3. Run `npx wrangler@4 kv namespace create WATCHER_KV --binding WATCHER_KV --update-config`.
4. Run `npx wrangler@4 secret put GITHUB_TOKEN` and paste the token.
5. Run `npx wrangler@4 deploy`.

**Site health alerts.** Every `HEALTH_MINUTES` (5) the watcher reads the live
`SITE_URL/data/meta.json`. If the edition is older than `STALE_MINUTES` (90, longer than the
60-minute heartbeat), or the site can't be reached for 10 minutes, it starts the workflow with
`force` (at most every 30 minutes) and sends an alert. It also alerts when GitHub refuses its
publish requests, which usually means `GITHUB_TOKEN` has expired. Repeat alerts are at most every
3 hours, and an all-clear is sent when things recover. Alerts go through [ntfy](https://ntfy.sh),
which is free and needs no account:

1. Install the ntfy app (iOS or Android) and subscribe to a private, hard-to-guess topic name.
2. In `watcher/`, run `npx wrangler@4 secret put NTFY_TOPIC` and enter that topic name.
3. Optional: run `npx wrangler@4 secret put ALERT_EMAIL` to also get each alert by email.

The watcher can't report its own outage. If it stops, GitHub's schedule keeps publishing, just
less promptly.

To check it, open the worker's `workers.dev` URL. It shows its status, the live edition's age and
any current problem. Runs it starts appear in
the Actions tab named `Breaking (Reuters): …` or `Routine check`. `npm run tail` streams its logs.

For local testing, copy `.dev.vars.example` to `.dev.vars` (`DRY_RUN=true` logs instead of calling
GitHub). Then run `npm run dev`, and in another terminal `npm run trigger`. `npm test` covers the
detection, de-duplication, spacing and nudge logic.

## Secrets

Never commit secrets. `worker/.dev.vars` and `watcher/.dev.vars` are git-ignored.

| Name | Where | Purpose |
| --- | --- | --- |
| `RUN_TOKEN` | Worker secret | Protects `POST /run`. |
| `PAGES_DEPLOY_HOOK` | Worker secret | Triggers a Pages rebuild. |
| `BSKY_HANDLE`, `BSKY_APP_PASSWORD` | Worker secret (optional) | Only needed if Bluesky public search starts requiring auth. Use an app password, not your main password. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | GitHub secrets | Only for the GitHub Action. |
| `GITHUB_TOKEN` | Watcher secret | Fine-grained token, "Actions: Read and write" on this repo only. Starts the publish workflow. |
| `NTFY_TOPIC` | Watcher secret | Private ntfy.sh topic for site health alerts. Anyone who knows it can read the alerts, so keep it unguessable. |
| `ALERT_EMAIL` | Watcher secret (optional) | Also sends each alert to this address by email. |

## Regenerating map data

`npm run geodata` downloads Natural Earth country data to `tools/.cache/` and rewrites
`worker/src/data/countries.js` and `publisher/src/data/basemap.js`. Re-run it only when you
change region definitions or map detail.

## Limitations

The classifier reads headlines with keyword rules. It is transparent and cheap, but it will
sometimes misread a story. "Suspected terrorism" means the coverage uses terrorism language or
describes a non-state armed group. It is not an official designation. Unverified social posts
never lead the headlines.
