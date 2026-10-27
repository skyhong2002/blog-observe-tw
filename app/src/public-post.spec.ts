import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { publicPost, publicRss, publicSummary } from './public-post.ts';
import { loadSearch, registerSearchRoutes, searchFilters } from './search.ts';

const longText = '公開文字'.repeat(1000) + 'PRIVATE_BODY_TAIL';
describe('public article boundary', () => {
  it('strips markup/scripts, decodes entities and bounds Unicode excerpts', () => {
    expect(publicSummary('<p>茶 &amp; 書</p><script>secret()</script><p>下一段</p>')).toBe('茶 & 書 下一段');
    expect(Array.from(publicSummary('😀'.repeat(600)))).toHaveLength(500);
    expect(publicSummary('😀'.repeat(600)).endsWith('…')).toBe(true);
    expect(publicSummary(null)).toBe('');
  });
  it('allowlists the public DTO and never emits private snapshot fields or full RSS', () => {
    const row = {
      id: 1,
      title: '標題',
      url: 'https://example.com/post',
      summary: longText,
      body_text: 'secret',
      body_html: 'secret',
      content_hash: 'privatehash',
      source_evidence: { private: true },
    };
    const dto = publicPost(row);
    expect(Object.keys(dto)).toEqual(['id', 'title', 'url', 'summary']);
    expect(Array.from(dto.summary as string).length).toBeLessThanOrEqual(500);
    const feed = publicRss([row], '我的閱讀', 'https://weblog.tw');
    expect(feed).not.toContain('PRIVATE_BODY_TAIL');
    expect(feed).not.toContain('secret');
    expect(feed).toContain('<description>');
  });
  it('applies the serializer to individual source and native tag APIs', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM blogs WHERE slug=')) return [[{ id: 1, slug: 'fixture', name: 'Blog' }]];
      if (sql.includes('FROM tags WHERE slug=')) return [[{ id: 1, slug: 'fixture', label: '標籤' }]];
      if (sql.includes('FROM posts WHERE blog_id=') || sql.includes('JOIN post_tags pt ON pt.post_id=p.id JOIN blogs'))
        return [[{ id: 2, title: '文章', summary: longText, body_text: 'secret' }]];
      return [[]];
    });
    // @ts-expect-error injected pool instead of inferred null default
    const app = await buildApp({ login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 }, { store: { pool: { query } } });
    try {
      for (const url of ['/api/blogs/fixture', '/api/tags/fixture']) {
        const r = await app.inject(url);
        expect(r.statusCode, r.body).toBe(200);
        expect(r.body).not.toContain('PRIVATE_BODY_TAIL');
        expect(r.body).not.toContain('body_text');
        expect(Array.from(r.json().posts[0].summary)).toHaveLength(500);
      }
    } finally {
      await app.close();
    }
  });
});
describe('bounded private-body search', () => {
  it('validates query, page, limit, controls and blog scope', () => {
    for (const q of [
      { q: '' },
      { q: 'x'.repeat(81) },
      { q: 'a\nsecret' },
      { q: 'a', page: '51' },
      { q: 'a', limit: '21' },
      { q: 'a', blog: '../x' },
    ])
      expect(searchFilters(q)).toBeNull();
    expect(searchFilters({ q: '旅行', blog: 'my-blog' })).toEqual({ q: '旅行', blog: 'my-blog', page: 1, limit: 20 });
  });
  it('bounds SQL scope before body matching and returns only short snippets', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([Array.from({ length: 1001 }, (_, i) => ({ id: i + 1 }))])
      .mockResolvedValueOnce([
        [{ id: 1, title: '搜尋', summary: longText, searchExcerpt: '內文'.repeat(500), matchSource: 'body', body_text: 'secret' }],
      ]);
    const result = await loadSearch({ query } as unknown as Pool, { q: '10%_=', page: 1, limit: 20, blog: '' });
    expect(query.mock.calls[0][0]).toContain('LIMIT 1001');
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain("b.status='verified'");
      expect(sql).toContain('(p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())');
    }
    expect(query.mock.calls[1][0]).toContain('SUBSTRING(');
    expect(query.mock.calls[1][0]).not.toContain('c.*');
    expect(query.mock.calls[1][1][0]).toBe('%10=%=_==%');
    expect(result.coverage).toMatchObject({ scannedPosts: 1000, truncated: true });
    expect(Array.from(result.items[0].snippet)).toHaveLength(240);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_BODY_TAIL');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('gives same-key requests fresh reads and preserves the two-reader capacity limit', async () => {
    const bothEntered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let scopes = 0;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT p.id FROM posts')) {
        scopes++;
        if (scopes === 2) bothEntered.resolve();
        await release.promise;
        return [[{ id: 1 }]];
      }
      return [[]];
    });
    const app = Fastify();
    registerSearchRoutes(app, { query } as unknown as Pool);
    try {
      // .then starts injection before waiting at the deterministic barrier.
      const first = app.inject('/api/search?q=旅行').then((response) => response);
      const second = app.inject('/api/search?q=旅行').then((response) => response);
      await bothEntered.promise;
      expect(scopes).toBe(2); // A shared in-flight promise cannot satisfy this barrier.
      const busy = await app.inject('/api/search?q=旅行');
      expect(busy.statusCode).toBe(503);
      expect(busy.headers['cache-control']).toBe('no-store');
      expect(query).toHaveBeenCalledTimes(2);
      release.resolve();
      const results = await Promise.all([first, second]);
      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      expect(query).toHaveBeenCalledTimes(4);
      expect(results[0].json()).toMatchObject({ cacheSeconds: 0, coverage: { type: 'bounded-ingestion-metadata' } });
      const next = await app.inject('/api/search?q=旅行');
      expect(next.statusCode).toBe(200);
      expect(next.headers['cache-control']).toBe('no-store');
      expect(query).toHaveBeenCalledTimes(6); // No completed DTO is reused either.
      expect((await app.inject('/api/search?q=x&limit=100')).statusCode).toBe(400);
    } finally {
      release.resolve();
      await app.close();
    }
  });
});
