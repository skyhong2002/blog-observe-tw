import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { auditTopicDisplay } from './display-audit.ts';
import { evidence } from './routes.ts';

describe('single-term display audit', () => {
  it('reports body contribution exclusion without deleting terms, labels or history', async () => {
    const query = vi.fn(async (_sql: string) => [
      [
        {
          label: '每天',
          publicPosts: 2902,
          evidencePosts: 144,
          titlePosts: 11,
          sourceBlogs: 68,
          titleOnly: 1,
          twiceSources: 22,
          peakPosts: 9,
        },
      ],
    ]);
    const a = await auditTopicDisplay({ query } as unknown as Pool, `tag:${'a'.repeat(64)}`, 30);
    expect(a).toMatchObject({
      label: '每天',
      evidencePosts: 144,
      titlePosts: 11,
      bodyOnlyPosts: 133,
      titleOnly: true,
      eligibleRankingPosts: 11,
      sourcePoolRetained: true,
      historicalEvidenceRetained: true,
      reason: 'high-window-document-frequency-title-only',
    });
    expect(query.mock.calls[0][0]).toContain(evidence(false, true, true));
    expect(query.mock.calls[0][0]).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });
  it('rejects injection/date/period before querying and distinguishes absence from a query failure', async () => {
    const query = vi.fn(async (_sql: string) => [
      [{ publicPosts: 3, evidencePosts: 0, titlePosts: 0, sourceBlogs: 0, titleOnly: 0, twiceSources: 0, peakPosts: 0 }],
    ]);
    const pool = { query } as unknown as Pool;
    await expect(auditTopicDisplay(pool, "tag:';DROP TABLE posts", 30)).rejects.toThrow('invalid_topic_display_audit');
    expect(query).not.toHaveBeenCalled();
    expect(await auditTopicDisplay(pool, `tag:${'a'.repeat(64)}`, 30)).toMatchObject({ label: null, reason: 'no-public-ranking-evidence' });
    query.mockRejectedValueOnce(Error('query_timeout'));
    await expect(auditTopicDisplay(pool, `tag:${'a'.repeat(64)}`, 30)).rejects.toThrow('query_timeout');
  });
});
