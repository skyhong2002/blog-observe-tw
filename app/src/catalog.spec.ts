import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { catalogFilters, loadCatalog } from './catalog.js';

function fixture(
  total = 275,
  rows: Record<string, unknown>[] = [{ id: 251, slug: 'after-200', name: '第 251 個站', postCount: '4', authorCount: '2' }],
  genreRows: Record<string, unknown>[] = [],
  kindRows: Record<string, unknown>[] = [],
) {
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
  // The shown-genre read (blog-genres/store.ts) answers on its own; the positional responses are the catalog's.
  // The shown-genre read and the 經營者 facet answer on their own; the positional responses are the catalog's.
  const own = (sql: string) => sql.includes('blog_genre_assignments') || sql.startsWith('SELECT kind AS value');
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) =>
    sql.includes('blog_genre_assignments') ? [genreRows] : sql.startsWith('SELECT kind AS value') ? [kindRows] : [responses.shift()],
  );
  const calls = () => query.mock.calls.filter(([sql]) => !own(sql));
  return { query, calls };
}

describe('complete blog catalog', () => {
  it('paginates beyond the overview cap and clamps the page using the full filtered count', async () => {
    const pool = fixture();
    const data = await loadCatalog(pool, { page: '999' });
    expect(data.pagination).toEqual({ page: 6, pages: 6, pageSize: 50, total: 275 });
    expect(data.blogs).toEqual([
      { id: 251, slug: 'after-200', name: '第 251 個站', postCount: 4, authorCount: 2, iconUrl: null, robots: null, genres: [] },
    ]);
    expect(data.totals).toEqual({ blogs: 275, posts: 12000, withUrls: 264, authors: 230 });
    expect(data.categories).toEqual([
      { value: '生活', count: 210 },
      { value: '旅行', count: 65 },
    ]);
    expect(data.statuses).toEqual([
      { value: '已核對', count: 264 },
      { value: '待核對', count: 11 },
    ]);
    expect(pool.calls()[4][1]).toEqual([50, 250]);
    // The directory opens on the newest already-published post; future-dated feed entries are not the latest.
    expect(pool.calls()[4][0]).toContain('ORDER BY lastPublishedAt DESC,b.id ASC LIMIT ? OFFSET ?');
    expect(pool.calls()[4][0]).toContain('p.published_at<=UTC_TIMESTAMP()) AS lastPublishedAt');
    expect(pool.calls()[4][0]).toContain("ba.status='active'");
    expect(pool.calls()[0][0]).toContain('COUNT(DISTINCT a.id)');
    expect(
      pool
        .calls()
        .slice(0, 3)
        .every(([sql]) => !sql.includes('LIMIT')),
    ).toBe(true);
    expect(pool.calls().every(([sql]) => sql.includes("b.status='verified'"))).toBe(true);
  });

  it('uses identical parameterized filters for count and rows, with literal wildcard search and global facets', async () => {
    const pool = fixture(3);
    const data = await loadCatalog(pool, { q: " A%_'= ", category: '旅行', status: '已核對', sort: 'posts', dir: 'desc', page: '2' });
    const expected = ["%a=%=_'==%", '旅行', '已核對'];
    expect(pool.calls()[3][1]).toEqual(expected);
    expect(pool.calls()[4][1]).toEqual([...expected, 50, 0]);
    expect(pool.calls()[4][0]).toContain('ORDER BY postCount DESC,b.id ASC');
    expect(pool.calls()[3][0]).toMatch(/CONCAT_WS\(.*\) LIKE \? ESCAPE '='/s);
    expect(pool.calls()[3][0]).not.toContain('旅行');
    expect(
      pool
        .calls()
        .slice(0, 3)
        .every(([, params]) => params === undefined),
    ).toBe(true);
    expect(data.pagination).toEqual({ page: 1, pages: 1, pageSize: 50, total: 3 });
  });

  it("shows each blog's latest robots.txt read, also when it landed on the www host", async () => {
    const pool = fixture(1, [{ id: 7, slug: 'gs', name: 'GS', url: 'https://blog.example.tw/', postCount: '1', authorCount: '1' }]);
    const robotsRow = {
      host: 'www.blog.example.tw',
      outcome: 'unreachable',
      http_status: null,
      error: 'timeout',
      disallow: '[]',
      checked_at: new Date('2026-10-17T12:00:00Z'),
      readable_at: null,
    };
    const query = vi.fn(async (sql: string, parameters?: unknown[]) =>
      sql.includes('robots_observations') ? [[robotsRow]] : pool.query(sql, parameters),
    );
    const data = await loadCatalog({ query } as never, {});
    expect(data.blogs[0].robots).toEqual({
      outcome: 'unreachable',
      httpStatus: null,
      error: 'timeout',
      disallow: [],
      checkedAt: '2026-10-17T12:00:00.000Z',
      readableAt: null,
    });
    expect(query.mock.calls.at(-1)?.[1]).toEqual([['blog.example.tw', 'www.blog.example.tw']]);
    // A directory without the table (before its migration) still answers.
    const plain = fixture(1, [{ id: 7, slug: 'gs', name: 'GS', url: 'https://blog.example.tw/' }]);
    const broken = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('robots_observations')) throw Error('no such table');
      return plain.query(sql, parameters);
    });
    expect((await loadCatalog({ query: broken } as never, {})).blogs[0].robots).toBeNull();
  });

  it('keeps empty search results on page one while retaining complete catalog totals', async () => {
    const pool = fixture(0, []);
    const data = await loadCatalog(pool, { q: 'missing', page: '10' });
    expect(data.blogs).toEqual([]);
    expect(data.pagination).toEqual({ page: 1, pages: 1, pageSize: 50, total: 0 });
    expect(data.totals.blogs).toBe(275);
    expect(pool.calls()[4][1]).toEqual(['%missing%', 'missing', 'missing%', 'missing%', '%missing%', '%missing%', '%missing%', 50, 0]);
  });

  it('searches like tag.observe.tw: folded words, every word somewhere in the blog, best matches first', async () => {
    const pool = fixture(0, []);
    const data = await loadCatalog(pool, { q: '  ＩＫＵ   Room  100%_ ikU ' });
    expect(data.filters).toMatchObject({ sort: 'relevance' });
    const [countSql, countParams] = pool.calls()[3];
    // NFKC + lower case, duplicates dropped, LIKE metacharacters literal; each word is its own condition.
    expect(countParams).toEqual(['%iku%', '%room%', '%100=%=_%']);
    expect(countSql.match(/CONCAT_WS\(' ',b\.name,b\.url,b\.slug,b\.description/g)).toHaveLength(3);
    expect(countSql).toContain('FROM blog_urls u WHERE u.blog_id=b.id');
    const [listSql, listParams] = pool.calls()[4];
    expect(listSql).toMatch(/ORDER BY CASE WHEN b\.name=\? THEN 0 .* END ASC,postCount DESC,b\.id ASC/s);
    expect(listParams?.slice(3, 5)).toEqual(['iku room 100%_ iku', 'iku room 100=%=_ iku%']);
    // A column the reader chose still wins over relevance; relevance alone without a search is the default sort.
    expect(catalogFilters({ q: 'iku', sort: 'posts' })).toMatchObject({ sort: 'posts' });
    expect(catalogFilters({ sort: 'relevance' })).toMatchObject({ sort: 'latest' });
    expect(catalogFilters({ q: 'iku', sort: 'relevance' })).toMatchObject({ sort: 'relevance' });
  });

  it('answers the short list-source status codes and still the full labels', () => {
    for (const [code, label] of [
      ['indieping', 'IndiePing 名單自動收錄'],
      ['blogblog', 'BlogBlog.Club 名單自動收錄'],
      ['indieweb', 'IndieWeb 名單自動收錄'],
    ]) {
      expect(catalogFilters({ status: code }).status).toBe(label);
      expect(catalogFilters({ status: label }).status).toBe(label);
    }
    expect(catalogFilters({ status: '已核對' }).status).toBe('已核對');
    expect(catalogFilters({ status: '__proto__' }).status).toBe('__proto__');
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
    ).toEqual({ q: '', category: '', genre: '', status: '', kind: '', page: 1, limit: 200, sort: 'latest', dir: 'desc' });
    expect(catalogFilters({ sort: 'authors' })).toMatchObject({ sort: 'authors', dir: 'desc' });
    expect(catalogFilters({ sort: 'latest', page: '0', limit: '0', q: '字'.repeat(120) })).toMatchObject({
      sort: 'latest',
      dir: 'desc',
      page: 1,
      limit: 1,
      q: '字'.repeat(100),
    });
    const pool = fixture();
    await loadCatalog(pool, { sort: 'name;DROP TABLE blogs', dir: 'DESC; SELECT', limit: '99999999999999999999' });
    expect(pool.calls()[4][1]).toEqual([200, 0]);
    expect(pool.calls().every(([sql]) => !sql.includes('DROP TABLE') && !sql.includes('DESC;'))).toBe(true);
  });

  it('filters and counts by shown genres, several per blog, with - for blogs no genre is shown for yet', async () => {
    const genreRows = [
      { blogId: 251, genre: 'travel', ai: 1, adminSet: 0, adminHide: 0, agrees: 0, disagrees: 0 },
      { blogId: 251, genre: '咖啡', ai: 0, adminSet: 0, adminHide: 0, agrees: 1, disagrees: 0 },
      { blogId: 252, genre: 'travel', ai: 1, adminSet: 0, adminHide: 0, agrees: 0, disagrees: 0 },
      // A reader genre someone disagreed with is not shown, so it is neither counted nor filtered on.
      { blogId: 252, genre: '露營', ai: 0, adminSet: 0, adminHide: 0, agrees: 1, disagrees: 1 },
    ];
    let pool = fixture(1, undefined, genreRows);
    const data = await loadCatalog(pool, { genre: '旅遊' });
    expect(data.filters.genre).toBe('travel');
    expect(pool.calls()[3][0]).toContain('b.id IN (?)');
    expect(pool.calls()[3][1]).toEqual([[251, 252]]);
    expect(data.genres).toEqual([
      { value: 'travel', label: '旅遊', count: 2 },
      { value: '咖啡', label: '咖啡', count: 1 },
    ]);
    expect(data.ungenred).toBe(273);
    expect(data.blogs[0].genres).toEqual([
      { value: '咖啡', label: '咖啡' },
      { value: 'travel', label: '旅遊' },
    ]);
    pool = fixture(1, undefined, genreRows);
    await loadCatalog(pool, { genre: '-' });
    expect(pool.calls()[3][0]).toContain('b.id NOT IN (?)');
    pool = fixture(0, [], genreRows);
    await loadCatalog(pool, { genre: '露營' });
    expect(pool.calls()[3][0]).toContain('0=1');
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

  it('filters by site kind with the same expression it counts, in a fixed chip order', async () => {
    const pool = fixture(
      1,
      undefined,
      [],
      [
        { value: 'personal', count: '300' },
        { value: 'unknown', count: '150' },
      ],
    );
    const data = await loadCatalog(pool, { kind: 'personal' });
    expect(data.filters.kind).toBe('personal');
    expect(pool.calls()[3][1]).toEqual(['personal']);
    expect(pool.calls()[3][0]).toContain('blog_site_observations');
    expect(data.kinds).toEqual([
      { value: 'personal', count: 300 },
      { value: 'group', count: 0 },
      { value: 'organization', count: 0 },
      { value: 'unknown', count: 150 },
    ]);
    expect(catalogFilters({ kind: 'shop' }).kind).toBe('');
  });

  it('exports the filtered directory as OPML, unpaged and escaped', async () => {
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.includes('blog_genre_assignments')) return [[]];
      expect(sql).toContain('feed_sources');
      expect(parameters).toEqual(['已核對', 1000]);
      return [[{ name: 'A & <B>', url: 'https://a.example/', feedUrl: 'https://a.example/feed?x=1&y=2', type: 'rss' }]];
    });
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      // @ts-expect-error JS gateway accepts the injected store despite its null default.
      { store: { pool: { query } } },
    );
    try {
      const response = await app.inject('/api/catalog.opml?status=%E5%B7%B2%E6%A0%B8%E5%B0%8D&page=3');
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/x-opml');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toContain('<title>部落格觀察 部落格目錄：已核對</title>');
      expect(response.body).toContain('text="A &amp; &lt;B&gt;"');
      expect(response.body).toContain('xmlUrl="https://a.example/feed?x=1&amp;y=2"');
    } finally {
      await app.close();
    }
  });
});
