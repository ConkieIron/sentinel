/** Semver patch bump: 1.1.0 → 1.1.1 */
export function bumpPatch(version) {
  const parts = String(version || '0.0.0')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10));
  const major = Number.isFinite(parts[0]) ? parts[0] : 0;
  const minor = Number.isFinite(parts[1]) ? parts[1] : 0;
  const patch = Number.isFinite(parts[2]) ? parts[2] : 0;
  return `${major}.${minor}.${patch + 1}`;
}

/** Read the version badge currently live on the site, if reachable. */
export async function fetchLiveVersion(siteUrl, { timeoutMs = 10000 } = {}) {
  const base = String(siteUrl || '').replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await fetch(`${base}/data/meta.json?t=${Date.now()}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const meta = await res.json();
    const v = meta?.version;
    return typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  }
}
