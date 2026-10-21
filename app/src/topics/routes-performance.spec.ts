import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { ranking, registerTopicRoutes } from './routes.ts';

const topicRow = (id: string, blogs: number, matchedPosts = 5) => ({
  topic_id: id,
  label: id,
  source: 'tag-vocabulary',
  score: 2,
  posts: 2,
  blogs,
  title_posts: 2,
  body_posts: 0,
  recent_total: 10,
  baseline_total: 20,
  baseline_matched: 2,
  high_frequency: 0,
  matched_posts: matchedPosts,
});

describe('fresh topic ranking coverage', () => {
  it('home view performs one exact ranking read with no full coverage or vocabulary projection', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return [[topicRow('tag:home', 2)]];
      },
    } as unknown as Pool;
    const app = Fastify();
    registerTopicRoutes(app, pool);
    try {
      const response = await app.inject('/api/topics?days=30&view=home');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ view: 'home', days: 30, limit: 8, minimumBlogs: 2, cacheSeconds: 300 });
      expect(response.json()).not.toHaveProperty('coverage');
      expect(response.json()).not.toHaveProperty('vocabulary');
      expect(queries).toHaveLength(1);
      expect(queries[0]).not.toContain('ROW_NUMBER');
      // 60 cloud candidates (+1 truncation probe); the left list still sends 8.
      expect(queries[0]).toContain('LIMIT 61');
      expect(response.json().items.length).toBeLessThanOrEqual(8);
      // Term tables are read once per (term, blog), and the window posts drive the index join.
      expect(queries[0]).toContain('GROUP BY m.snapshot_id,m.term_id,p.blog_id');
      expect(queries[0]).toContain('STRAIGHT_JOIN topic_post_indexes_v3 i');
      expect(queries[0]).toContain('STRAIGHT_JOIN post_tags native_pt');
      expect(queries[0]).toContain('SELECT DISTINCT p.id,p.blog_id,p.published_at,i.snapshot_id');
      expect(queries[0]).toContain("b.status='verified'");
      expect(queries[0]).toContain('(i.post_hash<=>p.content_hash)');
      expect(queries[0]).toContain('(i.body_hash<=>');
      expect(queries[0]).toContain('t.exclusion_reason IS NULL');
      expect(queries[0]).toContain('t.inactive_reason IS NULL');
      for (const path of ['/api/topics?view=bad', '/api/topics?days=bad&view=home']) {
        const bad = await app.inject(path);
        expect(bad.statusCode).toBe(400);
        expect(bad.headers['cache-control']).toBe('no-store');
      }
      expect(queries).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
  it('home ranking without a snapshot: a read after a hide commit does not inherit the older in-flight result', async () => {
    let hidden = false,
      release!: () => void,
      started!: () => void;
    const barrier = new Promise<void>((resolve) => {
        release = resolve;
      }),
      reading = new Promise<void>((resolve) => {
        started = resolve;
      });
    let reads = 0;
    const pool = {
      query: async () => {
        reads++;
        const rows = hidden ? [] : [topicRow('tag:old', 2)];
        if (reads === 1) {
          started();
          await barrier;
        }
        return [rows];
      },
    } as unknown as Pool;
    const app = Fastify();
    // With the home snapshot off (home-snapshot.ts), each read is its own.
    registerTopicRoutes(app, pool, { rankingRefreshMs: 0 });
    try {
      const a = app.inject('/api/topics?days=30&view=home');
      await reading;
      hidden = true;
      const b = await app.inject('/api/topics?days=30&view=home');
      expect(b.json().items).toEqual([]);
      expect(reads).toBe(2);
      release();
      expect((await a).json().items).toHaveLength(1);
    } finally {
      release();
      await app.close();
    }
  });
  it('order=blogs ranks by participating blogs; heat stays the default; anything else is refused', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('topic_gate AS')) return [[{ n: 5 }]];
        if (sql.includes('per_blog AS')) return [[topicRow('tag:a', 3)]];
        if (sql.includes('SELECT s.id,s.manifest')) return [[]];
        if (sql.includes('datedPosts')) return [[{ datedPosts: 10, bodyObservedPosts: 7 }]];
        if (sql.includes('unknownDatePosts')) return [[{ unknownDatePosts: 2 }]];
        return [[{ n: 0 }]];
      },
    } as unknown as Pool;
    const app = Fastify();
    registerTopicRoutes(app, pool);
    try {
      const blogs = await app.inject('/api/topics?days=30&order=blogs');
      expect(blogs.statusCode).toBe(200);
      expect(blogs.json().order).toBe('blogs');
      expect(queries.find((sql) => sql.includes('per_blog AS'))).toContain('ORDER BY blogs DESC,score DESC,posts DESC,topic_id');
      queries.length = 0;
      const heat = await app.inject('/api/topics?days=30');
      expect(heat.json().order).toBe('heat');
      expect(queries.find((sql) => sql.includes('per_blog AS'))).toContain('ORDER BY rank_score DESC');
      for (const path of ['/api/topics?days=30&order=posts', '/api/topics?days=30&view=home&order=blogs']) {
        const bad = await app.inject(path);
        expect(bad.statusCode).toBe(400);
        expect(bad.json().error).toBe('invalid_order');
      }
    } finally {
      await app.close();
    }
  });
  it('full rankings are served from the snapshot, one entry per period and order', async () => {
    let reads = 0;
    const pool = {
      query: async (sql: string) => {
        if (sql.includes('topic_gate AS')) return [[{ n: 5 }]];
        if (sql.includes('per_blog AS')) return [[topicRow(`tag:read-${++reads}`, 3)]];
        if (sql.includes('SELECT s.id,s.manifest')) return [[]];
        if (sql.includes('datedPosts')) return [[{ datedPosts: 10, bodyObservedPosts: 7 }]];
        if (sql.includes('unknownDatePosts')) return [[{ unknownDatePosts: 2 }]];
        return [[{ n: 0 }]];
      },
    } as unknown as Pool;
    const app = Fastify();
    registerTopicRoutes(app, pool);
    try {
      const first = await app.inject('/api/topics?days=30&order=blogs');
      const second = await app.inject('/api/topics?days=30&order=blogs');
      expect(first.json().cacheSeconds).toBe(300);
      expect(second.json().items[0].id).toBe(first.json().items[0].id);
      expect(reads).toBe(1);
      await app.inject('/api/topics?days=30');
      await app.inject('/api/topics?days=7&order=blogs');
      expect(reads).toBe(3);
    } finally {
      await app.close();
    }
  });
  it('retains coverage when all matched topics have only one blog', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return [[topicRow('tag:single', 1)]];
      },
    } as unknown as Pool;
    const result = await ranking(pool, 30, undefined, true, 100, new Date('2026-10-13T00:00:00Z'), true);
    expect(result).toEqual({ items: [], truncated: false, matchedPosts: 5 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY topic_id)=1 first_match');
    expect(queries[0]).toContain('(SELECT COUNT(DISTINCT post_id) FROM recent) matched_posts');
    expect(queries[0]).toContain('ORDER BY (ranked.blogs>=2 AND background_excluded=0) DESC,ranked.score DESC');
    expect(queries[0]).not.toContain('HAVING COUNT(*)>=2');
    expect(queries[0]).toContain("b.status='verified'");
    expect(queries[0]).toContain('p.published_at>=? AND p.published_at<=?');
    expect(queries[0]).toContain('(i.post_hash<=>p.content_hash)');
    expect(queries[0]).toContain('(i.body_hash<=>');
    expect(queries[0]).toContain('t.exclusion_reason IS NULL AND t.inactive_reason IS NULL');
  });
  it('retains policy-qualified coverage when every topic is excluded from display as background', async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return [[{ ...topicRow('tag:background', 3), background_excluded: 1 }]];
      },
    } as unknown as Pool;
    const result = await ranking(pool, 30, undefined, true, 100, new Date('2026-10-13T00:00:00Z'), true);
    expect(result).toEqual({ items: [], truncated: false, matchedPosts: 5 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toContain('WHERE NOT COALESCE');
    expect(queries[0]).toContain('background_excluded=0');
  });

  it('counts the extra eligible row for truncation and removes coverage-only rows', async () => {
    const pool = { query: async () => [[topicRow('tag:a', 2), topicRow('tag:b', 2)]] } as unknown as Pool;
    const result = await ranking(pool, 30, undefined, true, 1, new Date(), true);
    expect(result.items.map((row) => row.id)).toEqual(['tag:a']);
    expect(result.truncated).toBe(true);
    expect(result.matchedPosts).toBe(5);
    const oneBlogPool = { query: async () => [[topicRow('tag:a', 2), topicRow('tag:single', 1)]] } as unknown as Pool;
    expect((await ranking(oneBlogPool, 30, undefined, true, 1, new Date(), true)).truncated).toBe(false);
    const emptyPool = { query: async () => [[]] } as unknown as Pool;
    expect(await ranking(emptyPool, 30, undefined, true, 1, new Date(), true)).toEqual({ items: [], truncated: false, matchedPosts: 0 });
  });

  it('uses independent concurrent reads with at most two concurrent queries per request and no repeat evidence scan', async () => {
    let active = 0;
    let maxActive = 0;
    let rankingReads = 0;
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        if (sql.includes('topic_gate AS')) return [[{ n: 5 }]];
        if (sql.includes('per_blog AS')) return [[topicRow(`tag:read-${++rankingReads}`, 2)]];
        if (sql.includes('SELECT s.id,s.manifest')) return [[]];
        if (sql.includes('datedPosts')) return [[{ datedPosts: 10, bodyObservedPosts: 7 }]];
        if (sql.includes('unknownDatePosts')) return [[{ unknownDatePosts: 2 }]];
        if (sql.includes("i.status='capped'")) return [[{ n: 1 }]];
        throw new Error('unexpected_query');
      },
    } as unknown as Pool;
    const app = Fastify();
    registerTopicRoutes(app, pool, { rankingRefreshMs: 0 });
    try {
      const first = await app.inject('/api/topics?days=30');
      const second = await app.inject('/api/topics?days=30');
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.json().cacheSeconds).toBe(0);
      expect(first.json().coverage).toEqual({ datedPosts: 10, unknownDatePosts: 2, bodyObservedPosts: 7, matchedPosts: 5, cappedPosts: 1 });
      expect(first.json().items[0].id).not.toBe(second.json().items[0].id);
      expect(first.json()).not.toHaveProperty('matchedPosts');
      expect(maxActive).toBe(2);
      // Two match statements per request: the ranking reads topic_matches_v3 once; the matched-post count
      // reads it for the per-term gate and again to count posts. None re-evaluates a shared evidence CTE.
      const scans = queries.filter((sql) => sql.includes('topic_matches_v3')).map((sql) => sql.match(/JOIN topic_matches_v3/g)?.length);
      expect(scans).toEqual([1, 2, 1, 2]);
      expect(queries).toHaveLength(12);
      const overlapping = await Promise.all([app.inject('/api/topics?days=30'), app.inject('/api/topics?days=30')]);
      expect(overlapping[0].json().items[0].id).not.toBe(overlapping[1].json().items[0].id);
      expect(rankingReads).toBe(4);
      expect(queries.filter((sql) => sql.includes('topic_matches_v3'))).toHaveLength(8);
      expect(queries).toHaveLength(24);
      expect((await app.inject('/api/topics?days=bad')).headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
});
