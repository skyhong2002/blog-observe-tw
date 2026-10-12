import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadOverview } from './overview.js';

describe('read-only frontend projection', () => {
  it('coalesces the homepage projection per pool for sixty seconds', async () => {
    const query = vi.fn(async (sql: string) => [sql.includes('AS blogs,') ? [{ blogs: 1, posts: 1, updatedAt: null }] : []]);
    const pool = { query };
    const results = await Promise.all(Array.from({ length: 12 }, () => loadOverview(pool)));
    expect(query).toHaveBeenCalledTimes(6);
    expect(results[0].cacheSeconds).toBe(60);
    await loadOverview(pool);
    expect(query).toHaveBeenCalledTimes(6);
  });
  it('returns separate indexed counts and the actual collection timestamp', async () => {
    const responses = [
      [{ title: '一張照片', publishedAt: null }],
      [{ label: '生活', postCount: 2, blogCount: 1 }],
      [],
      [],
      [{ blogs: 135, posts: 88, updatedAt: '2026-10-12T02:56:36Z' }],
      [
        {
          id: 99,
          slug: 'low-frequency',
          postCount: '1',
          latestPostId: 7,
          latestPostTitle: '最新',
          latestPostUrl: 'https://low.example/new',
          latestPostPublishedAt: '2026-10-12T02:00:00Z',
        },
      ],
    ];
    const sql: string[] = [];
    const data = await loadOverview({
      query: async (query: string) => {
        sql.push(query);
        return [responses.shift()];
      },
    });
    expect(data.totals).toEqual({ blogs: 135, posts: 88 });
    expect(data.updatedAt).toBe('2026-10-12T02:56:36Z');
    expect(data.posts[0].publishedAt).toBeNull();
    expect(sql.every((query) => query.trim().startsWith('SELECT'))).toBe(true);
    expect(sql[1]).toContain("t.visibility='public'");
    expect(sql[0]).toContain('(p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())');
    expect(sql[4]).not.toContain('published_at<=');
    expect(data.recentBlogs[0]).toMatchObject({ slug: 'low-frequency', postCount: 1, latestPost: { id: 7, title: '最新' } });
    expect(data.recentBlogs[0]).not.toHaveProperty('latestPostId');
    expect(sql[5]).toContain('ORDER BY latest.published_at DESC');
    expect(sql[5]).not.toContain('ORDER BY postCount');
  });

  it('terminates unknown API paths at the gateway instead of looping through Next', async () => {
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      {
        // @ts-expect-error JS gateway accepts an injected pool; its default is inferred as null.
        store: { pool: { query: async () => [[]] } },
      },
    );
    try {
      const response = await app.inject('/api/does-not-exist');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not found' });
    } finally {
      await app.close();
    }
  });
});
