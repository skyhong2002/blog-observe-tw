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
  it('shares one cold projection and reuses it for a low-frequency blog', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM topic_current')) return [[{ id: 'current' }]];
      if (sql.startsWith('WITH ')) return [[]];
      return [
        [
          { entity_id: '1', slug: 'low-frequency', status: 'verified', url: 'https://low-frequency.example/', posts: 0, lastmod: null },
          { entity_id: '2', slug: 'seed-blog', status: 'seed', url: null, posts: 0, lastmod: null },
        ],
      ];
    });
    const connection = {
      query,
      beginTransaction: vi.fn(async () => {}),
      commit: vi.fn(async () => {}),
      rollback: vi.fn(async () => {}),
      release: vi.fn(),
    };
    const pool = { getConnection: vi.fn(async () => connection) } as unknown as Pool;
    const results = await Promise.all(Array.from({ length: 20 }, () => getPageIndexability(pool, 'blog', '1')));
    expect(results.every((row) => row.indexable && row.posts === 0 && row.currentVersion === 'current')).toBe(true);
    expect(pool.getConnection).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(3);
    await getPageIndexability(pool, 'blog', '1');
    expect(query).toHaveBeenCalledTimes(6);
    expect(await getPageIndexability(pool, 'blog', '2')).toMatchObject({ indexable: true, indexabilityReason: null, posts: 0 });
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
