import { stat } from 'node:fs/promises';
import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { registerSeoRoutes, SEO_ORIGIN, sitemapChildPaths, sitemapXml, xmlEscape } from './routes.ts';

const hash = 'a'.repeat(64);
function fixture(blogCount = 1, lastmod = '2026-01-01T00:00:00.000Z') {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('COUNT(DISTINCT topic_id)')) return [[{ n: 1 }]];
    if (sql.startsWith('SELECT COUNT(*) n,MAX(')) return [[{ n: blogCount, lastmod }]];
    if (sql.startsWith('SELECT b.slug'))
      return [
        [
          { slug: 'kocpc', url: 'https://www.kocpc.com.tw/', status: 'verified', lastmod },
          { slug: 'private-source', url: 'https://private.example/', status: 'seed', lastmod: null },
          { slug: 'bad<injection', url: 'https://bad.example/', status: 'verified', lastmod: null },
        ],
      ];
    return [
      [
        { topic_id: `tag:${hash}`, lastmod: '2026-01-02T00:00:00.000Z' },
        { topic_id: 'rss:999', lastmod: null },
      ],
    ];
  });
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
      expect(result.headers['cache-control']).toContain('s-maxage=300');
      expect(result.body).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(result.body).toContain(`${SEO_ORIGIN}/sitemaps/blogs-2.xml`);
      expect(result.body).not.toContain('blogs-3');
      expect(result.body).toContain('<lastmod>2026-01-01T00:00:00.000Z</lastmod>');
      const second = await app.inject('/sitemaps/blogs-2.xml');
      expect(second.statusCode).toBe(200);
      expect(query.mock.calls.some(([sql]) => sql.includes('LIMIT 10000 OFFSET 10000'))).toBe(true);
      expect((await app.inject('/sitemaps/blogs-3.xml')).statusCode).toBe(404);
      expect((await app.inject('/sitemaps/blogs-1.xml')).statusCode).toBe(404);
      expect((await app.inject('/sitemaps/private.xml')).statusCode).toBe(404);
      const count = query.mock.calls.length;
      const head = await app.inject({ method: 'HEAD', url: '/sitemap.xml' });
      expect(head.statusCode).toBe(200);
      expect(head.body).toBe('');
      expect(query.mock.calls.length).toBe(count);
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
      expect(topics.body).toContain(`${SEO_ORIGIN}/topics/tag%3A${hash}/`);
      expect(topics.body).not.toContain('rss:');
      const sql = query.mock.calls.map(([text]) => text).find((text) => text.includes('GROUP BY r.topic_id'))!;
      expect(sql).toContain("b.status='verified'");
      expect(sql).toContain('t.exclusion_reason IS NULL');
      expect(sql).toContain("i.status='ok'");
      expect(sql).toContain('topic_matches_v3');
      expect(sql).toContain('i.matcher_version=');
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
    const { app, query } = fixture(1, '2099-01-01T00:00:00.000Z');
    try {
      const result = await app.inject('/sitemaps/blogs.xml');
      expect(result.statusCode).toBe(200);
      expect(result.body).not.toContain('2099-01-01');
      const source = await stat(new URL('../../../web/src/app/blogs/[slug]/page.tsx', import.meta.url));
      expect(result.body).toContain(`<lastmod>${source.mtime.toISOString()}</lastmod>`);
      const statements = query.mock.calls.map(([sql]) => sql);
      for (const field of ['updated_at', 'published_at', 'created_at'])
        expect(statements.some((sql) => sql.includes(`CASE WHEN p.${field}<=UTC_TIMESTAMP() THEN p.${field} END`))).toBe(true);
      expect(statements.some((sql) => sql.includes('CASE WHEN b.discovered_at<=UTC_TIMESTAMP() THEN b.discovered_at END'))).toBe(true);
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
