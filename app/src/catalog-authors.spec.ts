import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { authorCatalogFilters, loadAuthorCatalog } from './catalog-authors.js';

function fixture(
  relationships = 260,
  authors = 213,
  rows: Record<string, unknown>[] = [{ id: 777, displayName: '後段作者', blogSlug: 'later-blog', postCount: '3' }],
) {
  const responses = [[{ authors: '213', relationships: '260' }], [{ authors, relationships }], rows];
  return { query: vi.fn(async (_sql: string, _params?: unknown[]) => [responses.shift()]) };
}

describe('complete author catalog', () => {
  it('paginates all public author/blog relationships, distinguishing unique authors from row counts', async () => {
    const pool = fixture();
    const data = await loadAuthorCatalog(pool, { page: '999' });
    expect(data.totals).toEqual({ authors: 213, relationships: 260 });
    expect(data.matchedAuthors).toBe(213);
    expect(data.pagination).toEqual({ page: 6, pages: 6, pageSize: 50, total: 260 });
    expect(data.authors[0]).toEqual({ id: 777, displayName: '後段作者', blogSlug: 'later-blog', postCount: 3 });
    expect(pool.query.mock.calls[2][1]).toEqual([50, 250]);
    expect(pool.query.mock.calls[2][0]).toContain('ORDER BY a.display_name,b.name,a.id,b.id LIMIT ? OFFSET ?');
    expect(
      pool.query.mock.calls.every(
        ([sql]) => sql.includes("ba.status='active'") && sql.includes("a.status <> 'rejected'") && sql.includes("b.status='verified'"),
      ),
    ).toBe(true);
  });

  it('queries an author ID directly in SQL and keeps separate publication rows for one author', async () => {
    const rows = [
      { id: 777, displayName: '同一位作者', blogSlug: 'site-a', postCount: 3 },
      { id: 777, displayName: '同一位作者', blogSlug: 'site-b', postCount: 2 },
    ];
    const pool = fixture(2, 1, rows);
    const data = await loadAuthorCatalog(pool, { author: '777', page: '99', limit: '500' });
    expect(data.authors).toEqual(rows);
    expect(data.matchedAuthors).toBe(1);
    expect(data.pagination).toEqual({ page: 1, pages: 1, pageSize: 200, total: 2 });
    expect(pool.query.mock.calls[1][1]).toEqual([777]);
    expect(pool.query.mock.calls[2][1]).toEqual([777, 200, 0]);
    expect(pool.query.mock.calls[1][0]).toContain('AND a.id=?');
    expect(pool.query.mock.calls[2][0]).toContain('AND a.id=?');
    expect(pool.query.mock.calls[2][0]).toContain("pa.status='active' AND p.blog_id=b.id");
    expect(pool.query.mock.calls[2][0]).not.toContain('777');
  });

  it.each(['0', '-1', '1.2', '1e3', '01', ' 1', '', '2147483648', '999999999999999999', '1 OR 1=1', ['1', '2'], null])(
    'rejects malformed author ID %j before querying storage',
    async (author) => {
      const pool = fixture();
      await expect(loadAuthorCatalog(pool, { author })).rejects.toMatchObject({ code: 'INVALID_AUTHOR' });
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it('handles a missing author without substituting the full author list', async () => {
    const data = await loadAuthorCatalog(fixture(0, 0, []), { author: '12345' });
    expect(data.authors).toEqual([]);
    expect(data.pagination).toEqual({ page: 1, pages: 1, pageSize: 50, total: 0 });
    expect(data.matchedAuthors).toBe(0);
    expect(authorCatalogFilters({})).toEqual({ author: null, page: 1, limit: 50 });
  });

  it('serves direct author links and returns bounded public errors for invalid IDs or storage failure', async () => {
    const pool = fixture(1, 1);
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      // @ts-expect-error JS gateway accepts the injected store despite its null default.
      { store: { pool } },
    );
    try {
      const bad = await app.inject('/api/catalog/authors?author=0');
      expect(bad.statusCode).toBe(400);
      expect(pool.query).not.toHaveBeenCalled();
      const response = await app.inject('/api/catalog/authors?author=777');
      expect(response.statusCode).toBe(200);
      expect(response.json().authors[0].id).toBe(777);
      pool.query.mockRejectedValue(new Error('private database error'));
      const failed = await app.inject('/api/catalog/authors');
      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toEqual({ error: 'authors unavailable' });
      expect(failed.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
});
