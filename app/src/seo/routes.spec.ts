import { stat } from 'node:fs/promises';
import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import {
  registerSeoRoutes,
  SEO_ORIGIN,
  SITEMAP_TOPIC_BUCKET,
  sitemapChildPaths,
  sitemapXml,
  topicSitemapPages,
  topicSitemapRange,
  xmlEscape,
} from './routes.ts';
import { inTopicRange, type TopicRange } from './sitemap-entries.ts';

vi.mock('./sitemap-entries.ts', async (actual) => ({
  ...(await actual<typeof import('./sitemap-entries.ts')>()),
  sitemapBlogs: async (pool: Pool) => (await pool.query('fixture:blog'))[0],
  sitemapTopicRoutes: async (pool: Pool) => ((await pool.query('fixture:topic'))[0] as unknown[]).length,
  sitemapTopics: async (pool: Pool, range: TopicRange) =>
    ((await pool.query('fixture:topic'))[0] as { entityId: string }[]).filter((row) => inTopicRange(row.entityId, range)),
  sitemapTopicsLastmod: async (pool: Pool) => (await pool.query('fixture:topic-lastmod'))[0],
}));
const topicId = (i: number) => ((i * 2654435761) % 2 ** 32).toString(16).padStart(8, '0') + 'f'.repeat(56);
function fixture(blogCount = 1, lastmod = '2026-01-01T00:00:00.000Z', topicCount = 1) {
  const topics =
    topicCount === 1
      ? [{ entityId: 'a'.repeat(64), canonicalPath: '/topics/%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7/', lastmod: '2026-01-02T00:00:00.000Z' }]
      : Array.from({ length: topicCount }, (_, i) => ({ entityId: topicId(i), canonicalPath: `/topics/topic-${i}/`, lastmod }));
  const query = vi.fn(async (sql: string) => [
    sql === 'fixture:blog'
      ? Array.from({ length: blogCount }, (_, i) => ({
          entityId: String(i + 1),
          canonicalPath: `/blogs/${i === 0 ? 'kocpc' : `blog-${i}`}/`,
          lastmod,
        }))
      : sql === 'fixture:topic-lastmod'
        ? topicCount === 1
          ? '2026-01-02T00:00:00.000Z'
          : lastmod
        : topics,
  ]);
  const app = Fastify({ exposeHeadRoutes: true });
  registerSeoRoutes(app, { query } as unknown as Pool);
  return { app, query };
}
describe('public crawler discovery routes', () => {
  it('serves real robots text with private boundaries and documentation exceptions', async () => {
    const { app, query } = fixture();
    try {
      const get = await app.inject('/robots.txt');
      expect(get.statusCode).toBe(200);
      expect(get.headers['content-type']).toContain('text/plain');
      for (const path of ['/my', '/me', '/auth', '/login', '/admin', '/search', '/api/']) expect(get.body).toContain(`Disallow: ${path}\n`);
      expect(get.body).toContain('Allow: /api/$\n');
      expect(get.body).toContain('Allow: /api/v1/openapi.json$');
      expect(get.body.trimEnd()).toMatch(/Sitemap: https:\/\/blog\.observe\.tw\/sitemap\.xml$/);
      const head = await app.inject({ method: 'HEAD', url: '/robots.txt' });
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe('');
      expect(query).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('serves a namespaced XML index and canonical child URLs with bounded pagination', async () => {
    const { app, query } = fixture(10001);
    try {
      const result = await app.inject('/sitemap.xml');
      expect(result.statusCode).toBe(200);
      expect(result.headers['content-type']).toContain('application/xml');
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(result.body).toContain(`${SEO_ORIGIN}/sitemaps/blogs-2.xml`);
      expect(result.body).not.toContain('blogs-3');
      expect(result.body).toContain('<lastmod>2026-01-01T00:00:00.000Z</lastmod>');
      const second = await app.inject('/sitemaps/blogs-2.xml');
      expect(second.statusCode).toBe(200);
      expect((second.body.match(/<url>/g) || []).length).toBe(1);
      expect(second.body).toContain('/blogs/blog-10000/');
      expect((await app.inject('/sitemaps/blogs-3.xml')).statusCode).toBe(404);
      expect((await app.inject('/sitemaps/blogs-1.xml')).statusCode).toBe(404);
      expect((await app.inject('/sitemaps/private.xml')).statusCode).toBe(404);
      const count = query.mock.calls.length;
      const head = await app.inject({ method: 'HEAD', url: '/sitemap.xml' });
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe('');
      expect(query.mock.calls.length).toBeGreaterThan(count);
    } finally {
      await app.close();
    }
  });
  it('only emits verified blog profiles and matched canonical topics, with actual source lastmod', async () => {
    const { app, query } = fixture();
    try {
      const blogs = await app.inject('/sitemaps/blogs.xml');
      expect(blogs.body).toContain(`${SEO_ORIGIN}/blogs/kocpc/`);
      expect(blogs.body).toContain('<lastmod>2026-01-01T00:00:00.000Z</lastmod>');
      expect(blogs.body).not.toContain('private-source');
      expect(blogs.body).not.toContain('injection');
      const topics = await app.inject('/sitemaps/topics.xml');
      expect(topics.body).toContain(`${SEO_ORIGIN}/topics/%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7/`);
      expect(topics.body).not.toContain('rss:');
      expect(query.mock.calls.some(([sql]) => sql === 'fixture:topic')).toBe(true);
      const head = await app.inject({ method: 'HEAD', url: '/sitemaps/topics.xml' });
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe('');
    } finally {
      await app.close();
    }
  });
  it('static sitemap has only approved landing pages; no article/search/account/API data URLs', async () => {
    const { app } = fixture();
    try {
      const result = await app.inject('/sitemaps/pages.xml');
      expect(result.statusCode).toBe(200);
      for (const path of ['/', '/blogs/', '/topics/', '/api/', '/about/']) expect(result.body).toContain(`<loc>${SEO_ORIGIN}${path}</loc>`);
      expect((result.body.match(/<url>/g) || []).length).toBe(5);
      for (const path of ['/articles/', '/search', '/auth', '/admin', '/my', '/api/v1/'])
        expect(result.body).not.toContain(`<loc>${SEO_ORIGIN}${path}`);
    } finally {
      await app.close();
    }
  });
  it('skips future database timestamps and falls back to a real source mtime rather than now', async () => {
    const { app } = fixture(1, '2099-01-01T00:00:00.000Z');
    try {
      const result = await app.inject('/sitemaps/blogs.xml');
      expect(result.statusCode).toBe(200);
      expect(result.body).not.toContain('2099-01-01');
      const source = await stat(new URL('../../../web/src/app/blogs/[slug]/page.tsx', import.meta.url));
      expect(result.body).toContain(`<lastmod>${source.mtime.toISOString()}</lastmod>`);
      const index = await app.inject('/sitemap.xml');
      expect(index.body).not.toContain('2099-01-01');
      expect((index.body.match(/<lastmod>/g) || []).length).toBe(3);
    } finally {
      await app.close();
    }
  });
  it('escapes XML text, omits invalid dates and rejects over-cap documents', () => {
    expect(xmlEscape('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&apos;');
    expect(sitemapXml([{ loc: 'https://example.test/?a=1&b=<x>', lastmod: 'invalid' }])).toContain('?a=1&amp;b=&lt;x&gt;');
    expect(sitemapXml([{ loc: 'https://example.test/', lastmod: 'invalid' }])).not.toContain('lastmod');
    expect(() => sitemapXml(Array.from({ length: 10001 }, () => ({ loc: SEO_ORIGIN })))).toThrow('entry_limit');
    expect(sitemapChildPaths(10000, SITEMAP_TOPIC_BUCKET + 1)).toEqual([
      '/sitemaps/pages.xml',
      '/sitemaps/blogs.xml',
      '/sitemaps/topics.xml',
      '/sitemaps/topics-2.xml',
    ]);
    expect(sitemapChildPaths(10001, 0)).toEqual([
      '/sitemaps/pages.xml',
      '/sitemaps/blogs.xml',
      '/sitemaps/blogs-2.xml',
      '/sitemaps/topics.xml',
    ]);
    expect(() => sitemapChildPaths(-1, 0)).toThrow();
    expect(() => sitemapChildPaths(0, SITEMAP_TOPIC_BUCKET * 4999 + 1)).toThrow('count_limit');
  });
  it('splits topics into contiguous ID ranges: every ID in exactly one file, boundaries inclusive below', () => {
    expect(topicSitemapPages(0)).toBe(1);
    expect(topicSitemapPages(SITEMAP_TOPIC_BUCKET)).toBe(1);
    expect(topicSitemapPages(49_379)).toBe(50);
    expect(topicSitemapRange(1, 1)).toEqual({ from: null, to: null });
    expect(topicSitemapRange(1, 2)).toEqual({ from: null, to: '80000000' });
    expect(topicSitemapRange(2, 2)).toEqual({ from: '80000000', to: null });
    for (const pages of [2, 3, 7, 50, 257]) {
      const ranges = Array.from({ length: pages }, (_, i) => topicSitemapRange(i + 1, pages));
      for (let i = 1; i < pages; i++) expect(ranges[i].from).toBe(ranges[i - 1].to);
      const edges = [
        '0'.repeat(64),
        'f'.repeat(64),
        ...ranges.flatMap((r) =>
          r.from ? [r.from + '0'.repeat(56), (BigInt(`0x${r.from}`) - 1n).toString(16).padStart(8, '0') + 'f'.repeat(56)] : [],
        ),
      ];
      for (const id of edges) expect(ranges.filter((r) => inTopicRange(id, r))).toHaveLength(1);
    }
  });
  it('serves every topic exactly once across the files the index lists, each under the per-file cap', async () => {
    const count = SITEMAP_TOPIC_BUCKET * 3 + 17;
    const { app } = fixture(1, '2026-01-01T00:00:00.000Z', count);
    try {
      const index = await app.inject('/sitemap.xml');
      const files = [...index.body.matchAll(/<loc>https:\/\/blog\.observe\.tw(\/sitemaps\/topics[^<]*)<\/loc>/g)].map((m) => m[1]);
      expect(files).toEqual(['/sitemaps/topics.xml', '/sitemaps/topics-2.xml', '/sitemaps/topics-3.xml', '/sitemaps/topics-4.xml']);
      const seen: string[] = [];
      for (const file of files) {
        const res = await app.inject(file);
        expect(res.statusCode).toBe(200);
        const urls = [...res.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
        expect(urls.length).toBeGreaterThan(0);
        expect(urls.length).toBeLessThanOrEqual(10_000);
        seen.push(...urls);
      }
      expect(seen).toHaveLength(count);
      expect(new Set(seen).size).toBe(count);
      expect((await app.inject('/sitemaps/topics-5.xml')).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
