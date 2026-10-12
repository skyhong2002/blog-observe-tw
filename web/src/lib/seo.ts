// Adapted from tag.observe.tw web/src/lib/seo.mts, MIT, Copyright (c) 2026 Sky Hong.
// Per-page metadata for the public, indexable pages. Every page sets its own
// absolute self canonical (trailing slash, no query), so the root layout
// never lends the home page's canonical to a page without one.
// Pure: node --test imports this file.

export const SITE_ORIGIN = 'https://blog.observe.tw';
export const SITE_NAME = '部落格觀察';
export const SITE_TITLE = '部落格觀察：每一種生活，各自怎麼寫';
export const SITE_DESCRIPTION = '每一種生活，各自怎麼寫。台灣部落格文章、作者與標籤，持續閱讀不同的生活';
const OG_IMAGE = { url: `${SITE_ORIGIN}/opengraph-image.png`, width: 1200, height: 630 };

/** A site path with exactly one trailing slash and no query or fragment. */
export function canonicalPath(path: string): string {
  const bare = path.replace(/[?#].*$/, '');
  return bare.endsWith('/') ? bare : `${bare}/`;
}

export const absoluteUrl = (path: string) => SITE_ORIGIN + canonicalPath(path);

/** Plain one-line text cut to a search-snippet length. */
export function shortText(value: string | null | undefined, max = 120): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** title, description, self canonical, Open Graph and Twitter for one public page. */
export function pageMetadata(path: string, title: string | null, description: string) {
  const url = absoluteUrl(path);
  const fullTitle = title ? `${title} · ${SITE_NAME}` : SITE_TITLE;
  const images = [{ ...OG_IMAGE, alt: fullTitle }];
  return {
    title: { absolute: fullTitle },
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website' as const, locale: 'zh_TW', siteName: SITE_NAME, title: fullTitle, description, url, images },
    twitter: { card: 'summary_large_image' as const, title: fullTitle, description, images },
  };
}

/** /blogs/<slug>/ with the slug percent-encoded once. */
export const blogPath = (slug: string) => `/blogs/${encodeURIComponent(slug)}/`;
/** /topics/<id>/, e.g. /topics/tag%3A<hash>/. */
export const topicPath = (id: string) => `/topics/${encodeURIComponent(id)}/`;

/** JSON for a <script type="application/ld+json">; `<` is escaped so the text cannot close the script. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Home page: the site and its publisher. No SearchAction (no confirmed search URL template). */
export function siteSchema() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SITE_ORIGIN}/#website`,
        url: `${SITE_ORIGIN}/`,
        name: SITE_NAME,
        description: SITE_DESCRIPTION,
        inLanguage: 'zh-Hant',
        publisher: { '@id': `${SITE_ORIGIN}/#organization` },
      },
      {
        '@type': 'Organization',
        '@id': `${SITE_ORIGIN}/#organization`,
        url: `${SITE_ORIGIN}/`,
        name: SITE_NAME,
        logo: `${SITE_ORIGIN}/pwa/icon-512.png`,
      },
    ],
  };
}

/** BreadcrumbList from the home page through `trail` ([path, name] pairs, the page itself last). */
export function breadcrumbSchema(trail: Array<[string, string]>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [['/', SITE_NAME], ...trail].map(([path, name], index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name,
      item: absoluteUrl(path),
    })),
  };
}
