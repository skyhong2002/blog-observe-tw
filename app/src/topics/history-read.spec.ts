import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { durableTopicDetail, historyCursor, historyEvidenceSql, readTopicHistory, topicHistoryDisposition } from './history-read.ts';

const id = 'a'.repeat(64),
  other = 'b'.repeat(64),
  at = '2026-10-01T01:02:03.000Z';
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const pages = new Map<string, Record<string, unknown>>([
    [id, { canonical_id: id, label: '歷史話題', state: 'active', merged_into: null }],
  ]);
  const counts = { total: 1, retained: 1, public_count: 1 };
  let currentNoise: string | null = null;
  let highFrequency: number | null = null;
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.startsWith('SELECT f.high_frequency')) return [highFrequency === null ? [] : [{ high_frequency: highFrequency }]];
    if (sql.includes('SELECT b.id,b.slug,b.name')) return [[]];
    if (sql.includes('WHERE h.fresh=1') && sql.includes('SELECT p.id,p.title,p.url'))
      return [
        sql.includes('AND h.title_hit=1')
          ? []
          : [{ id: 5, title: '正文命中', url: 'https://example.test/post', publishedAt: at, blogSlug: 'writer', blogName: '作者' }],
      ];
    if (sql.startsWith('SELECT t.exclusion_reason')) return [currentNoise ? [{ exclusion_reason: currentNoise }] : []];
    if (sql.startsWith('SELECT * FROM topic_pages')) return [[pages.get(String(args[0]))].filter(Boolean)];
    if (sql.includes('COUNT(*) total,SUM(e.state')) return [[counts]];
    if (sql.includes('FROM public_route_keys')) return [[{ entity_id: id }]];
    if (sql.includes('SELECT COUNT(*) total,SUM(fresh')) return [[{ total: 1, confirmed: 0, pending: 1, last_observed: at }]];
    if (sql.includes('SELECT p.id,p.title,p.url'))
      return [
        [
          {
            id: 5,
            title: '公開標題',
            url: 'https://example.test/post',
            publishedAt: '2020-01-01T00:00:00.000Z',
            blogSlug: 'writer',
            blogName: '作者',
            fresh: 0,
            observed_at: at,
          },
        ],
      ];
    throw Error('unexpected query');
  });
  return {
    pages,
    counts,
    setFrequency: (value: number | null) => {
      highFrequency = value;
    },
    query,
    setNoise: (reason: string | null) => {
      currentNoise = reason;
    },
    pool: { query } as unknown as Pool,
  };
}
describe('durable topic history reads', () => {
  it('flag off performs no new-table reads', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'false');
    const f = fixture();
    expect(await topicHistoryDisposition(f.pool, id)).toEqual({ status: 'unknown' });
    expect((await readTopicHistory(f.pool, id)).total).toBe(0);
    expect(f.query).not.toHaveBeenCalled();
  });
  it('does not require the rolling current snapshot; masked/restored state is not negative-cached', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
    const f = fixture();
    expect((await topicHistoryDisposition(f.pool, `tag:${id}`)).status).toBe('available');
    f.counts.public_count = 0;
    expect((await topicHistoryDisposition(f.pool, id)).status).toBe('masked');
    f.counts.public_count = 1;
    expect((await topicHistoryDisposition(f.pool, id)).status).toBe('available');
    expect(
      f.query.mock.calls.filter(([sql]) => sql.includes('topic_current')).every(([sql]) => sql.includes('exclusion_reason IS NOT NULL')),
    ).toBe(true);
  });
  it('only explicit current exclusion is negative; clearing it does not retain a stale 410', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
    const f = fixture();
    f.setNoise('upstream-noise');
    expect((await topicHistoryDisposition(f.pool, id)).status).toBe('gone');
    f.setNoise(null);
    expect((await topicHistoryDisposition(f.pool, id)).status).toBe('available');
    f.pages.set(id, { state: 'pending', label: '歷史話題', reason: 'explicit-noise' });
    expect((await topicHistoryDisposition(f.pool, id)).status).toBe('gone');
  });
  it('all explicit revocations/deleted posts yield gone, unknown never yields gone', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
    const f = fixture();
    f.counts.retained = 0;
    expect((await topicHistoryDisposition(f.pool, id)).status).toBe('gone');
    f.counts.total = 0;
    expect((await topicHistoryDisposition(f.pool, id)).status).toBe('unknown');
    f.pages.set(id, { label: '＋－…', state: 'active' });
    expect((await topicHistoryDisposition(f.pool, id)).status).toBe('gone');
  });
  it('follows merges to final canonical in one resolution and protects against cycles', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
    const f = fixture();
    f.pages.set(id, { state: 'merged', merged_into: other });
    f.pages.set(other, { state: 'pending', label: '合併後' });
    expect(await topicHistoryDisposition(f.pool, id)).toMatchObject({ status: 'available', canonicalId: other, merged: true });
    f.pages.set(other, { state: 'merged', merged_into: id });
    expect(await topicHistoryDisposition(f.pool, id)).toEqual({ status: 'unknown', reason: 'merge-cycle' });
  });
  it('returns only allowlisted historical title/link evidence without summary or body', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
    const f = fixture();
    const history = await readTopicHistory(f.pool, id);
    expect(history).toMatchObject({ total: 1, confirmed: 0, pending: 1, articles: [{ id: 5, evidenceState: 'pending', observedAt: at }] });
    expect(Object.keys(history.articles[0]).sort()).toEqual(
      ['id', 'title', 'url', 'publishedAt', 'blogSlug', 'blogName', 'evidenceState', 'observedAt'].sort(),
    );
    const sql = historyEvidenceSql();
    expect(sql).toContain("b.status='verified'");
    expect(sql).toContain("e.state IN ('confirmed','pending')");
    expect(sql).toContain('e.post_hash IS NOT NULL');
  });
  it('keeps prior body observations in history but applies current title-only policy to both recent queries', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
    const f = fixture();
    f.setFrequency(1);
    const result = await durableTopicDetail(f.pool, `tag:${id}`, 30, new Date(at));
    expect(result?.topic).toMatchObject({ matchingRule: 'title-only', matchingReason: 'high-document-frequency-title-only' });
    expect(result?.articles).toEqual([]);
    expect(result?.history.articles).toHaveLength(1);
    const recent = f.query.mock.calls.filter(([sql]) => sql.includes('WHERE h.fresh=1'));
    expect(recent).toHaveLength(2);
    expect(recent.every(([sql]) => sql.includes('AND h.title_hit=1'))).toBe(true);
    const history = f.query.mock.calls.filter(([sql]) => sql.includes('FROM historical') && !sql.includes('WHERE h.fresh=1'));
    expect(history.every(([sql]) => !sql.includes('AND h.title_hit=1'))).toBe(true);
  });
  it('without a current frequency baseline does not invent a title-only restriction', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
    const f = fixture();
    const result = await durableTopicDetail(f.pool, `tag:${id}`, 30, new Date(at));
    expect(result?.topic).toMatchObject({ matchingRule: 'title-and-body', matchingReason: null });
    expect(result?.articles).toHaveLength(1);
    expect(f.query.mock.calls.filter(([sql]) => sql.includes('WHERE h.fresh=1')).every(([sql]) => !sql.includes('AND h.title_hit=1'))).toBe(
      true,
    );
  });
  it('validates keyset timestamp/id and binds cursors to canonical topic', () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1, topic: id, at, id: 5 })).toString('base64url');
    expect(historyCursor(cursor, id)).toEqual({ observedAt: at, postId: 5 });
    for (const value of [
      cursor + '!',
      Buffer.from(JSON.stringify({ v: 1, topic: other, at, id: 5 })).toString('base64url'),
      Buffer.from(JSON.stringify({ v: 1, topic: id, at: 'invalid', id: 5 })).toString('base64url'),
    ])
      expect(() => historyCursor(value, id)).toThrow('invalid_history_cursor');
  });
});
