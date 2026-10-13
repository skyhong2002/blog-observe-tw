import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, expect, it, vi } from 'vitest';
import { loadSearch, registerSearchRoutes, searchFilters } from './search.ts';
import { literalSearchPattern } from './search-bounds.ts';

afterEach(() => vi.unstubAllEnvs());
it('escapes LIKE wildcards as literal search characters', () => {
  expect(literalSearchPattern('10%_=')).toBe('%10=%=_==%');
});
it('rejects oversized/control queries and invalid pagination', () => {
  expect(searchFilters({ q: 'a'.repeat(81) })).toBeNull();
  expect(searchFilters({ q: 'a\u0000' })).toBeNull();
  expect(searchFilters({ q: 'x', page: '0' })).toBeNull();
  expect(searchFilters({ q: ' ＡＢＣ ' })?.q).toBe('ABC');
});
it.each(['title', 'summary', 'blog-name', 'tag'])('keeps %s metadata context without historical body read', async (context) => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([[{ id: 40001 }]])
    .mockResolvedValueOnce([[{ id: 40001, title: '一般', searchExcerpt: '蛤蜊絲瓜', matchSource: 'metadata', contextSource: context }]]);
  const r = await loadSearch({ query } as unknown as Pool, { q: '蛤蜊絲瓜', page: 1, limit: 20, blog: '' }, { historicalBody: false });
  expect(r.items[0]).toMatchObject({ articleId: 40001, contextSource: context, matchSource: 'metadata' });
  expect(r.coverage.metadata).toMatchObject({ scope: 'latest-ingested-ids', exhaustive: false });
  expect(r.coverage.historicalBody.status).toBe('not-enabled');
  expect(query).toHaveBeenCalledTimes(2);
  for (const [sql, params] of query.mock.calls) {
    expect((sql.match(/\?/g) || []).length).toBe(params.length);
    expect(sql).not.toContain('content_post_bodies');
  }
});
it('flag defaultoff performs only metadata SQL', async () => {
  vi.stubEnv('BLOG_SEARCH_HISTORICAL_BODY_ENABLED', 'false');
  const query = vi.fn().mockResolvedValue([[]]);
  expect(
    (await loadSearch({ query } as unknown as Pool, { q: '蛤蜊絲瓜', page: 1, limit: 20, blog: '' })).coverage.historicalBody.status,
  ).toBe('not-enabled');
  expect(query).toHaveBeenCalledTimes(1);
});
it('anonymous repeated request rereads rather than caches or coalesces', async () => {
  const query = vi.fn().mockResolvedValue([[]]);
  const app = Fastify();
  registerSearchRoutes(app, { query } as unknown as Pool);
  try {
    for (let i = 0; i < 2; i++) {
      const r = await app.inject('/api/search?q=test');
      expect(r.statusCode).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect(query).toHaveBeenCalledTimes(2);
  } finally {
    await app.close();
  }
});
it('query errors retain no-store and unavailable status instead of fakeempty', async () => {
  const query = vi.fn().mockRejectedValue({ code: 'ER_STATEMENT_TIMEOUT' });
  const app = Fastify();
  registerSearchRoutes(app, { query } as unknown as Pool);
  try {
    const r = await app.inject('/api/search?q=test');
    expect(r.statusCode).toBe(503);
    expect(r.json()).toEqual({ error: 'search_timeout' });
    expect(r.headers['cache-control']).toBe('no-store');
  } finally {
    await app.close();
  }
});
