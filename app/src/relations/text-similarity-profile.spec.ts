import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadProfileTextSimilarity, selectProfileSimilarity } from './text-similarity-profile.ts';
import { loadTextSimilarity } from './text-similarity-reader.ts';

vi.mock('./text-similarity-reader.ts', () => ({ loadTextSimilarity: vi.fn() }));
const link = (postId = 1, targetPostId: number | null = 2) => ({
  postId,
  targetPostId,
  sourceBlogId: 5,
  targetBlogId: 6,
  location: 'body',
});
const pool = {} as Pool;
beforeEach(() => {
  vi.mocked(loadTextSimilarity).mockReset();
});
describe('bounded profile consumer of independently read body evidence', () => {
  it('defaults off, even malformed evidence does not read bodies', async () => {
    expect(await loadProfileTextSimilarity(pool, 5, null as never)).toEqual({ status: 'not-enabled' });
    expect(loadTextSimilarity).not.toHaveBeenCalled();
  });
  it('excludes incoming, same blog, unknown target, non-body and invalid identities', () => {
    const rows = [
      link(),
      ...['blogroll', 'sidebar', 'comment'].map((location) => ({ ...link(), location })),
      { ...link(), sourceBlogId: 6 },
      { ...link(), targetBlogId: 5 },
      link(3, null),
      link(3, 3),
      link(0, 4),
      link(3, NaN),
    ];
    expect(selectProfileSimilarity(5, rows)).toEqual({
      pairs: [{ sourceArticleId: 1, targetArticleId: 2, expectedTargetBlogId: 6 }],
      truncated: false,
    });
  });
  it('deduplicates article pairs without changing citation observations or creating a Cartesian product', () => {
    const rows = [link(), link(), link(2, 1), link(3, 4)];
    expect(selectProfileSimilarity(5, rows)).toEqual({
      pairs: [
        { sourceArticleId: 1, targetArticleId: 2, expectedTargetBlogId: 6 },
        { sourceArticleId: 3, targetArticleId: 4, expectedTargetBlogId: 6 },
      ],
      truncated: false,
    });
    expect(rows).toHaveLength(4);
  });
  it('caps three pairs and twenty observed link rows with explicit truncation', () => {
    const rows = Array.from({ length: 25 }, (_, i) => link(i * 2 + 1, i * 2 + 2));
    expect(selectProfileSimilarity(5, rows)).toEqual({
      pairs: [
        { sourceArticleId: 1, targetArticleId: 2, expectedTargetBlogId: 6 },
        { sourceArticleId: 3, targetArticleId: 4, expectedTargetBlogId: 6 },
        { sourceArticleId: 5, targetArticleId: 6, expectedTargetBlogId: 6 },
      ],
      truncated: true,
    });
  });
  it('does not interpret missing selected targets as zero similarity', async () => {
    expect(await loadProfileTextSimilarity(pool, 5, [link(1, null)], { enabled: true })).toMatchObject({
      status: 'no-selected-pairs',
      selectedPairs: 0,
      exhaustive: false,
    });
    expect(loadTextSimilarity).not.toHaveBeenCalled();
  });
  it('passes exact scoped pairs to fresh reader, preserving insufficient/unavailable states', async () => {
    vi.mocked(loadTextSimilarity).mockResolvedValue({
      status: 'ready',
      items: [
        { status: 'insufficient-text', lexicalSimilarity: null },
        { status: 'unavailable', lexicalSimilarity: null },
      ],
      exhaustive: false,
      notCitation: true,
    } as never);
    const result = await loadProfileTextSimilarity(pool, 5, [link(), link(3, 4)], { enabled: true });
    expect(loadTextSimilarity).toHaveBeenCalledExactlyOnceWith(
      pool,
      {
        sourceBlogId: 5,
        pairs: [
          { sourceArticleId: 1, targetArticleId: 2, expectedTargetBlogId: 6 },
          { sourceArticleId: 3, targetArticleId: 4, expectedTargetBlogId: 6 },
        ],
      },
      { enabled: true },
    );
    expect(result).toMatchObject({
      status: 'ready',
      selectedPairs: 2,
      selectionOrigin: 'observed-outgoing-body-links',
      notCitation: true,
      items: [{ status: 'insufficient-text' }, { status: 'unavailable' }],
    });
  });
  it('never shares promises or response data between requests', async () => {
    const old = Promise.withResolvers<never>();
    vi.mocked(loadTextSimilarity)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ status: 'ready', items: [{ status: 'unavailable', lexicalSimilarity: null }] } as never);
    const a = loadProfileTextSimilarity(pool, 5, [link()], { enabled: true });
    const b = await loadProfileTextSimilarity(pool, 5, [link()], { enabled: true });
    expect(b).toMatchObject({ status: 'ready', items: [{ status: 'unavailable' }] });
    expect(loadTextSimilarity).toHaveBeenCalledTimes(2);
    old.resolve({ status: 'ready', items: [{ status: 'ready', lexicalSimilarity: 1 }] } as never);
    await a;
  });
  it('reports capacity or SQL failure as unavailable without raw error or fallback score', async () => {
    vi.mocked(loadTextSimilarity).mockRejectedValue(Error('SECRET_BODY_TOKEN'));
    const result = await loadProfileTextSimilarity(pool, 5, [link()], { enabled: true });
    expect(result).toMatchObject({ status: 'unavailable', selectedPairs: 1 });
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(result).not.toHaveProperty('items');
  });
});
