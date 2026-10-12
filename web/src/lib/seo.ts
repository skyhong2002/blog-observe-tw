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

// Title and description of every static public page, unique per page. Query
// views (?q=, ?tag=, ?author=, ?days=…) are client-side states of these pages
// and share their self canonical.
export const STATIC_PAGES = {
  '/': [null, SITE_DESCRIPTION],
  '/about/': ['資料來源與收錄方式', '部落格觀察如何收錄公開部落格：來源、內文取得、更新與話題排行方式，以及隱私與訂閱說明。'],
  '/api/': ['API 文件', '部落格觀察公開 API：端點、參數、回傳欄位與使用規則。'],
  '/api/status/': ['API 狀態', '查看部落格觀察公開 API 的可用狀態與各端點用途。'],
  '/articles/': ['最新文章', '台灣部落格最新文章：依發文時間列出收錄部落格的公開文章，可全文搜尋，點選後回到原站閱讀。'],
  '/authors/': ['文章作者', '台灣部落格的文章作者：依收錄文章數整理作者與所屬部落格，查看每位作者最近的文章。'],
  '/blogs/': ['部落格目錄', '台灣部落格目錄：依分類、更新狀態與最新發文瀏覽收錄的部落格，連回作者自己的網站閱讀。'],
  '/ranking/': ['標籤收錄排行', '部落格文章標籤收錄排行：依參與部落格數與收錄文章數排列，是收錄概況而非品質評分。'],
  '/relations/': ['部落格關係圖', '從正文連結看台灣部落格之間的引用與交流，近 7、30、90 天的部落格關係圖。'],
  '/tags/': ['文章標籤', '探索台灣部落格文章標籤：看每個標籤有哪些部落格參與、收錄多少文章與最近的文章。'],
  '/topics/': ['大家正在寫什麼', '台灣部落格近期共同話題排行：依參與部落格數與文章數，看大家最近都在寫什麼。'],
  '/traffic/': ['部落格流量與排名', '對照已核准部落格的網域流量估算、排名與資料時間；估算不代表文章品質。'],
} as const satisfies Record<string, readonly [string | null, string]>;

export function staticPageMetadata(path: keyof typeof STATIC_PAGES) {
  const [title, description]: readonly [string | null, string] = STATIC_PAGES[path];
  return pageMetadata(path, title, description);
}

/** Sign-in, reader, admin and settings pages: never indexed, no canonical. */
export const privatePageMetadata = (title: string) => ({
  title: { absolute: `${title} · ${SITE_NAME}` },
  robots: { index: false, follow: false },
});

/** /blogs/<slug>/ with the slug percent-encoded once (the legacy, stable-slug URL). */
export const blogPath = (slug: string) => `/blogs/${encodeURIComponent(slug)}/`;
/** /topics/<id>/, e.g. /topics/tag%3A<hash>/. */
export const topicPath = (id: string) => `/topics/${encodeURIComponent(id)}/`;

/** JSON for a <script type="application/ld+json">; `<` is escaped so the text cannot close the script. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** The header search form's GET target: /articles/ runs ?q= through the public /api/search. */
export const SEARCH_URL_TEMPLATE = `${SITE_ORIGIN}/articles/?q={search_term_string}`;

/** Home page: the site, its article search and its publisher. */
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
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: SEARCH_URL_TEMPLATE },
          'query-input': 'required name=search_term_string',
        },
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
