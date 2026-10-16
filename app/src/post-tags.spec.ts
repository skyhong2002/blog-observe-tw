import { describe, expect, it, vi } from 'vitest';
import { loadPostTags, withPostTags } from './post-tags.ts';

const poolOf = (rows: Record<string, unknown>[]) => {
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => [rows]);
  return { pool: { query } as never, query };
};

describe('post tags beside list titles', () => {
  it('skips the read when no post is shown', async () => {
    const { pool, query } = poolOf([]);
    expect((await loadPostTags(pool, [undefined, 0, -1, 'x'])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('reads active public tags for the distinct shown ids in one bounded statement', async () => {
    const { pool, query } = poolOf([]);
    await loadPostTags(pool, [3, '3', 7]);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/^SET STATEMENT max_statement_time=1 FOR SELECT/);
    expect(sql).toContain("pt.status='active'");
    expect(sql).toContain("t.visibility='public'");
    expect(sql).toContain("t.status='active'");
    expect(sql).toContain('ORDER BY pt.post_id,pt.position,t.id');
    expect(params).toEqual([[3, 7]]);
  });

  it('drops placeholder categories and repeated labels before counting, and keeps at most `limit`', async () => {
    const { pool } = poolOf([
      { postId: 1, slug: '未分類', label: '未分類' },
      { postId: 1, slug: 'uncategorized', label: ' Uncategorized ' },
      { postId: 1, slug: 'css', label: 'CSS' },
      { postId: 1, slug: 'css-2', label: 'CSS' },
      { postId: 1, slug: 'html', label: 'HTML' },
      { postId: 1, slug: 'js', label: 'JavaScript' },
      { postId: 1, slug: 'a11y', label: 'Accessibility' },
      { postId: 2, slug: 'posts', label: 'Posts' },
      { postId: 2, slug: 'categories', label: 'categories' },
    ]);
    const tags = await loadPostTags(pool, [1, 2], 2);
    expect(tags.get(1)).toEqual({
      tags: [
        { slug: 'css', label: 'CSS' },
        { slug: 'html', label: 'HTML' },
      ],
      tagCount: 4,
    });
    expect(tags.has(2)).toBe(false);
  });

  it('decorates items by a chosen id and leaves untagged items unchanged', async () => {
    const { pool } = poolOf([{ postId: 5, slug: 'ai', label: 'ai' }]);
    const items = await withPostTags(pool, [{ articleId: 5 }, { articleId: 6 }], { id: (item) => item.articleId });
    expect(items).toEqual([{ articleId: 5, tags: [{ slug: 'ai', label: 'ai' }], tagCount: 1 }, { articleId: 6 }]);
  });

  it('a failed tag read reports and returns the list untagged', async () => {
    const onFailure = vi.fn();
    const pool = { query: vi.fn(async () => Promise.reject(Object.assign(Error('timeout'), { errno: 1969 }))) } as never;
    const items = [{ id: 1, title: 'a' }];
    expect(await withPostTags(pool, items, { onFailure })).toBe(items);
    expect(onFailure).toHaveBeenCalledTimes(1);
  });
});
