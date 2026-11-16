// JSON-LD for Google (WebSite, Organization, WebPage/CollectionPage, LiveBlogPosting, BreadcrumbList).

import { compactHeadline, safeHref } from './util.js';

export function absoluteUrl(siteUrl, path = '/') {
  const origin = String(siteUrl || '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return origin + p;
}

/** Serialize for a <script type="application/ld+json"> block; escape < so content cannot break out. */
export function ldScript(data) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * @param {object} opts
 * @param {{ url: string }} opts.site
 * @param {string} [opts.title]
 * @param {string} opts.description
 * @param {string} opts.path
 * @param {'WebPage'|'CollectionPage'|'AboutPage'} [opts.pageType]
 * @param {{ name: string, path: string }[]} [opts.breadcrumbs]
 * @param {object} [opts.live] live story for LiveBlogPosting
 */
export function pageJsonLd({ site, title, description, path, pageType = 'WebPage', breadcrumbs, live }) {
  const origin = String(site.url || '').replace(/\/$/, '');
  const url = absoluteUrl(origin, path);
  const orgId = `${origin}/#organization`;
  const siteId = `${origin}/#website`;
  const pageId = `${url}#webpage`;

  const graph = [
    {
      '@type': 'Organization',
      '@id': orgId,
      name: 'SENTINEL',
      url: origin,
      logo: {
        '@type': 'ImageObject',
        url: `${origin}/icon-512.png`,
      },
      description: 'Open-source global incident and threat monitor that aggregates public reporting into a regional threat briefing.',
    },
    {
      '@type': 'WebSite',
      '@id': siteId,
      name: 'SENTINEL',
      url: origin,
      description: 'Live-updated briefing of world incidents and suspected terrorism with a regional threat index.',
      publisher: { '@id': orgId },
      inLanguage: 'en-GB',
    },
  ];

  if (live) {
    const headline = compactHeadline(live.title);
    const updates = (live.updates || [])
      .filter((u) => u?.title && Number.isFinite(u.time))
      .slice(0, 30)
      .map((u) => {
        const href = safeHref(u.url);
        const entry = {
          '@type': 'BlogPosting',
          headline: compactHeadline(u.title),
          datePublished: new Date(u.time).toISOString(),
          author: u.source ? { '@type': 'Organization', name: String(u.source) } : { '@id': orgId },
        };
        if (href && href !== '#') entry.url = href;
        if (u.summary) entry.description = String(u.summary).slice(0, 300);
        return entry;
      });

    const article = {
      '@type': 'LiveBlogPosting',
      '@id': `${url}#live`,
      headline,
      description,
      url,
      mainEntityOfPage: { '@id': pageId },
      datePublished: new Date(live.startedAt).toISOString(),
      dateModified: new Date(live.updatedAt).toISOString(),
      coverageStartTime: new Date(live.startedAt).toISOString(),
      coverageEndTime: new Date(live.updatedAt).toISOString(),
      author: { '@id': orgId },
      publisher: { '@id': orgId },
      isPartOf: { '@id': siteId },
      inLanguage: 'en-GB',
    };
    if (live.image?.url && safeHref(live.image.url) !== '#') {
      article.image = [safeHref(live.image.url)];
    }
    if (updates.length) article.liveBlogUpdate = updates;
    graph.push(article);
    graph.push({
      '@type': 'WebPage',
      '@id': pageId,
      url,
      name: title || headline,
      description,
      isPartOf: { '@id': siteId },
      publisher: { '@id': orgId },
      primaryEntityOfPage: { '@id': `${url}#live` },
      inLanguage: 'en-GB',
    });
  } else {
    graph.push({
      '@type': pageType,
      '@id': pageId,
      url,
      name: title || 'SENTINEL · Global Incident & Threat Monitor',
      description,
      isPartOf: { '@id': siteId },
      publisher: { '@id': orgId },
      inLanguage: 'en-GB',
    });
  }

  if (breadcrumbs?.length) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: breadcrumbs.map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: crumb.name,
        item: absoluteUrl(origin, crumb.path),
      })),
    });
  }

  return ldScript({ '@context': 'https://schema.org', '@graph': graph });
}
