import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { getIndexablePages, getPageIndexability, INDEXABILITY_CACHE_MS, topicIndexability, topicIndexabilitySql } from './indexability.ts';

const active = { exclusionReason: null, inactiveReason: null };
describe('shared topic page indexability', () => {
  it('never adds minimum article, blog-count or recency gates to a resolvable page', () => {
    for (const counts of [
      { posts: 3, blogs: 2 },
      { posts: 2, blogs: 2 },
      { posts: 30, blogs: 1 },
      { posts: 1, blogs: 1 },
      { posts: 0, blogs: 0 },
    ]) {
      expect(topicIndexability(counts, 'current', active)).toMatchObject({ indexable: true, indexabilityReason: null, ...counts });
    }
    expect(INDEXABILITY_CACHE_MS).toBe(0);
  });
  it('only reports explicit noise and preserves inactive or missing-current page policy', () => {
    const counts = { posts: 0, blogs: 0 };
    expect(topicIndexability(counts, 'current', { ...active, exclusionReason: 'tag-noise' }).indexabilityReason).toBe('excluded-term');
    expect(topicIndexability(counts, 'current', { ...active, label: '???' }).indexabilityReason).toBe('excluded-term');
    expect(topicIndexability(counts, 'current', { ...active, inactiveReason: 'low-frequency' }).indexable).toBe(true);
    expect(topicIndexability(counts, null, active).indexable).toBe(true);
    expect(topicIndexability(counts, 'current', null).indexable).toBe(true);
    for (const label of ['C++', 'C#', 'AI', '台灣'])
      expect(topicIndexability(counts, 'current', { ...active, label }).indexable).toBe(true);
  });
  it("reads only the requested blog's row, never the site-wide projection, and keeps the low-frequency blog policy", async () => {
    const posts = new Map([
      ['1', 0],
      ['3', 4],
    ]);
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM topic_current')) return [[{ id: 'current' }]];
      // Only verified blogs count (2 is a seed); 1 has no recent post and is still indexable.
      return [[{ posts: posts.get(String(params[0])) ?? 0 }]];
    });
    const pool = { query, getConnection: vi.fn() } as unknown as Pool;
    expect(await getPageIndexability(pool, 'blog', '1')).toEqual({
      indexable: true,
      indexabilityReason: null,
      windowDays: 90,
      posts: 0,
      blogs: 1,
      currentVersion: 'current',
    });
    expect((await getPageIndexability(pool, 'blog', '3')).posts).toBe(4);
    expect(await getPageIndexability(pool, 'blog', '2')).toMatchObject({ indexable: true, indexabilityReason: null, posts: 0 });
    expect(pool.getConnection).not.toHaveBeenCalled();
    const counts = query.mock.calls.map(([sql]) => sql).filter((sql) => !sql.includes('FROM topic_current'));
    expect(counts).toHaveLength(3);
    for (const sql of counts) {
      expect(sql).toMatch(/WHERE b\.id=\? AND b\.status='verified'/);
      expect(sql).not.toMatch(/GROUP BY|^WITH /);
    }
  });
  it('shows a change on the very next read (no cached blog counts)', async () => {
    let posts = 1;
    const pool = {
      query: async (sql: string) => (sql.includes('FROM topic_current') ? [[{ id: 'current' }]] : [[{ posts }]]),
    } as unknown as Pool;
    expect((await getPageIndexability(pool, 'blog', '1')).posts).toBe(1);
    posts = 0;
    expect((await getPageIndexability(pool, 'blog', '1')).posts).toBe(0);
  });
  it('keeps a one-post, one-blog topic in the deployed sitemap set', async () => {
    const id = 'a'.repeat(64);
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM topic_current')) return [[{ id: 'current' }]];
      if (sql.startsWith('WITH ')) return [[{ entity_id: id, posts: 1, blogs: 1, lastmod: null }]];
      return [[]];
    });
    const connection = { query, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {} };
    const pool = {
      getConnection: async () => connection,
      query: async () => [[{ entity_id: id, canonical_key: 'single-post', stable_id: `tag:${id}` }]],
    } as unknown as Pool;
    expect(await getIndexablePages(pool, 'topic')).toEqual([
      expect.objectContaining({ entityId: id, posts: 1, blogs: 1, indexable: true, canonicalPath: '/topics/single-post/' }),
    ]);
    expect(await getPageIndexability(pool, 'topic', id)).toMatchObject({ posts: 1, blogs: 1, indexable: true });
  });
  it('uses only current valid verified article evidence and deduplicates title/body per post', () => {
    for (const sql of [
      "b.status='verified'",
      'topic_matches_v3',
      'i.matcher_version=',
      't.policy_version=',
      't.exclusion_reason IS NULL',
      't.inactive_reason IS NULL',
      'GROUP BY p.id,p.blog_id',
      'COUNT(DISTINCT r.blog_id)',
      "i.status='ok'",
      '(i.post_hash<=>p.content_hash)',
      'p.published_at<=?',
    ])
      expect(topicIndexabilitySql).toContain(sql);
  });
});
