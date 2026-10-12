import { stat } from 'node:fs/promises';
import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { registerSeoRoutes, SEO_ORIGIN, sitemapChildPaths, sitemapXml, xmlEscape } from './routes.ts';

vi.mock('./indexability.ts', () => ({
  getIndexablePages: async (pool: Pool, kind: string) => (await pool.query(`fixture:${kind}`))[0],
}));
function fixture(blogCount = 1, lastmod = '2026-01-01T00:00:00.000Z') {
  const query = vi.fn(async (sql: string) => [
    sql === 'fixture:blog'
      ? Array.from({ length: blogCount }, (_, i) => ({
          entityId: String(i + 1),
          canonicalPath: `/blogs/${i === 0 ? 'kocpc' : `blog-${i}`}/`,
          lastmod,
        }))
      : [{ entityId: 'a'.repeat(64), canonicalPath: '/topics/%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7/', lastmod: '2026-01-02T00:00:00.000Z' }],
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
    expect(sitemapChildPaths(10000, 10001)).toEqual([
      '/sitemaps/pages.xml',
      '/sitemaps/blogs.xml',
      '/sitemaps/topics.xml',
      '/sitemaps/topics-2.xml',
    ]);
    expect(() => sitemapChildPaths(-1, 0)).toThrow();
  });
});
