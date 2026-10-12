import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { catalogFilters, loadCatalog } from './catalog.js';

function fixture(total = 275, rows: Record<string, unknown>[] = [{ id: 251, slug: 'after-200', name: '第 251 個站', postCount: '4' }]) {
  const responses = [
    [{ blogs: '275', posts: '12000', withUrls: '264', authors: '230', updatedAt: '2026-10-12T00:00:00.000Z' }],
    [
      { value: '生活', count: '210' },
      { value: '旅行', count: '65' },
    ],
    [
      { value: '已核對', count: '264' },
      { value: '待核對', count: '11' },
    ],
    [{ total }],
    rows,
  ];
  const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => [responses.shift()]);
  return { query };
}

describe('complete blog catalog', () => {
  it('paginates beyond the overview cap and clamps the page using the full filtered count', async () => {
    const pool = fixture();
    const data = await loadCatalog(pool, { page: '999' });
    expect(data.pagination).toEqual({ page: 6, pages: 6, pageSize: 50, total: 275 });
    expect(data.blogs).toEqual([{ id: 251, slug: 'after-200', name: '第 251 個站', postCount: 4, iconUrl: null }]);
    expect(data.totals).toEqual({ blogs: 275, posts: 12000, withUrls: 264, authors: 230 });
    expect(data.categories).toEqual([
      { value: '生活', count: 210 },
      { value: '旅行', count: 65 },
    ]);
    expect(data.statuses).toEqual([
      { value: '已核對', count: 264 },
      { value: '待核對', count: 11 },
    ]);
    expect(pool.query.mock.calls[4][1]).toEqual([50, 250]);
    expect(pool.query.mock.calls[4][0]).toContain('ORDER BY b.name ASC,b.id ASC LIMIT ? OFFSET ?');
    expect(pool.query.mock.calls[0][0]).toContain('COUNT(DISTINCT a.id)');
    expect(pool.query.mock.calls.slice(0, 3).every(([sql]) => !sql.includes('LIMIT'))).toBe(true);
    expect(pool.query.mock.calls.every(([sql]) => sql.includes("b.status <> 'moved'"))).toBe(true);
  });

  it('uses identical parameterized filters for count and rows, with literal wildcard search and global facets', async () => {
    const pool = fixture(3);
    const data = await loadCatalog(pool, { q: " A%_'= ", category: '旅行', status: '已核對', sort: 'posts', dir: 'desc', page: '2' });
    const expected = ["%a=%=_'==%", "%a=%=_'==%", '旅行', '已核對'];
    expect(pool.query.mock.calls[3][1]).toEqual(expected);
    expect(pool.query.mock.calls[4][1]).toEqual([...expected, 50, 0]);
    expect(pool.query.mock.calls[4][0]).toContain('ORDER BY postCount DESC,b.id ASC');
    expect(pool.query.mock.calls[3][0]).toContain("LOWER(b.url) LIKE ? ESCAPE '='");
    expect(pool.query.mock.calls[3][0]).not.toContain('旅行');
    expect(pool.query.mock.calls.slice(0, 3).every(([, params]) => params === undefined)).toBe(true);
    expect(data.pagination).toEqual({ page: 1, pages: 1, pageSize: 50, total: 3 });
  });

  it('keeps empty search results on page one while retaining complete catalog totals', async () => {
    const pool = fixture(0, []);
    const data = await loadCatalog(pool, { q: 'missing', page: '10' });
    expect(data.blogs).toEqual([]);
    expect(data.pagination).toEqual({ page: 1, pages: 1, pageSize: 50, total: 0 });
    expect(data.totals.blogs).toBe(275);
    expect(pool.query.mock.calls[4][1]).toEqual(['%missing%', '%missing%', 50, 0]);
  });

  it('bounds inputs and limits and never interpolates unknown sort expressions or directions', async () => {
    expect(
      catalogFilters({
        q: ['one', 'two'],
        category: {},
        status: null,
        page: '-10',
        limit: '300',
        sort: '__proto__',
        dir: 'DESC; DROP TABLE blogs',
      }),
    ).toEqual({ q: '', category: '', status: '', page: 1, limit: 200, sort: 'name', dir: 'asc' });
    expect(catalogFilters({ sort: 'latest', page: '0', limit: '0', q: '字'.repeat(120) })).toMatchObject({
      sort: 'latest',
      dir: 'desc',
      page: 1,
      limit: 1,
      q: '字'.repeat(100),
    });
    const pool = fixture();
    await loadCatalog(pool, { sort: 'name;DROP TABLE blogs', dir: 'DESC; SELECT', limit: '99999999999999999999' });
    expect(pool.query.mock.calls[4][1]).toEqual([200, 0]);
    expect(pool.query.mock.calls.every(([sql]) => !sql.includes('DROP TABLE') && !sql.includes('DESC;'))).toBe(true);
  });

  it('exposes the dedicated gateway route and hides storage errors', async () => {
    const pool = fixture();
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      // @ts-expect-error JS gateway accepts the injected store despite its null default.
      { store: { pool } },
    );
    try {
      const response = await app.inject('/api/catalog?page=6');
      expect(response.statusCode).toBe(200);
      expect(response.json().pagination).toEqual({ page: 6, pages: 6, pageSize: 50, total: 275 });
      pool.query.mockRejectedValue(new Error('private database connection details'));
      const failed = await app.inject('/api/catalog?q=missing');
      expect(failed.statusCode).toBe(503);
      expect(failed.json()).toEqual({ error: 'catalog unavailable' });
      expect(failed.body).not.toContain('private database');
    } finally {
      await app.close();
    }
  });
});
