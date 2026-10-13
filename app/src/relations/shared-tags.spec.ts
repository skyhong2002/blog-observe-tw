import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSharedTags, SHARED_TAG_LIMITS } from './shared-tags.ts';

afterEach(() => vi.useRealTimers());
const hit = {
  source_article_id: 5,
  source_article_url: 'https://source.example/post',
  source_article_title: '來源文章',
  source_article_published_at: '2026-01-01',
  target_article_url: 'https://target.example/post',
  target_article_title: '目標文章',
  target_article_published_at: '2026-01-02',
  target_blog_slug: 'target',
  target_blog_name: '目標站',
  target_article_id: 8,
  target_blog_id: 2,
  tag_id: 3,
  label: '旅行',
  source_type: 'feed',
  last_seen_at: '2026-01-01',
  target_source_type: 'manual',
  target_last_seen_at: '2026-01-02',
  tag_source_type: 'crawler',
  tag_last_seen_at: '2026-01-03',
  private_body: 'DO_NOT_RETURN',
};
function adapter(source = [{ tag_id: 3, source_article_id: 5 }], rows = [hit]) {
  const query = vi.fn().mockResolvedValueOnce([source]).mockResolvedValueOnce([rows]);
  const connection = { query, release: vi.fn(), destroy: vi.fn() };
  return { pool: { getConnection: vi.fn(async () => connection) } as unknown as Pool, connection };
}
describe('native shared tags bounded offline read', () => {
  it('enforces SQL deadline and both-side public/window obligations, retains source provenance only', async () => {
    const { pool, connection } = adapter();
    const result = await loadSharedTags(pool, { sourceBlogId: 1, days: 30 });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('fixture');
    expect(result.items[0]).toMatchObject({
      sourceArticleId: 5,
      targetArticleId: 8,
      tagId: 3,
      sourceType: 'feed',
      targetSourceType: 'manual',
      matchVersion: 'native-post-tags-v1',
    });
    expect(result.items[0]).toMatchObject({
      sourceArticleUrl: 'https://source.example/post',
      sourceArticleTitle: '來源文章',
      targetArticleUrl: 'https://target.example/post',
      targetArticleTitle: '目標文章',
      targetBlogSlug: 'target',
    });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_RETURN');
    for (const [options] of connection.query.mock.calls) {
      expect(options.sql).toMatch(/^SET STATEMENT max_statement_time=0.25 FOR SELECT/);
      expect(options.timeout).toBe(500);
      expect(options.sql).toContain("t.visibility='public' AND t.status='active'");
    }
    const targetSQL = connection.query.mock.calls[1][0].sql;
    for (const phrase of [
      "sb.status='verified'",
      "tb.status='verified'",
      "st.status='active'",
      "tt.status='active'",
      'sp.published_at<=UTC_TIMESTAMP()',
      'tp.published_at<=UTC_TIMESTAMP()',
      'tp.blog_id<>sp.blog_id',
    ])
      expect(targetSQL).toContain(phrase);
    expect(connection.release).toHaveBeenCalledOnce();
  });
  it('caps 30 source tags and 100 result edges, reports partial scope', async () => {
    const { pool, connection } = adapter(
      Array.from({ length: 31 }, (_, i) => ({ tag_id: i + 1, source_article_id: 5 })),
      Array.from({ length: 101 }, () => hit),
    );
    const result = await loadSharedTags(pool, { sourceBlogId: 1, days: 90 });
    expect(result).toMatchObject({ status: 'ready', truncated: true, sourceTagsTruncated: true });
    if (result.status === 'ready') expect(result.items).toHaveLength(100);
    expect(connection.query.mock.calls[1][0].values).toHaveLength(63);
  });
  it('valid empty result does not issue target query; failures are unavailable, never fake empty', async () => {
    const { pool, connection } = adapter([]);
    expect(await loadSharedTags(pool, { sourceBlogId: 1, days: 7 })).toMatchObject({ status: 'ready', items: [], truncated: false });
    expect(connection.query).toHaveBeenCalledOnce();
    const bad = { getConnection: vi.fn().mockRejectedValue(Error('private credentials')) } as unknown as Pool;
    expect(await loadSharedTags(bad, { sourceBlogId: 1, days: 7 })).toEqual({ status: 'unavailable', matchVersion: 'native-post-tags-v1' });
  });
  it('holds both expired acquisition slots until underlying acquisition settles, late connection issues no SQL', async () => {
    vi.useFakeTimers();
    const resolvers: Array<(c: unknown) => void> = [];
    const getConnection = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
    const pool = { getConnection } as unknown as Pool;
    const a = loadSharedTags(pool, { sourceBlogId: 1, days: 7 }),
      b = loadSharedTags(pool, { sourceBlogId: 1, days: 7 });
    await vi.advanceTimersByTimeAsync(SHARED_TAG_LIMITS.deadlineMs);
    expect((await a).status).toBe('unavailable');
    expect((await b).status).toBe('unavailable');
    expect((await loadSharedTags(pool, { sourceBlogId: 1, days: 7 })).status).toBe('unavailable');
    expect(getConnection).toHaveBeenCalledTimes(2);
    const c = { release: vi.fn(), destroy: vi.fn(), query: vi.fn() };
    for (const resolve of resolvers) resolve(c);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.query).not.toHaveBeenCalled();
    expect(c.release).toHaveBeenCalledTimes(2);
    getConnection.mockResolvedValueOnce({ query: vi.fn().mockResolvedValue([[]]), release: vi.fn(), destroy: vi.fn() });
    expect(await loadSharedTags(pool, { sourceBlogId: 1, days: 7 })).toMatchObject({ status: 'ready', items: [] });
    expect(getConnection).toHaveBeenCalledTimes(3);
  });
  it('destroys only the owned connection when a read exceeds deadline', async () => {
    vi.useFakeTimers();
    let finish: ((value: unknown) => void) | undefined;
    const c = {
      query: vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
      release: vi.fn(),
      destroy: vi.fn(),
    };
    const pool = { getConnection: vi.fn(async () => c) } as unknown as Pool;
    const pending = loadSharedTags(pool, { sourceBlogId: 1, days: 7 });
    await vi.advanceTimersByTimeAsync(SHARED_TAG_LIMITS.deadlineMs);
    expect((await pending).status).toBe('unavailable');
    expect(c.destroy).toHaveBeenCalledOnce();
    expect(c.release).not.toHaveBeenCalled();
    finish?.([[]]);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.query).toHaveBeenCalledOnce();
  });
  it('rejects invalid scope before database admission', async () => {
    const { pool } = adapter();
    await expect(loadSharedTags(pool, { sourceBlogId: -1, days: 30 })).rejects.toThrow('invalid_shared_tags_query');
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
