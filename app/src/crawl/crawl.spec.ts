import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { createTechFetchBatch } from '../tech/fetch-batch.ts';
import { TechObservationQueue } from '../tech/observer.ts';
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
  it.each([false, true])(
    'existing sitemap HTML observation enabled=%s has identical requests and follows transaction commit',
    async (enabled) => {
      const host = `https://crawl-passive-${enabled}.test`;
      const f = setup([{ url: `${host}/sitemap.xml`, type: 'sitemap' }], {
        [`${host}/sitemap.xml`]: `<urlset><url><loc>${host}/post</loc></url></urlset>`,
        [`${host}/post`]:
          '<html><meta name="generator" content="WordPress"><meta property="og:type" content="article"><title>Post</title></html>',
      });
      let committed = false;
      const connection = {
        beginTransaction: vi.fn(),
        commit: vi.fn(async () => {
          committed = true;
        }),
        rollback: vi.fn(),
        release: vi.fn(),
        execute: vi.fn(async (sql: string) =>
          sql.startsWith('SELECT id,url,status FROM blogs') ? [[{ id: 1, url: `${host}/`, status: 'verified' }], []] : f.execute(sql),
        ),
      };
      const query = vi.fn(async () => {
        expect(committed).toBe(true);
        expect(connection.release).toHaveBeenCalled();
        return [[{ id: 12, url: `${host}/post` }]];
      });
      const pool = { ...f.pool, query, getConnection: vi.fn(async () => connection) } as unknown as Pool;
      const writer = vi.fn(async () => {
        expect(committed).toBe(true);
        return { written: true, reason: 'stored' as const };
      });
      const queue = new TechObservationQueue(writer);
      const passiveBatch = createTechFetchBatch(pool, { blogId: 1, blogUrl: `${host}/` }, { enabled, queue });
      expect(await crawlBlog({ pool }, { id: 1, slug: 'passive', url: `${host}/` }, { ...f.options, passiveBatch })).toMatchObject({
        posts: 1,
      });
      await queue.idle();
      expect(f.fetcher.mock.calls.map(([url]) => String(url))).toEqual([`${host}/robots.txt`, `${host}/sitemap.xml`, `${host}/post`]);
      expect(writer).toHaveBeenCalledTimes(Number(enabled));
      expect(query).toHaveBeenCalledTimes(Number(enabled));
    },
  );
  it('failed feed commit rolls back and discards HTML DTOs', async () => {
    const host = 'https://crawl-passive-rollback.test';
    const f = setup([{ url: `${host}/sitemap.xml`, type: 'sitemap' }], {
      [`${host}/sitemap.xml`]: `<urlset><url><loc>${host}/post</loc></url></urlset>`,
      [`${host}/post`]:
        '<html><meta name="generator" content="WordPress"><meta property="og:type" content="article"><title>Post</title></html>',
    });
    const connection = {
      beginTransaction: vi.fn(),
      commit: vi.fn(async () => {
        throw Error('commit-failed');
      }),
      rollback: vi.fn(),
      release: vi.fn(),
      execute: vi.fn(async (sql: string) =>
        sql.startsWith('SELECT id,url,status FROM blogs') ? [[{ id: 1, url: `${host}/`, status: 'verified' }], []] : f.execute(sql),
      ),
    };
    const query = vi.fn(),
      writer = vi.fn(),
      queue = new TechObservationQueue(writer);
    const pool = { ...f.pool, query, getConnection: vi.fn(async () => connection) } as unknown as Pool;
    const passiveBatch = createTechFetchBatch(pool, { blogId: 1, blogUrl: `${host}/` }, { enabled: true, queue })!;
    await expect(crawlBlog({ pool }, { id: 1, slug: 'rollback', url: `${host}/` }, { ...f.options, passiveBatch })).rejects.toThrow(
      'commit-failed',
    );
    await passiveBatch.commit([`${host}/post`]);
    await queue.idle();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
  });
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

function durableFixture(name: string, xml: string, failAt?: string, status = 200) {
  const url = `https://${name}.test/feed`;
  const execute = vi.fn(async (sql: string, _values?: unknown[]) => {
    if (failAt && sql.startsWith(failAt)) throw new Error('simulated database failure');
    if (sql.startsWith('SELECT url,type')) return [[{ url, type: 'rss' }], []];
    if (sql.startsWith('SELECT * FROM feed_sources')) return [[{ etag: 'old-etag', last_modified: 'Mon, 01 Jan 2024 00:00:00 GMT' }], []];
    if (sql.startsWith('SELECT')) return [[], []];
    return [{ insertId: 1, affectedRows: 1 }, []];
  });
  const fetcher = vi.fn<FeedFetcher>(async (input) =>
    String(input).endsWith('/robots.txt')
      ? new Response('')
      : new Response(status === 304 ? null : xml.replaceAll('https://metadata.test/', `https://${name}.test/`), {
          status,
          headers: { etag: 'new-etag', 'last-modified': 'Mon, 01 Jun 2026 00:00:00 GMT', 'content-type': 'application/rss+xml' },
        }),
  );
  return {
    url,
    execute,
    fetcher,
    pool: { execute: execute as unknown as Pool['execute'] },
    blog: { id: 42, slug: name, url: `https://${name}.test/` },
    options: { fetcher, resolveHost: async () => ['93.184.216.34'], delayMs: 250 },
  };
}
const metadataRss =
  '<rss><channel><title>Blog</title><item><guid>durable-post</guid><title>文章</title><link>https://metadata.test/post</link><author>作者</author><category>分類</category></item></channel></rss>';

describe('durable feed import and schema bounds', () => {
  it('bounds UTF-8 summaries without splitting Unicode, and limits author/image fields', async () => {
    const summary = '😀界'.repeat(12000);
    const author = '😀'.repeat(300);
    const longImage = `https://images.test/${'x'.repeat(1100)}`;
    const xml = `<rss><channel><title>Blog</title><item><guid>bounded</guid><title>短文</title><link>https://bounded-text.test/post</link><description><![CDATA[${summary}]]></description><author>${author}</author><enclosure url="${longImage}"/></item></channel></rss>`;
    const f = durableFixture('bounded-text', xml);
    await crawlBlog({ pool: f.pool }, f.blog, f.options);
    const values = f.execute.mock.calls.find(([sql]) => sql.startsWith('INSERT INTO posts'))?.[1];
    const stored = String(values?.[4]);
    expect(Array.from(stored)).toHaveLength(500);
    expect(Buffer.byteLength(stored, 'utf8')).toBeLessThanOrEqual(500 * 4);
    expect(stored.isWellFormed()).toBe(true);
    expect(summary.startsWith(stored)).toBe(true);
    expect(Array.from(String(values?.[5]))).toHaveLength(255);
    expect(String(values?.[5]).isWellFormed()).toBe(true);
    expect(values?.[8]).toBeNull();
  });

  it.each(['INSERT INTO posts', 'INSERT INTO authors', 'INSERT INTO post_tags'])(
    'does not acknowledge new validators when %s fails',
    async (failAt) => {
      const f = durableFixture(`fail-${failAt.split(' ').at(-1)}`, metadataRss, failAt);
      await expect(crawlBlog({ pool: f.pool }, f.blog, f.options)).rejects.toThrow('simulated database failure');
      expect(f.execute.mock.calls.some(([sql]) => sql.includes('etag,last_modified,last_success_at'))).toBe(false);
      expect(f.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE feed_sources SET last_success_at'))).toBe(false);
    },
  );

  it('acknowledges feed validators only after post and relationship writes succeed', async () => {
    const f = durableFixture('durable-order', metadataRss);
    await crawlBlog({ pool: f.pool }, f.blog, f.options);
    const sql = f.execute.mock.calls.map(([statement]) => statement);
    const accepted = sql.findIndex((statement) => statement.includes('etag,last_modified,last_success_at'));
    expect(accepted).toBeGreaterThan(sql.findIndex((statement) => statement.startsWith('INSERT INTO posts')));
    expect(accepted).toBeGreaterThan(sql.findIndex((statement) => statement.startsWith('INSERT INTO post_authors')));
    expect(accepted).toBeGreaterThan(sql.findIndex((statement) => statement.startsWith('INSERT INTO blog_tags')));
    expect(f.execute.mock.calls[accepted][1]?.[3]).toBe('new-etag');
  });

  it('omits conditional headers for history replay but preserves normal caching', async () => {
    for (const historyImport of [false, true]) {
      const f = durableFixture(`history-headers-${historyImport}`, metadataRss);
      await crawlBlog({ pool: f.pool }, f.blog, { ...f.options, historyImport });
      const headers = f.fetcher.mock.calls.find(([url]) => String(url) === f.url)?.[1]?.headers as Record<string, string>;
      if (historyImport) {
        expect(headers['if-none-match']).toBeUndefined();
        expect(headers['if-modified-since']).toBeUndefined();
      } else {
        expect(headers['if-none-match']).toBe('old-etag');
        expect(headers['if-modified-since']).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
      }
    }
  });

  it('does not claim a historical import when the server sends an unsolicited 304', async () => {
    const f = durableFixture('history-bad304', metadataRss, undefined, 304);
    const result = await crawlBlog({ pool: f.pool }, f.blog, { ...f.options, historyImport: true });
    expect(result.sources).toBe(0);
    expect(result.posts).toBe(0);
    expect(f.execute.mock.calls.some(([sql]) => sql.startsWith('UPDATE feed_sources SET last_success_at'))).toBe(false);
    const update = f.execute.mock.calls.find(([sql]) => sql.includes('history_imported_at=history_imported_at'));
    expect(update).toBeDefined();
  });
});

describe('registered source priority', () => {
  it('processes RSS and article sitemap before an older 30-URL miscellaneous sitemap', async () => {
    const home = 'https://registered-priority.test';
    const misc = `${home}/sitemap-misc.xml`;
    const posts = `${home}/post-sitemap.xml`;
    const rss = `${home}/feed/`;
    const sources: FeedLink[] = [
      { url: misc, type: 'sitemap' },
      { url: posts, type: 'sitemap' },
      { url: rss, type: 'rss' },
    ];
    const f = setup(sources, {
      [misc]: `<urlset>${Array.from({ length: 30 }, (_, i) => `<url><loc>${home}/misc${i}</loc></url>`).join('')}</urlset>`,
      [posts]: `<urlset><url><loc>${home}/real-post</loc></url></urlset>`,
      [rss]: '<rss><channel><title>Empty RSS</title></channel></rss>',
      [`${home}/real-post`]: article({ '@type': 'BlogPosting', headline: '真正的文章' }),
    });
    const result = await crawlBlog({ pool: f.pool }, { id: 80, slug: 'priority', url: `${home}/` }, f.options);
    expect(result.posts).toBe(1);
    expect(result.sources).toBe(3);
    const requested = f.fetcher.mock.calls.map(([url]) => String(url));
    expect(requested.filter((url) => [misc, posts, rss].includes(url))).toEqual([rss, posts, misc]);
    expect(requested).toContain(`${home}/real-post`);
    expect(requested.filter((url) => /\/(?:real-post|misc\d+)$/.test(url))).toHaveLength(30);
    expect(requested).not.toContain(`${home}/misc29`);
  }, 15000);
});

it('does not write another author from a shared platform feed', async () => {
  const feed = 'https://note.com/alice/rss';
  const f = setup([{ url: feed, type: 'rss' }], {
    [feed]:
      '<rss><channel><item><guid>1</guid><link>https://note.com/bob/n/one</link><title>Another author</title><description>Excerpt</description></item></channel></rss>',
  });
  const result = await crawlBlog({ pool: f.pool }, { id: 90, slug: 'owner-boundary', url: 'https://note.com/alice' }, f.options);
  expect(result.posts).toBe(0);
  expect(f.execute.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO posts'))).toBe(false);
});

it.each([false, true])('RSS body queues after commit/release; queue failure=%s cannot poison body or F4 callbacks', async (queueFails) => {
  const contentStore = await import('../content/store.ts');
  const ingest = vi
    .spyOn(contentStore, 'ingestContentEvidence')
    .mockResolvedValue({ postId: 20875, status: 'ok', changed: true, hash: 'private' });
  try {
    const home = 'https://index-rss.test/',
      source = { url: home + 'feed', type: 'rss' as const };
    const rss = `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><guid>1</guid><link>${home}post</link><title>Body</title><content:encoded><![CDATA[<article>正文</article>]]></content:encoded></item></channel></rss>`;
    const f = setup([source], { [source.url]: rss }),
      events: string[] = [];
    const connection = {
      beginTransaction: vi.fn(async () => {}),
      commit: vi.fn(async () => {
        events.push('commit');
      }),
      rollback: vi.fn(async () => {}),
      release: vi.fn(() => {
        events.push('release');
      }),
      execute: vi.fn(async (sql: string) =>
        sql.startsWith('SELECT id,url,status') ? [[{ id: 7, url: home, status: 'verified' }], []] : [[], []],
      ),
    };
    const pool = { ...f.pool, getConnection: async () => connection } as unknown as Pool;
    const enqueue = vi.fn(async (ids: readonly number[]) => {
      events.push('enqueue');
      if (queueFails) throw Error('queue offline');
      return { acceptedPostIds: ids };
    });
    const report = vi.fn();
    const outcome = await crawlBlog(
      { pool },
      { id: 7, slug: 'index-rss', url: home },
      { ...f.options, indexAdoptionEnabled: true, enqueueIndex: enqueue, onIndexAdoptionReport: report },
    );
    expect(outcome.posts).toBe(1);
    expect(events).toEqual(['commit', 'release', 'enqueue']);
    expect(enqueue).toHaveBeenCalledWith([20875]);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ state: queueFails ? 'needs-repair' : 'queued' }));
  } finally {
    ingest.mockRestore();
  }
});
