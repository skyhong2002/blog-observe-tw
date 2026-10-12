import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadOverview } from './overview.js';

describe('read-only frontend projection', () => {
  it('returns separate indexed counts and the actual collection timestamp', async () => {
    const responses = [
      [{ title: '一張照片', publishedAt: null }],
      [{ label: '生活', postCount: 2, blogCount: 1 }],
      [],
      [],
      [{ blogs: 135, posts: 88, updatedAt: '2026-10-12T02:56:36Z' }],
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
