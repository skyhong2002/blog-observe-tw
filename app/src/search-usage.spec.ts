import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, expect, it, vi } from 'vitest';
import { registerSearchRoutes } from './search.ts';
import { createSearchUsage, fromSitePage, SEARCH_USAGE_COLUMNS, searchUsageDay, tallySearch } from './search-usage.ts';

afterEach(() => vi.unstubAllEnvs());

it('counts by Taiwan calendar day', () => {
  expect(searchUsageDay(new Date('2026-10-18T15:59:59Z'))).toBe('2026-10-18');
  expect(searchUsageDay(new Date('2026-10-18T16:00:00Z'))).toBe('2026-10-19');
});

it('tells site searches from API requests by Sec-Fetch-Site only', () => {
  expect(fromSitePage({ 'sec-fetch-site': 'same-origin' })).toBe(true);
  expect(fromSitePage({ 'sec-fetch-site': 'cross-site' })).toBe(false);
  expect(fromSitePage({})).toBe(false);
});

it('tallies first pages by where the matches came from', () => {
  const site = (total: number, body: number, page = 1) => tallySearch({ site: true, page, matched: { total, body } });
  expect(site(0, 0)).toEqual({ site_searches: 1 });
  expect(site(3, 0)).toEqual({ site_searches: 1, with_results: 1 });
  expect(site(3, 1)).toEqual({ site_searches: 1, with_results: 1, body_matches: 1 });
  expect(site(2, 2)).toEqual({ site_searches: 1, with_results: 1, body_matches: 1, body_only: 1 });
  expect(site(2, 2, 2)).toEqual({ site_later_pages: 1 });
  expect(tallySearch({ site: true, page: 1, matched: null })).toEqual({ site_failures: 1 });
  expect(tallySearch({ site: false, page: 1, matched: { total: 5, body: 5 } })).toEqual({ api_requests: 1 });
});

it('adds a day of counts in one statement and keeps them when the write fails', async () => {
  const query = vi.fn().mockRejectedValueOnce(Error('down')).mockResolvedValue([{}]);
  const onError = vi.fn();
  const usage = createSearchUsage({ query } as unknown as Pool, { now: () => new Date('2026-10-18T04:00:00Z'), onError });
  usage.record({ site: true, page: 1, matched: { total: 2, body: 1 } });
  usage.record({ site: true, page: 1, matched: { total: 0, body: 0 } });
  usage.record({ site: false, page: 1, matched: { total: 1, body: 0 } });
  await usage.flush();
  expect(onError).toHaveBeenCalledOnce();
  await usage.close();
  expect(query).toHaveBeenCalledTimes(2);
  const [sql, values] = query.mock.calls[1];
  expect(sql).toMatch(/^SET STATEMENT max_statement_time=1 FOR INSERT INTO search_usage_daily/);
  expect(sql.match(/\(day,([a-z_,]+),updated_at\)/)?.[1]).toBe(SEARCH_USAGE_COLUMNS.join(','));
  for (const column of SEARCH_USAGE_COLUMNS) expect(sql).toContain(`${column}=${column}+VALUES(${column})`);
  const columns = Object.fromEntries(SEARCH_USAGE_COLUMNS.map((column, i) => [column, values[i + 1]]));
  expect(values[0]).toBe('2026-10-18');
  expect(columns).toEqual({
    site_searches: 2,
    site_later_pages: 0,
    with_results: 1,
    body_matches: 1,
    body_only: 0,
    site_failures: 0,
    api_requests: 1,
  });
  await usage.close();
  expect(query).toHaveBeenCalledTimes(2);
});

it('records answered and failed searches without the query, and keeps matched out of the response', async () => {
  vi.stubEnv('BLOG_SEARCH_FULLTEXT_ENABLED', 'true');
  const query = vi.fn().mockResolvedValue([[]]);
  const record = vi.fn();
  const app = Fastify();
  registerSearchRoutes(app, { query } as unknown as Pool, { record, flush: vi.fn(), close: vi.fn() } as never);
  try {
    const ok = await app.inject({ url: '/api/search?q=蛤蜊&page=2', headers: { 'sec-fetch-site': 'same-origin' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).not.toHaveProperty('matched');
    expect(record).toHaveBeenLastCalledWith({ site: true, page: 2, matched: { total: 0, body: 0 } });
    query.mockRejectedValueOnce({ code: 'ER_STATEMENT_TIMEOUT' });
    expect((await app.inject('/api/search?q=蛤蜊')).statusCode).toBe(503);
    expect(record).toHaveBeenLastCalledWith({ site: false, page: 1, matched: null });
    expect((await app.inject('/api/search?q=')).statusCode).toBe(400);
    expect(record).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(record.mock.calls)).not.toContain('蛤蜊');
  } finally {
    await app.close();
  }
});
