import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { loadOverview } from './overview.js';

describe('read-only frontend projection', () => {
  it('home view queries only its bounded visible rows and omits the full blog catalog', async () => {
    const statements: string[] = [];
    let active = 0,
      peak = 0;
    const pool = {
      query: async (sql: string) => {
        statements.push(sql);
        active++;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active--;
        return [sql.includes('AS blogs,') ? [{ blogs: 2, posts: 7, updatedAt: null }] : []];
      },
    };
    const data = await loadOverview(pool, { home: true });
    expect(statements).toHaveLength(4);
    expect(peak).toBe(2);
    expect(statements.filter((sql) => sql.includes('LIMIT 7'))).toHaveLength(0);
    expect(statements.filter((sql) => sql.includes('eligible_links'))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes('LIMIT 30'))).toHaveLength(0);
    expect(statements.filter((sql) => sql.includes('LIMIT 8'))).toHaveLength(1);
    expect(statements.filter((sql) => sql.includes('LIMIT 10'))).toHaveLength(1);
    expect(statements.some((sql) => sql.includes('b.description'))).toBe(false);
    expect(statements.some((sql) => sql.includes('ORDER BY postCount DESC'))).toBe(false);
    expect(statements.every((sql) => sql.includes("status='verified'"))).toBe(true);
    expect(statements[0]).toContain("l.location='body'");
    expect(statements[0]).toContain("b.status='verified'");
    expect(data.posts).toEqual([]);
    expect(data.tags).toEqual([]);
    expect(data.mentions).toMatchObject({ items: [], days: 90, evidenceType: 'direct-link' });
    expect(data.blogs).toEqual([]);
    expect(data.view).toBe('home');
    expect(data.cacheSeconds).toBe(0);
  });
  it('home request starting after hide commit reads independently while the older request is blocked', async () => {
    let hidden = false,
      release!: () => void,
      first = true;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('eligible_links')) {
        const rows = hidden
          ? []
          : [
              {
                postId: 1,
                postTitle: 'old visible',
                publishedAt: '2026-10-14T01:00:00Z',
                sourceBlogId: 1,
                sourceBlogSlug: 'a',
                sourceBlogName: 'A',
                targetBlogId: 2,
                targetBlogSlug: 'b',
                targetBlogName: 'B',
                matchVersion: 'relations-v2',
              },
            ];
        if (first) {
          first = false;
          await barrier;
        }
        return [rows];
      }
      return [sql.includes('AS blogs,') ? [{ blogs: hidden ? 0 : 1, posts: hidden ? 0 : 1, updatedAt: null }] : []];
    });
    const pool = { query };
    const a = loadOverview(pool, { home: true });
    hidden = true;
    const b = await loadOverview(pool, { home: true });
    expect(b.posts).toEqual([]);
    expect(b.mentions.items).toEqual([]);
    expect(b.totals.blogs).toBe(0);
    release();
    expect((await a).mentions.items).toHaveLength(1);
    expect(query).toHaveBeenCalledTimes(8);
  });
  it('overview view input is bounded and all outcomes stay no-store', async () => {
    const query = vi.fn(async (sql: string) => [sql.includes('AS blogs,') ? [{ blogs: 0, posts: 0, updatedAt: null }] : []]);
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      {
        // @ts-expect-error JS gateway accepts injected pool.
        store: { pool: { query } },
      },
    );
    try {
      const bad = await app.inject('/api/overview?view=unknown');
      expect(bad.statusCode).toBe(400);
      expect(bad.headers['cache-control']).toContain('no-store');
      expect(query).not.toHaveBeenCalled();
      const home = await app.inject('/api/overview?view=home');
      expect(home.statusCode).toBe(200);
      expect(home.json().view).toBe('home');
      expect(home.headers['cache-control']).toContain('no-store');
      expect(query).toHaveBeenCalledTimes(4);
      const full = await app.inject('/api/overview');
      expect(full.statusCode).toBe(200);
      expect(full.json()).not.toHaveProperty('view');
      expect(query).toHaveBeenCalledTimes(10);
    } finally {
      await app.close();
    }
  });
  it('mentions timeout degrades to an explicit unavailable section while other home data stays available', async () => {
    const failure = Object.assign(Error('private database text'), {
      code: 'ER_STATEMENT_TIMEOUT', sql: 'private SQL text', sqlMessage: 'private query context',
    });
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      {
        // @ts-expect-error JS gateway accepts injected pool.
        store: { pool: { query: async (sql) => {
          if (sql.includes('eligible_links')) throw failure;
          return [sql.includes('AS blogs,') ? [{ blogs: 2, posts: 7, updatedAt: null }] : []];
        } } },
      },
    );
    const logger = vi.spyOn(app.log, 'error');
    try {
      const response = await app.inject('/api/overview?view=home');
      expect(response.statusCode).toBe(200);
      expect(response.json().mentions).toMatchObject({ status: 'unavailable', items: [] });
      expect(response.json().totals).toEqual({ blogs: 2, posts: 7 });
      expect(response.headers['cache-control']).toContain('no-store');
      expect(logger).toHaveBeenCalledWith(expect.objectContaining({ operation: 'overview', view: 'home',
        queryStage: 'home.mentions', failureKind: 'statement-timeout', databaseCode: 'ER_STATEMENT_TIMEOUT' }), 'public overview read degraded');
      expect(JSON.stringify(logger.mock.calls)).not.toContain('private');
    } finally { await app.close(); }
  });
  it('still returns unavailable when a non-mentions home query fails', async () => {
    const failure = Object.assign(Error('private database text'), { code: 'ER_CON_COUNT_ERROR' });
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      {
        // @ts-expect-error JS gateway accepts an injected pool.
        store: { pool: { query: async (sql: string) => { if (sql.includes('eligible_links')) return [[]]; throw failure; } } },
      },
    );
    try {
      const response = await app.inject('/api/overview?view=home');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'unavailable' });
    } finally { await app.close(); }
  });
  it('does not retain a degraded mentions result after a later successful read', async () => {
    let fail = true;
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      {
        // @ts-expect-error JS gateway accepts an injected pool.
        store: { pool: { query: async (sql: string) => {
          if (sql.includes('eligible_links') && fail) throw Object.assign(Error('timeout'), { errno: 1969 });
          return [sql.includes('AS blogs,') ? [{ blogs: 1, posts: 1, updatedAt: null }] : []];
        } } },
      },
    );
    try {
      const first = await app.inject('/api/overview?view=home');
      expect(first.statusCode).toBe(200);
      expect(first.json().mentions.status).toBe('unavailable');
      fail = false;
      const second = await app.inject('/api/overview?view=home');
      expect(second.statusCode).toBe(200);
      expect(second.json().mentions.status).toBe('available');
    } finally {
      await app.close();
    }
  });
  it('reads each homepage independently and rejects overflow without retaining completed content', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const query = vi.fn(async (sql: string) => {
      await barrier;
      return [sql.includes('AS blogs,') ? [{ blogs: 1, posts: 1, updatedAt: null }] : []];
    });
    const pool = { query };
    const pending = Array.from({ length: 8 }, () => loadOverview(pool));
    try {
      expect(query).toHaveBeenCalledTimes(48);
      await expect(loadOverview(pool)).rejects.toThrow('topic_cache_busy');
      expect(query).toHaveBeenCalledTimes(48);
    } finally {
      release();
    }
    const results = await Promise.all(pending);
    expect(results.every((r) => r.cacheSeconds === 0)).toBe(true);
    await loadOverview(pool);
    expect(query).toHaveBeenCalledTimes(54);
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
    expect(sql[4]).toContain('(p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())');
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
