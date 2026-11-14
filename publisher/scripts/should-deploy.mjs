#!/usr/bin/env node
// Decides whether a freshly built dist/ is worth deploying, by comparing its edition fingerprint
// with the one currently live. Deploys when the content changed, when the live edition is older
// than HEARTBEAT_MINUTES (keeps timestamps honest), or when the live site can't be read.
//
// Writes `deploy=true|false` to $GITHUB_OUTPUT when running in GitHub Actions.

import { appendFile, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const siteUrl = (process.env.SITE_URL || 'https://sentinelglobalnews.pages.dev').replace(/\/$/, '');
const heartbeatMs = Number(process.env.HEARTBEAT_MINUTES || 60) * 60000;

const local = JSON.parse(await readFile(join(here, '../dist/data/meta.json'), 'utf8'));

async function liveMeta() {
  try {
    const res = await fetch(`${siteUrl}/data/meta.json?t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const live = await liveMeta();
let deploy = true;
let reason;
if (!live?.fingerprint) reason = 'live edition unavailable or has no fingerprint';
else if (live.fingerprint !== local.fingerprint) reason = `content changed (${live.fingerprint} → ${local.fingerprint})`;
else if (Date.parse(local.generatedAt) - Date.parse(live.generatedAt) >= heartbeatMs) reason = 'heartbeat: live edition is over the refresh age';
else {
  deploy = false;
  reason = `no material change since ${live.generatedAt}`;
}

console.log(`${deploy ? 'Deploy' : 'Skip'}: ${reason}`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `deploy=${deploy}\n`);
