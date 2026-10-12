import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSearch, registerSearchRoutes } from './search.ts';
import { CURRENT_BODY_SQL, HISTORICAL_BODY_LIMIT, literalSearchPattern, PUBLIC_SEARCH_SQL, SEARCH_MATCH_VERSION } from './search-bounds.ts';

const phrase = '蛤蜊絲瓜';
const filters = (q = phrase) => ({ q, page: 1, limit: 20, blog: '' });
type Article = {
  id: number;
  status: string;
  deleted: boolean;
  publishedAt: Date | null;
  bodyStatus: string;
  blogId: number;
  bodyBlogId: number;
  body: string;
  title: string;
  summary: string;
};
function fixture(q = phrase, number = 1) {
  const articles: Article[] = Array.from({ length: number }, (_, i) => ({
    id: 20875 - i,
    status: 'verified',
    deleted: false,
    publishedAt: new Date('2026-01-01'),
    bodyStatus: 'ok',
    blogId: 38,
    bodyBlogId: 38,
    body: '前文'.repeat(100) + `這道${q}很鮮甜，餐桌上的湯汁清爽。` + '後文'.repeat(600) + 'PRIVATE_BODY_TAIL',
    title: '吳師大眾飯店',
    summary: '六條通裡的熱炒店',
  }));
  const visible = (a: Article) => !a.deleted && a.status === 'verified' && (!a.publishedAt || a.publishedAt <= new Date());
  const bodyMatches = (a: Article) => a.bodyStatus === 'ok' && a.bodyBlogId === a.blogId && a.body.includes(q);
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    expect(sql).toContain(PUBLIC_SEARCH_SQL);
    expect((sql.match(/\?/g) || []).length).toBe(params.length);
    if (sql.includes('SELECT p.id FROM posts')) return [Array.from({ length: 1001 }, (_, i) => ({ id: 40000 + i }))];
    expect(sql).toContain(CURRENT_BODY_SQL);
    if (sql.includes('SELECT p.id FROM content_post_bodies')) {
      expect(params.at(-1)).toBe(literalSearchPattern(q));
      expect(sql).toContain(`LIMIT ${HISTORICAL_BODY_LIMIT + 1}`);
      return [
        articles
          .filter((a) => visible(a) && bodyMatches(a))
          .slice(0, HISTORICAL_BODY_LIMIT + 1)
          .map((a) => ({ id: a.id })),
      ];
    }
    const candidates = params.find(Array.isArray) as number[];
    expect(candidates.length).toBeLessThanOrEqual(1200);
    return [
      articles
        .filter((a) => visible(a) && candidates.includes(a.id) && bodyMatches(a))
        .slice(0, Number(params.at(-2)))
        .map((a) => ({
          id: a.id,
          title: a.title,
          summary: a.summary,
          blogSlug: 'anise-tw-534',
          blogName: '愛吃鬼芸芸',
          url: `https://anise.tw/${a.id}`,
          searchExcerpt: a.body.slice(Math.max(0, a.body.indexOf(q) - 80), Math.max(0, a.body.indexOf(q) - 80) + 700),
          matchSource: 'body',
          contextSource: 'body',
          body_text: a.body,
          body_html: '<private>',
          content_hash: 'private-hash',
        })),
    ];
  });
  return { articles, query, pool: { query } as unknown as Pool };
}
afterEach(() => vi.unstubAllEnvs());
// These adapters assert SQL structure/bindings and DTO projection. They do not
// execute MariaDB CASE, LIKE/collation, or SET STATEMENT semantics.
describe('bounded historical body search (offline storage adapter)', () => {
  it('finds 20875 outside the latest 1000 IDs from current body, not title/summary', async () => {
    const f = fixture();
    expect(f.articles[0].title + f.articles[0].summary).not.toContain(phrase);
    const data = await loadSearch(f.pool, filters(), { historicalBody: true });
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({
      id: 20875,
      articleId: 20875,
      matchSource: 'body',
      contextSource: 'body',
      matchVersion: SEARCH_MATCH_VERSION,
    });
    expect(data.items[0].snippet).toContain('這道蛤蜊絲瓜很鮮甜');
    expect(Array.from(data.items[0].snippet)).toHaveLength(240);
    for (const field of ['body_text', 'body_html', 'content_hash', 'PRIVATE_BODY_TAIL', '<private>'])
      expect(JSON.stringify(data)).not.toContain(field);
    expect(f.query).toHaveBeenCalledTimes(3);
    expect(f.query.mock.calls.every(([sql]) => sql.startsWith('SET STATEMENT max_statement_time=0.25 FOR SELECT'))).toBe(true);
    expect(f.query.mock.calls[1][0]).not.toContain('p.id IN');
    expect(f.query.mock.calls[2][0]).toContain('SUBSTRING(');
    expect(data.coverage).toMatchObject({
      type: 'recent-metadata-and-bounded-historical-body',
      historicalBody: { candidates: 1, truncated: false, statementTimeoutMs: 250 },
    });
  });

  it('is opt-in: the default recent scope still excludes the older article', async () => {
    vi.stubEnv('BLOG_SEARCH_HISTORICAL_BODY_ENABLED', 'false');
    const f = fixture();
    const data = await loadSearch(f.pool, filters());
    expect(data.items).toEqual([]);
    expect(data.coverage.type).toBe('recent-indexed-posts');
    expect(f.query).toHaveBeenCalledTimes(2);
  });

  it('keeps the requested blog predicate on both candidate and final fresh reads', async () => {
    const f = fixture();
    const data = await loadSearch(f.pool, { ...filters(), blog: 'anise-tw-534' }, { historicalBody: true });
    expect(data.items).toHaveLength(1);
    for (const [sql, params] of f.query.mock.calls) {
      expect(sql).toContain('AND b.slug=?');
      expect(params).toContain('anise-tw-534');
    }
  });

  it('still queries historical bodies when the recent metadata scope is empty', async () => {
    const f = fixture();
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, params) => (sql.includes('SELECT p.id FROM posts') ? [[]] : original(sql, params)));
    const data = await loadSearch(f.pool, filters(), { historicalBody: true });
    expect(data.items[0].articleId).toBe(20875);
    expect(data.coverage.scannedPosts).toBe(0);
  });

  it.each(['hidden', 'rejected', 'moved', 'deleted', 'future', 'body-revoked', 'body-revised', 'body-owner-changed'])(
    'rechecks %s on the next read, without retaining the prior DTO',
    async (state) => {
      vi.stubEnv('BLOG_SEARCH_HISTORICAL_BODY_ENABLED', 'true');
      const f = fixture();
      const app = Fastify();
      registerSearchRoutes(app, f.pool);
      try {
        const url = '/api/search?q=' + encodeURIComponent(phrase);
        expect((await app.inject(url)).json().items).toHaveLength(1);
        const a = f.articles[0];
        if (['hidden', 'rejected', 'moved'].includes(state)) a.status = state;
        if (state === 'deleted') a.deleted = true;
        if (state === 'future') a.publishedAt = new Date(Date.now() + 86400000);
        if (state === 'body-revoked') a.bodyStatus = 'missing';
        if (state === 'body-revised') a.body = '原文已更新成其他菜色。';
        if (state === 'body-owner-changed') a.bodyBlogId = 999;
        const after = await app.inject(url);
        expect(after.statusCode).toBe(200);
        expect(after.json().items).toEqual([]);
        expect(after.headers['cache-control']).toBe('no-store');
        expect(f.query).toHaveBeenCalledTimes(6);
      } finally {
        await app.close();
      }
    },
  );

  it('reconfirms visibility after candidate selection as well as before it', async () => {
    const f = fixture();
    const original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, params) => {
      const result = await original(sql, params);
      if (sql.includes('SELECT p.id FROM content_post_bodies')) f.articles[0].status = 'rejected';
      return result;
    });
    expect((await loadSearch(f.pool, filters(), { historicalBody: true })).items).toEqual([]);
  });

  it.each(['10%_=', '蛤蜊', '絲瓜', "x' OR 1=1 --"])('matches literal %s with bound parameters', async (q) => {
    const f = fixture(q);
    const data = await loadSearch(f.pool, filters(q), { historicalBody: true });
    expect(data.items).toHaveLength(1);
    for (const [sql] of f.query.mock.calls) expect(sql).not.toContain(q);
    expect(data.items[0].snippet).toContain(q);
  });

  it('bounds candidates, marks truncation, and does not confuse candidate count with page size', async () => {
    const f = fixture(phrase, 201);
    const data = await loadSearch(f.pool, filters(), { historicalBody: true });
    expect(data.items).toHaveLength(20);
    expect(data.pagination.hasMore).toBe(true);
    expect(data.coverage.historicalBody).toMatchObject({ candidates: 200, truncated: true, maximumStatements: 3 });
    expect(data.coverage.truncated).toBe(true);
  });

  it('returns a bounded timeout error instead of an empty successful search', async () => {
    vi.stubEnv('BLOG_SEARCH_HISTORICAL_BODY_ENABLED', 'true');
    const f = fixture();
    f.query.mockRejectedValue(Object.assign(Error('private SQL detail'), { errno: 1969 }));
    const app = Fastify();
    registerSearchRoutes(app, f.pool);
    try {
      const response = await app.inject('/api/search?q=' + encodeURIComponent(phrase));
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'search_timeout' });
      expect(response.body).not.toContain('private SQL detail');
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });

  it.each(['title', 'summary', 'blog-name', 'tag'])(
    'projects bounded %s metadata context with correctly ordered SQL bindings',
    async (source) => {
      const q = '蛤蜊%_=絲瓜';
      const pattern = literalSearchPattern(q);
      const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
        expect((sql.match(/\?/g) || []).length).toBe(parameters.length);
        if (sql.includes('SELECT p.id FROM posts')) return [[{ id: 7 }]];
        if (sql.includes('SELECT p.id FROM content_post_bodies')) return [[]];
        const compact = sql.replace(/\s+/g, ' ');
        expect(compact).toContain("WHEN p.title LIKE ? ESCAPE '=' THEN SUBSTRING(p.title,GREATEST(1,LOCATE(?,p.title)-80),700)");
        expect(compact).toContain("WHEN p.summary LIKE ? ESCAPE '=' THEN SUBSTRING(p.summary,GREATEST(1,LOCATE(?,p.summary)-80),700)");
        expect(compact).toContain("WHEN b.name LIKE ? ESCAPE '=' THEN LEFT(b.name,700)");
        expect(compact).toContain('ELSE LEFT((SELECT t.label FROM post_tags pt JOIN tags t');
        expect(compact).toContain("pt.status='active' AND t.status='active' AND t.visibility='public'");
        for (const [field, name] of [
          ['p.title', 'title'],
          ['p.summary', 'summary'],
          ['b.name', 'blog-name'],
        ])
          expect(compact).toContain(`WHEN ${field} LIKE ? ESCAPE '=' THEN '${name}'`);
        expect(compact).toContain("ELSE 'tag' END contextSource");
        // Excerpt CASE (8), matchSource (1), contextSource (4), candidate/blog,
        // WHERE matches (5), and pagination (2), in actual textual SQL order.
        expect(parameters).toEqual([
          pattern,
          q,
          pattern,
          q,
          pattern,
          q,
          pattern,
          pattern,
          pattern,
          pattern,
          pattern,
          pattern,
          pattern,
          [7],
          'anise-tw-534',
          pattern,
          pattern,
          pattern,
          pattern,
          pattern,
          21,
          0,
        ]);
        return [
          [
            {
              id: 7,
              title: '一般標題',
              summary: '一般摘要',
              blogName: '一般站名',
              matchSource: 'metadata',
              contextSource: source,
              searchExcerpt: `<p>${source} 上下文 ${q} 正確片段。${'其餘文字'.repeat(300)}</p><script>PRIVATE_SCRIPT</script>`,
              body_text: 'PRIVATE_BODY_TAIL',
              source_evidence: { private: true },
            },
          ],
        ];
      });
      const data = await loadSearch({ query } as unknown as Pool, { ...filters(q), blog: 'anise-tw-534' }, { historicalBody: true });
      expect(data.items[0]).toMatchObject({
        articleId: 7,
        matchSource: 'metadata',
        contextSource: source,
        matchVersion: SEARCH_MATCH_VERSION,
      });
      expect(data.items[0].snippet).toContain(`${source} 上下文 ${q} 正確片段。`);
      expect(Array.from(data.items[0].snippet)).toHaveLength(240);
      for (const privateValue of ['PRIVATE_BODY_TAIL', 'PRIVATE_SCRIPT', 'source_evidence', '<p>'])
        expect(JSON.stringify(data)).not.toContain(privateValue);
      expect(query).toHaveBeenCalledTimes(3);
    },
  );
});
