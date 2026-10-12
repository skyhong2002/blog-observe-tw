import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { getPageIndexability, INDEXABILITY_CACHE_MS, topicIndexability, topicIndexabilitySql } from './indexability.ts';

const active = { exclusionReason: null, inactiveReason: null };
describe('shared topic page indexability', () => {
  it('requires at least three articles across at least two blogs', () => {
    expect(topicIndexability({ posts: 3, blogs: 2 }, 'current', active).indexable).toBe(true);
    expect(topicIndexability({ posts: 2, blogs: 2 }, 'current', active).indexabilityReason).toBe('insufficient-posts');
    expect(topicIndexability({ posts: 30, blogs: 1 }, 'current', active).indexabilityReason).toBe('insufficient-blogs');
    expect(INDEXABILITY_CACHE_MS).toBe(300_000);
  });
  it('keeps excluded, inactive and missing current terms readable but noindex', () => {
    const counts = { posts: 100, blogs: 10 };
    expect(topicIndexability(counts, 'current', { ...active, exclusionReason: 'tag-noise' }).indexabilityReason).toBe('excluded-term');
    expect(topicIndexability(counts, 'current', { ...active, inactiveReason: 'low-frequency' }).indexabilityReason).toBe('inactive-term');
    expect(topicIndexability(counts, null, active).indexabilityReason).toBe('not-current-term');
    expect(topicIndexability(counts, 'current', null).indexabilityReason).toBe('not-current-term');
  });
  it('shares one cold projection and reuses it for a low-frequency blog', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM topic_current')) return [[{ id: 'current' }]];
      if (sql.startsWith('WITH ')) return [[]];
      return [[{ entity_id: '1', url: 'https://low-frequency.example/', posts: 0, lastmod: null }]];
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
    expect(query).toHaveBeenCalledTimes(3);
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
