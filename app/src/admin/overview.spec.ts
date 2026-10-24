import { describe, expect, it } from 'vitest';
import { fakeTagClient } from '../../test/tag-client.ts';
import { setTagClient } from '../blog-genres/traffic.ts';
import { ACCOUNT_METRICS, adminAccounts, auditMetric } from './accounts.ts';
import { crawlState } from './blogs.ts';

describe('auditMetric', () => {
  it('maps every admin write to one metric of the admin group', () => {
    const admin = new Set(ACCOUNT_METRICS.filter((m) => m.group === 'admin').map((m) => m.key));
    for (const action of [
      'candidate.approve',
      'candidate.reject',
      'ai.override',
      'tags.manual',
      'genre.set',
      'genre.release',
      'relations.visibility',
      'similarweb.submit.reserved',
      'blog.rename',
      'role.cli',
      'something.new',
    ])
      expect(admin.has(auditMetric(action) ?? '')).toBe(true);
    expect(auditMetric('genre.hide')).toBe('genres');
    expect(auditMetric('blog.remove')).toBe('blogs');
  });
  it('skips rows that are not an edit of their own', () => {
    for (const action of ['role.bootstrap', 'similarweb.submit.outcome', 'tags.manual.intent', 'discovery.review.intent'])
      expect(auditMetric(action)).toBeNull();
  });
});

describe('crawlState', () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  const blog = {
    status: 'verified',
    lastCrawlSuccessAt: '2026-10-17T11:00:00Z',
    lastPublishedAt: '2026-10-10T00:00:00Z',
    feeds: 1,
    feedFailures: 0,
    scraper: false,
  };
  it('tells working, quiet, failing, never-crawled and retired blogs apart', () => {
    expect(crawlState(blog, now)).toBe('ok');
    expect(crawlState({ ...blog, lastPublishedAt: '2026-06-01T00:00:00Z' }, now)).toBe('quiet');
    expect(crawlState({ ...blog, lastPublishedAt: null }, now)).toBe('quiet');
    expect(crawlState({ ...blog, feedFailures: 3 }, now)).toBe('failing');
    expect(crawlState({ ...blog, lastCrawlSuccessAt: null }, now)).toBe('never');
    expect(crawlState({ ...blog, status: 'moved' }, now)).toBe('off');
  });
  it('does not call a blog failing while a generated scraper collects it', () => {
    expect(crawlState({ ...blog, feedFailures: 9, scraper: true }, now)).toBe('ok');
  });
});

describe('adminAccounts tag votes', () => {
  const pool = {
    query: async (sql: string) =>
      sql.includes('FROM users u')
        ? [
            [
              { id: 1, email: 'Reader@Test', role: 'reader', sub: 's1', createdAt: null, lastLoginAt: null },
              { id: 2, email: 'quiet@test', role: 'reader', sub: 's2', createdAt: null, lastLoginAt: null },
            ],
          ]
        : [[]],
  };
  it("counts each account's votes cast through blog on traffic.observe.tw", async () => {
    setTagClient(fakeTagClient({}, { voterStats: { 'reader@test': { votes: 3, lastAt: '2026-10-24T01:00:00.000Z' } } }).client);
    const data = await adminAccounts(pool as never, new Set());
    expect(data.votesUnavailable).toBe(false);
    expect(data.accounts.find((a) => a.id === 1)).toMatchObject({ counts: { votes: 3 }, lastActiveAt: '2026-10-24T01:00:00.000Z' });
    expect(data.accounts.find((a) => a.id === 2)?.counts).toEqual({});
    expect(ACCOUNT_METRICS.find((m) => m.key === 'votes')).toEqual({ key: 'votes', label: '標籤投票', group: 'contribute' });
  });
  it('still answers, marked, when traffic does not', async () => {
    const data = await adminAccounts(pool as never, new Set());
    expect(data.votesUnavailable).toBe(true);
    expect(data.accounts).toHaveLength(2);
  });
});
