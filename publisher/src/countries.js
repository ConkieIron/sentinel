// Countries with a page in this edition: every country in the news, plus any the snapshot carries
// official travel advice for (US "Do not travel" countries and recent advice changes).

const slugify = (s) =>
  String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** @returns {Map<string, {iso3, name, region, slug, path, incidents: object[], travel: object|null}>} by ISO3, A–Z */
export function buildCountries(snapshot) {
  const byIso = new Map();
  const add = (iso3, name, region) => {
    if (!byIso.has(iso3)) byIso.set(iso3, { iso3, name, region, incidents: [], travel: snapshot.travel?.[iso3] || null });
    return byIso.get(iso3);
  };
  for (const inc of snapshot.incidents) {
    const loc = inc.location;
    if (loc?.iso3 && loc.region) add(loc.iso3, loc.country, loc.region).incidents.push(inc);
  }
  for (const [iso3, a] of Object.entries(snapshot.travel || {})) if (a.name && a.region) add(iso3, a.name, a.region);

  const used = new Set();
  const sorted = [...byIso.values()].sort((a, b) => a.name.localeCompare(b.name, 'en'));
  for (const c of sorted) {
    let slug = slugify(c.name) || c.iso3.toLowerCase();
    if (used.has(slug)) slug = `${slug}-${c.iso3.toLowerCase()}`;
    used.add(slug);
    c.slug = slug;
    c.path = `/country/${slug}/`;
    c.incidents.sort((a, b) => b.time - a.time);
  }
  return new Map(sorted.map((c) => [c.iso3, c]));
}

/** Built once per context, so pages and cards can link to countries without extra setup. */
export function countriesOf(ctx) {
  if (!ctx.countries) ctx.countries = buildCountries(ctx.snapshot);
  return ctx.countries;
}

export function countryPath(ctx, iso3) {
  return (iso3 && countriesOf(ctx).get(iso3)?.path) || null;
}

/** When a country's advice last changed, by either government. */
export function adviceChangedAt(a) {
  return Math.max(a?.fcdo?.updated || 0, a?.us?.levelChangedAt || 0, a?.us?.updated || 0);
}

/**
 * Travel advice changes within the edition window, newest first, as entries for the Latest feed.
 * A US level change is reported as raised or lowered; other updates say what changed.
 */
export function adviceChanges(snapshot, now) {
  const windowMs = snapshot.windowHours * 3600000;
  const out = [];
  for (const [iso3, a] of Object.entries(snapshot.travel || {})) {
    if (a.us?.levelChangedAt && now - a.us.levelChangedAt <= windowMs) {
      const raised = a.us.level > (a.us.previousLevel || 0);
      out.push({
        iso3,
        gov: 'us',
        time: a.us.levelChangedAt,
        url: a.us.url,
        raised,
        title: `US ${raised ? 'raises' : 'lowers'} travel advisory for ${a.name} to Level ${a.us.level}: ${a.us.label}`,
        summary: a.us.previousLevel ? `Previously Level ${a.us.previousLevel}.` : '',
      });
    } else if (a.us?.updated && now - a.us.updated <= windowMs) {
      out.push({ iso3, gov: 'us', time: a.us.updated, url: a.us.url, title: `US travel advisory for ${a.name} updated`, summary: `Level ${a.us.level}: ${a.us.label}.` });
    }
    if (a.fcdo?.updated && now - a.fcdo.updated <= windowMs) {
      out.push({ iso3, gov: 'uk', time: a.fcdo.updated, url: a.fcdo.url, title: `UK travel advice for ${a.name} updated`, summary: a.fcdo.change || '' });
    }
  }
  return out.sort((x, y) => y.time - x.time);
}
