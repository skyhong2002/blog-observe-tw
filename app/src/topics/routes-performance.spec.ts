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
    expect(queries[0]).toContain('SUM(ranked.matched_n) OVER () matched_posts');
    expect(queries[0]).toContain('ORDER BY (blogs>=2) DESC,score DESC');
    expect(queries[0]).not.toContain('HAVING COUNT(*)>=2');
    expect(queries[0]).toContain("b.status='verified'");
    expect(queries[0]).toContain('p.published_at>=? AND p.published_at<=?');
    expect(queries[0]).toContain('(i.post_hash<=>p.content_hash)');
    expect(queries[0]).toContain('(i.body_hash<=>');
    expect(queries[0]).toContain('t.exclusion_reason IS NULL AND t.inactive_reason IS NULL');
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

  it('uses independent concurrent reads with at most two queries per request and no repeat evidence scan', async () => {
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
        if (sql.includes('per_blog AS')) return [[topicRow(`tag:read-${++rankingReads}`, 2)]];
        if (sql.includes('SELECT s.id,s.manifest')) return [[]];
        if (sql.includes('datedPosts')) return [[{ datedPosts: 10, bodyObservedPosts: 7 }]];
        if (sql.includes('unknownDatePosts')) return [[{ unknownDatePosts: 2 }]];
        if (sql.includes("i.status='capped'")) return [[{ n: 1 }]];
        throw new Error('unexpected_query');
      },
    } as unknown as Pool;
    const app = Fastify();
    registerTopicRoutes(app, pool);
    try {
      const first = await app.inject('/api/topics?days=30');
      const second = await app.inject('/api/topics?days=30');
      expect(first.headers['cache-control']).toBe('no-store');
      expect(first.json().cacheSeconds).toBe(0);
      expect(first.json().coverage).toEqual({ datedPosts: 10, unknownDatePosts: 2, bodyObservedPosts: 7, matchedPosts: 5, cappedPosts: 1 });
      expect(first.json().items[0].id).not.toBe(second.json().items[0].id);
      expect(first.json()).not.toHaveProperty('matchedPosts');
      expect(maxActive).toBe(2);
      expect(queries.filter((sql) => sql.includes('topic_matches_v3'))).toHaveLength(2);
      expect(queries).toHaveLength(10);
      const overlapping = await Promise.all([app.inject('/api/topics?days=30'), app.inject('/api/topics?days=30')]);
      expect(overlapping[0].json().items[0].id).not.toBe(overlapping[1].json().items[0].id);
      expect(rankingReads).toBe(4);
      expect(queries.filter((sql) => sql.includes('topic_matches_v3'))).toHaveLength(4);
      expect(queries).toHaveLength(20);
      expect((await app.inject('/api/topics?days=bad')).headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
});
