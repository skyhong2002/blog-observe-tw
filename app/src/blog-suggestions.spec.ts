import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { expect, it, vi } from 'vitest';
import {
  DAILY_SUGGESTIONS,
  loadBlogQueue,
  QUEUE_SOURCES,
  queueFilters,
  READER_SUGGESTION,
  registerBlogSuggestionRoutes,
  suggestionHome,
} from './blog-suggestions.ts';

it('reads a bare domain or address as its publication home', () => {
  expect(suggestionHome('thelingwu.com')).toEqual({ home: 'https://thelingwu.com/' });
  expect(suggestionHome(' https://www.thelingwu.com/2026/10/post ')).toEqual({ home: 'https://www.thelingwu.com/' });
  expect(suggestionHome('medium.com/@someone/a-post-1234')).toEqual({ home: 'https://medium.com/@someone' });
  expect(suggestionHome('medium.com')).toEqual({ reason: 'platform-root' });
  for (const text of ['咖啡', 'hello world', 'localhost', '127.0.0.1', 'http://10.0.0.1/', '', 42])
    expect(suggestionHome(text)).toEqual({ reason: expect.any(String) });
});

/** Answers blogs, candidates and the daily count in the order the routes ask. */
function fakePool({ blogs = [], candidates = [], used = 0 }: { blogs?: object[]; candidates?: object[]; used?: number }) {
  const execute = vi.fn().mockResolvedValue([{}]);
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM blogs b')) return [blogs];
    if (sql.includes('COUNT(*) n')) return [[{ n: used }]];
    return [candidates];
  });
  return { pool: { query, execute } as unknown as Pool, query, execute };
}
async function app(pool: Pool, user: { id: number } | null = { id: 7 }) {
  const server = Fastify();
  registerBlogSuggestionRoutes(server, {
    pool,
    publicOrigin: 'https://blog.observe.tw',
    requireUser: async (_request, reply) => {
      if (!user) reply.code(401).send({ error: 'login required' });
      return user as never;
    },
    now: () => new Date('2026-10-19T04:00:00Z'),
  });
  return server;
}
const post = (server: Awaited<ReturnType<typeof app>>, url: string, origin = 'https://blog.observe.tw') =>
  server.inject({ method: 'POST', url: '/api/me/blog-suggestions', headers: { origin }, payload: { url } });

it('says a collected blog is listed, and a queued one is queued with its last check', async () => {
  const listed = await app(fakePool({ blogs: [{ slug: 'ling', name: '凌', status: 'verified' }] }).pool);
  expect((await listed.inject('/api/blog-suggestions?url=thelingwu.com')).json()).toEqual({
    state: 'listed',
    home: 'https://thelingwu.com/',
    slug: 'ling',
    name: '凌',
  });
  const queued = await app(
    fakePool({ candidates: [{ status: 'candidate', checkedAt: '2026-10-18T00:00:00Z', reason: 'rss_or_article_sitemap_required' }] }).pool,
  );
  expect((await queued.inject('/api/blog-suggestions?url=thelingwu.com')).json()).toMatchObject({
    state: 'queued',
    reason: 'rss_or_article_sitemap_required',
  });
  const hidden = await app(fakePool({ blogs: [{ slug: 'old', name: 'Old', status: 'moved' }] }).pool);
  expect((await hidden.inject('/api/blog-suggestions?url=thelingwu.com')).json()).toEqual({
    state: 'unlisted',
    home: 'https://thelingwu.com/',
  });
  const words = await app(fakePool({}).pool);
  expect((await words.inject('/api/blog-suggestions?url=咖啡')).json()).toMatchObject({ state: 'invalid' });
});

it('adds a new home as an unnamed reader suggestion for the automatic review', async () => {
  const { pool, execute } = fakePool({});
  const server = await app(pool);
  expect((await server.inject('/api/blog-suggestions?url=thelingwu.com')).json()).toEqual({ state: 'new', home: 'https://thelingwu.com/' });
  const added = await post(server, 'thelingwu.com');
  expect(added.json()).toMatchObject({ state: 'queued', home: 'https://thelingwu.com/' });
  expect(added.headers['cache-control']).toBe('private, no-store');
  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0][1]).toEqual([
    'https://thelingwu.com/',
    null,
    READER_SUGGESTION,
    '/api/me/blog-suggestions',
    JSON.stringify({ userId: 7 }),
    new Date('2026-10-19T04:00:00Z'),
  ]);
});

it('adds nothing for a known blog, another origin, a signed-out reader or a spent daily quota', async () => {
  const known = fakePool({ blogs: [{ slug: 'ling', name: '凌', status: 'verified' }] });
  expect((await post(await app(known.pool), 'thelingwu.com')).json()).toMatchObject({ state: 'listed' });
  const fresh = fakePool({});
  expect((await post(await app(fresh.pool), 'thelingwu.com', 'https://evil.example')).statusCode).toBe(403);
  expect((await post(await app(fresh.pool, null), 'thelingwu.com')).statusCode).toBe(401);
  const spent = fakePool({ used: DAILY_SUGGESTIONS });
  expect((await post(await app(spent.pool), 'thelingwu.com')).statusCode).toBe(429);
  for (const pool of [known, fresh, spent]) expect(pool.execute).not.toHaveBeenCalled();
});

it('reads queue filters strictly: known states and sources only, an address without its scheme', () => {
  expect(queueFilters({ q: ' HTTPS://www.TheLingWu.com/ ', state: 'failed', source: 'reader-suggestion', page: '3' })).toEqual({
    q: 'thelingwu.com',
    state: 'failed',
    source: 'reader-suggestion',
    page: 3,
    sort: 'added',
    dir: 'desc',
  });
  expect(queueFilters({ state: 'x', source: 'owner-exclusion', page: '-1', sort: 'id;--', dir: 'up' })).toEqual({
    q: '',
    state: '',
    source: '',
    page: 1,
    sort: 'added',
    dir: 'desc',
  });
  expect(queueFilters({ sort: 'site' })).toMatchObject({ sort: 'site', dir: 'asc' });
  expect(queueFilters({ sort: 'checked', dir: 'asc' })).toMatchObject({ sort: 'checked', dir: 'asc' });
  expect(queueFilters({ source: 'opml-import' }).source).toBe('');
});

it('lists the queue without owner-excluded hosts or private OPML imports, counting each chip row by the other', async () => {
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => {
    if (sql.includes("source_type='owner-exclusion'")) return [[{ host: 'excluded.test' }]];
    if (sql.includes('GROUP BY state,source'))
      return [
        [
          { state: 'failed', source: 'reader-suggestion', n: 1 },
          { state: 'listed', source: 'blogblog-club', n: 4 },
          { state: 'waiting', source: 'blogblog-club', n: 2 },
        ],
      ];
    return [
      [
        {
          url: 'https://thelingwu.com/',
          name: null,
          source: 'reader-suggestion',
          state: 'failed',
          addedAt: new Date('2026-10-18T21:06:46Z'),
          checkedAt: new Date('2026-10-18T21:08:42Z'),
          reason: 'personal_identity_uncertain',
          slug: null,
        },
      ],
    ];
  });
  const queue = await loadBlogQueue({ query } as unknown as Pool, { source: 'blogblog-club' });
  expect(queue.states).toEqual({ waiting: 2, failed: 0, listed: 4, rejected: 0 });
  expect(queue.sources).toMatchObject({ 'reader-suggestion': 1, 'blogblog-club': 6, 'indieweb-wiki': 0 });
  expect(queue.pagination).toEqual({ page: 1, pages: 1, total: 6 });
  expect(queue.items[0]).toEqual({
    url: 'https://thelingwu.com/',
    name: null,
    source: 'reader-suggestion',
    state: 'failed',
    addedAt: '2026-10-18T21:06:46.000Z',
    checkedAt: '2026-10-18T21:08:42.000Z',
    reason: 'personal_identity_uncertain',
    slug: null,
  });
  const [sql, parameters] = query.mock.calls.at(-1)!;
  expect(parameters).toEqual([QUEUE_SOURCES, ['excluded.test'], 'blogblog-club', 50, 0]);
  expect(sql).toMatch(/ORDER BY d\.discovered_at DESC,d\.id DESC LIMIT/);
  await loadBlogQueue({ query } as unknown as Pool, { sort: 'checked', dir: 'asc' });
  expect(query.mock.calls.at(-1)![0]).toMatch(/ORDER BY STR_TO_DATE\([\s\S]+\) IS NULL,STR_TO_DATE\([\s\S]+\) ASC,d\.id ASC LIMIT/);
  expect(QUEUE_SOURCES).not.toContain('owner-exclusion');
  expect(QUEUE_SOURCES).not.toContain('opml-import');
});
