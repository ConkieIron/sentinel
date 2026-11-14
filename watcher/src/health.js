// Site health. The watcher runs on its own clock, so it is the part of SENTINEL that can notice
// when the published site stops updating or GitHub stops accepting publish requests. It forces
// a rebuild and sends an alert through ntfy (a phone push notification, optionally also email).
//
// The health record is kept in the watcher's KV state, which is only written when something changes (a problem starts, an alert or forced rebuild is
// sent, or things recover), which keeps well inside the free plan's 1,000 writes a day.

import { fetchWithTimeout } from '../../worker/src/lib/http.js';

export const ALERT_REPEAT_MS = 3 * 3600000;
export const FORCE_GAP_MS = 30 * 60000;
// A single failed fetch is usually a blip; the site has to be unreachable for this long.
export const UNREACHABLE_GRACE_MS = 10 * 60000;

const fmtAge = (ms) => {
  const m = Math.round(ms / 60000);
  return m < 120 ? `${m} minutes` : `${Math.round(m / 60)} hours`;
};

export async function notify(env, title, message, { priority = 'high', tags = 'warning' } = {}) {
  if (!env.NTFY_TOPIC) return false;
  const headers = { Title: title, Priority: priority, Tags: tags };
  if (env.SITE_URL) headers.Click = env.SITE_URL;
  if (env.ALERT_EMAIL) headers.Email = env.ALERT_EMAIL;
  const res = await fetch(`${(env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '')}/${encodeURIComponent(env.NTFY_TOPIC)}`, { method: 'POST', headers, body: message });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
  return true;
}

export async function siteAge(env, now) {
  const res = await fetchWithTimeout(`${env.SITE_URL.replace(/\/$/, '')}/data/meta.json?t=${now}`, {
    timeoutMs: 8000,
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  const at = Date.parse((await res.json()).generatedAt);
  if (!Number.isFinite(at)) throw new Error('meta.json has no generatedAt');
  return at;
}

async function tryNotify(deps, env, ...args) {
  try {
    return await deps.notify(env, ...args);
  } catch {
    return false;
  }
}

const actionsUrl = (env) => `https://github.com/${env.GITHUB_REPO}/actions`;

/**
 * Checks the age of the live edition. While it is stale: a forced rebuild at most every
 * FORCE_GAP_MS and an alert at most every ALERT_REPEAT_MS; once fresh again, an all-clear.
 */
export async function checkSite(env, now, health, deps) {
  const staleMs = Number(env.STALE_MINUTES || 90) * 60000;
  const h = { ...health };
  const actions = [];
  let siteAt = null;
  let problem = null;
  let unreachable = false;
  try {
    siteAt = await deps.siteAge(env, now);
    if (now - siteAt > staleMs) problem = `The last edition was published ${fmtAge(now - siteAt)} ago`;
  } catch (err) {
    problem = `The site could not be reached (${err.message})`;
    unreachable = true;
  }

  if (!problem) {
    if (h.staleSince) {
      if (h.staleAlertAt) {
        await tryNotify(deps, env, 'SENTINEL is updating again', `A new edition was published ${fmtAge(now - siteAt)} ago.`, { priority: 'default', tags: 'white_check_mark' });
        actions.push('all-clear');
      }
      delete h.staleSince;
      delete h.staleAlertAt;
      delete h.lastForceAt;
    }
    return { health: h, siteAt, actions };
  }

  h.staleSince ||= now;
  if (unreachable && now - h.staleSince < UNREACHABLE_GRACE_MS) return { health: h, siteAt, actions };

  let forceError = null;
  if (!h.lastForceAt || now - h.lastForceAt >= FORCE_GAP_MS) {
    h.lastForceAt = now;
    try {
      await deps.dispatchPublish(env, `Stale site: ${problem}`, { force: true });
      actions.push('forced-rebuild');
    } catch (err) {
      forceError = err.message;
      h.lastError = err.message;
      actions.push('forced-rebuild-failed');
    }
  }
  if (!h.staleAlertAt || now - h.staleAlertAt >= ALERT_REPEAT_MS) {
    const next = forceError
      ? `The watcher asked GitHub for a forced rebuild, but GitHub refused: ${forceError}`
      : 'The watcher has asked GitHub for a forced rebuild and will keep trying every 30 minutes.';
    if (await tryNotify(deps, env, 'SENTINEL has stopped updating', `${problem}. ${next}\n\nPublish runs: ${actionsUrl(env)}`)) {
      h.staleAlertAt = now;
      actions.push('alert');
    }
  }
  return { health: h, siteAt, actions };
}

/** Alerts (at most every ALERT_REPEAT_MS) when GitHub refuses a publish request, e.g. an expired token. */
export async function noteDispatchFailure(env, now, health, err, deps) {
  const h = { ...health, lastError: err.message, dispatchFailingSince: health.dispatchFailingSince || now };
  if (h.dispatchAlertAt && now - h.dispatchAlertAt < ALERT_REPEAT_MS) return h;
  const hint = /HTTP (?:401|403)/.test(err.message)
    ? '\n\nThe GITHUB_TOKEN has probably expired or lost access. Create a new fine-grained token for the repo with "Actions: Read and write", then run: npx wrangler secret put GITHUB_TOKEN (in the watcher folder).'
    : '';
  if (await tryNotify(deps, env, 'SENTINEL cannot start publishes', `GitHub refused the watcher's publish request: ${err.message}${hint}\n\nThe site still updates on GitHub's own 5-minute schedule, but more slowly.`))
    h.dispatchAlertAt = now;
  return h;
}

export async function noteDispatchSuccess(env, health, deps) {
  if (!health.dispatchFailingSince) return health;
  if (health.dispatchAlertAt) await tryNotify(deps, env, 'SENTINEL publishes are working again', 'GitHub is accepting the watcher\'s publish requests again.', { priority: 'default', tags: 'white_check_mark' });
  const { dispatchFailingSince, dispatchAlertAt, ...rest } = health;
  return rest;
}
