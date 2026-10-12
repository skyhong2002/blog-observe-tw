import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { crawlBlog, type FeedFetcher, type FeedLink, parseSitemap, parseSitemapArticle } from './feed.ts';

function setup(sources: FeedLink[], pages: Record<string, string>) {
  const execute = vi.fn(async (sql: string) => {
    if (sql.startsWith('SELECT url,type FROM feed_sources')) return [sources, []];
    if (sql.startsWith('SELECT')) return [[], []];
    return [{ insertId: 1, affectedRows: 1 }, []];
  });
  const fetcher = vi.fn<FeedFetcher>(async (input, init) => {
    expect(init?.dispatcher).toBeDefined();
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('');
    const page = pages[url];
    return page === undefined
      ? new Response(null, { status: 404 })
      : new Response(page, {
          headers: { 'content-type': page.startsWith('<html') ? 'text/html' : 'application/xml' },
        });
  });
  return {
    execute,
    fetcher,
    pool: { execute: execute as unknown as Pool['execute'] },
    options: { fetcher, resolveHost: async () => ['93.184.216.34'], delayMs: 250 },
  };
}

const article = (data: Record<string, unknown>) =>
  `<html><head><title>Fallback</title><script type="application/ld+json">${JSON.stringify(data)}</script></head></html>`;

describe('sitemap article evidence', () => {
  const candidate = parseSitemap(
    '<urlset><url><loc>https://article-proof.test/post</loc><lastmod>2025-09-01</lastmod></url></urlset>',
    'https://article-proof.test',
  )[0];
  it('extracts actual article metadata while keeping lastmod separate from publication', () => {
    const parsed = parseSitemapArticle(
      article({
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: '實際文章',
        description: '摘要',
        author: { '@type': 'Person', name: '作者' },
        datePublished: '2025-01-01T00:00:00Z',
        image: { url: '/cover.jpg' },
      }),
      candidate,
      candidate.url,
    );
    expect(parsed).toMatchObject({ title: '實際文章', summary: '摘要', author: '作者', imageUrl: 'https://article-proof.test/cover.jpg' });
    expect(parsed?.publishedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(parsed?.updatedAt?.toISOString()).toBe('2025-09-01T00:00:00.000Z');
    const undated = parseSitemapArticle(
      '<html><meta property="og:type" content="article"><meta property="og:title" content="圖片文"></html>',
      candidate,
      candidate.url,
    );
    expect(undated?.publishedAt).toBeNull();
    expect(undated?.imageUrl).toBeNull();
  });

  it('rejects products, category pages, and recommendation Article nodes for another URL', () => {
    for (const data of [
      { '@type': 'Product', name: '商品' },
      { '@type': 'CollectionPage', mainEntity: { '@type': 'ItemList', itemListElement: [{ '@type': 'Article', headline: '推薦文章' }] } },
      { '@graph': [{ '@type': 'Article', url: 'https://article-proof.test/different', headline: '另一篇文章' }] },
    ])
      expect(parseSitemapArticle(article(data), candidate, candidate.url)).toBeNull();
  });

  it('supports graph NewsArticle and og:type article without requiring long text', () => {
    expect(
      parseSitemapArticle(
        article({ '@graph': [{ '@type': ['Thing', 'NewsArticle'], '@id': `${candidate.url}#article`, headline: '短文' }] }),
        candidate,
        candidate.url,
      )?.title,
    ).toBe('短文');
  });
});

describe('crawl integration', () => {
  it('uses registered publication feed without discovering a shared platform homepage or root feed', async () => {
    const feed = 'https://medium.com/feed/@registered-author';
    const fixture = setup([{ url: feed, type: 'rss' }], {
      [feed]:
        '<rss><channel><title>作者</title><item><guid>1</guid><title>短文</title><link>https://medium.com/@registered-author/post</link></item></channel></rss>',
    });
    const result = await crawlBlog(
      { pool: fixture.pool },
      { id: 1, slug: 'registered', url: 'https://medium.com/@registered-author' },
      fixture.options,
    );
    expect(result).toEqual({ blog: 'registered', sources: 1, posts: 1 });
    expect(fixture.fetcher.mock.calls.map(([url]) => String(url))).toEqual(['https://medium.com/robots.txt', feed]);
  });

  it('does not mark 200 HTML or nested fake RSS as successful sources', async () => {
    const feed = 'https://false-feed-success.test/feed';
    const fixture = setup([{ url: feed, type: 'rss' }], {
      [feed]: '<html><body><rss><channel><title>Embedded</title></channel></rss></body></html>',
    });
    const result = await crawlBlog(
      { pool: fixture.pool },
      { id: 2, slug: 'fake', url: 'https://false-feed-success.test/' },
      fixture.options,
    );
    expect(result).toEqual({ blog: 'fake', sources: 0, posts: 0 });
    expect(fixture.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO posts'))).toBe(false);
    expect(fixture.execute.mock.calls.some(([sql]) => sql.includes('consecutive_failures=consecutive_failures+1'))).toBe(true);
  });

  it('fetches sitemap HTML and indexes articles only, retaining honest zero for commerce', async () => {
    const host = 'https://sitemap-mixed.test';
    const map = `${host}/sitemap.xml`;
    const fixture = setup([{ url: map, type: 'sitemap' }], {
      [map]: `<urlset><url><loc>${host}/product</loc></url><url><loc>${host}/category</loc></url><url><loc>${host}/post</loc><lastmod>2025-09-01</lastmod></url></urlset>`,
      [`${host}/product`]: article({ '@type': 'Product', name: '商品' }),
      [`${host}/category`]: '<html><title>分類</title></html>',
      [`${host}/post`]: article({ '@type': 'Article', headline: '真正文章' }),
    });
    const result = await crawlBlog({ pool: fixture.pool }, { id: 3, slug: 'mixed', url: `${host}/` }, fixture.options);
    expect(result.posts).toBe(1);
    const calls = fixture.execute.mock.calls as unknown as Array<[string, unknown[]]>;
    const values = calls.find(([sql]) => sql.startsWith('INSERT INTO posts'))?.[1];
    expect(values?.[3]).toBe('真正文章');
    expect(values?.[6]).toBeNull();
    expect(values?.[7]).toEqual(new Date('2025-09-01'));
    const commerceHost = 'https://sitemap-commerce.test';
    const commerce = setup([{ url: `${commerceHost}/sitemap.xml`, type: 'sitemap' }], {
      [`${commerceHost}/sitemap.xml`]: `<urlset><url><loc>${commerceHost}/product</loc></url></urlset>`,
      [`${commerceHost}/product`]: article({ '@type': 'Product', name: '商品' }),
    });
    expect(await crawlBlog({ pool: commerce.pool }, { id: 4, slug: 'commerce', url: `${commerceHost}/` }, commerce.options)).toEqual({
      blog: 'commerce',
      sources: 1,
      posts: 0,
    });
  });

  it('limits sitemap page requests to 30 per blog across multiple sources', async () => {
    const host = 'https://sitemap-bounded.test';
    const pages: Record<string, string> = {};
    for (let i = 0; i < 40; i++) pages[`${host}/p${i}`] = '<html><title>商品</title></html>';
    const sources: FeedLink[] = [0, 1].map((batch) => {
      const url = `${host}/s${batch}.xml`;
      pages[url] = `<urlset>${Array.from({ length: 20 }, (_, i) => `<url><loc>${host}/p${batch * 20 + i}</loc></url>`).join('')}</urlset>`;
      return { url, type: 'sitemap' };
    });
    const fixture = setup(sources, pages);
    const result = await crawlBlog({ pool: fixture.pool }, { id: 5, slug: 'bounded', url: `${host}/` }, fixture.options);
    expect(result.posts).toBe(0);
    expect(fixture.fetcher.mock.calls.filter(([url]) => /\/p\d+$/.test(String(url)))).toHaveLength(30);
    expect(fixture.fetcher.mock.calls.some(([url]) => String(url) === `${host}/p30`)).toBe(false);
  }, 15000);
});
