import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backfillBlogTechnology, parseTechBackfillArgs } from './backfill.ts';
import { TECH_LIMITS } from './contracts.ts';

const body = (extra = {}) => ({
  blog_url: 'https://fixture.example/',
  post_url: 'https://fixture.example/post',
  source_url: 'https://fixture.example/post?token=PRIVATE',
  post_id: 11,
  obtained_at: new Date('2026-01-01T00:00:00Z'),
  html_bytes: Buffer.from('<meta name="generator" content="WordPress 7.1.3">'),
  html_truncated: 0,
  last_attempt_at: null,
  ...extra,
});
function fake(rows: unknown[]) {
  const query = vi.fn().mockResolvedValueOnce([rows.map((_, i) => ({ id: i + 1 }))]);
  for (const row of rows) query.mockResolvedValueOnce([row ? [row] : []]);
  return { pool: { query } as unknown as Pool, query };
}
afterEach(() => vi.unstubAllGlobals());
describe('stored HTML passive backfill', () => {
  it('defaults to read-only, makes zero HTTP calls, and never outputs evidence or URLs', async () => {
    const fetch = vi.fn(() => {
      throw Error('network_forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    const { pool, query } = fake([body()]);
    const writer = vi.fn();
    const result = await backfillBlogTechnology(pool, {}, writer);
    expect(result.mode).toBe('dry-run');
    expect(result.counts.detected).toBe(1);
    expect(writer).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|fixture.example|WordPress|<meta/);
    expect(query.mock.calls[1][0].values).toEqual([TECH_LIMITS.htmlBytes, TECH_LIMITS.htmlBytes, 1]);
    expect(query.mock.calls[1][0].sql).toContain('SUBSTRING(CAST(c.body_html AS BINARY),1,?)');
  });
  it('uses original observation time, post provenance and bounded truncation on explicit apply', async () => {
    const { pool } = fake([body({ html_truncated: 1 })]);
    const writer = vi.fn().mockResolvedValue({ written: true, reason: 'stored' });
    const result = await backfillBlogTechnology(pool, { apply: true }, writer);
    const input = writer.mock.calls[0][1];
    expect(input.sourcePostId).toBe(11);
    expect(input.observation.sourceType).toBe('body-fragment');
    expect(input.observation.observedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(input.observation.lastAttemptAt).toBe(input.observation.observedAt);
    expect(input.observation.coverage.htmlTruncated).toBe(true);
    expect(result.counts.written).toBe(1);
  });
  it('never fabricates a failed observation for missing HTML and retains newer scans', async () => {
    const { pool } = fake([null, body({ html_bytes: Buffer.from(' ') }), body({ last_attempt_at: new Date('2026-01-02') })]);
    const writer = vi.fn();
    const result = await backfillBlogTechnology(pool, { apply: true }, writer);
    expect(result.counts.skipped).toBe(3);
    expect(result.counts.failed).toBe(0);
    expect(result.items[2].reason).toBe('stale');
    expect(writer).not.toHaveBeenCalled();
  });
  it('does not relabel another platform owner or foreign feed evidence', async () => {
    const { pool } = fake([
      body({ source_url: 'https://feeds.other.example/feed' }),
      body({ blog_url: 'https://medium.com/@one', source_url: 'https://medium.com/@two/post' }),
    ]);
    const writer = vi.fn();
    const result = await backfillBlogTechnology(pool, { apply: true }, writer);
    expect(result.items.every((i) => i.reason === 'ownership-mismatch')).toBe(true);
    expect(writer).not.toHaveBeenCalled();
  });
  it('applies public joins to each body selection even after the initial ID query', async () => {
    const { pool, query } = fake([null]);
    await backfillBlogTechnology(pool);
    const sql = query.mock.calls[1][0].sql;
    expect(sql).toContain("b.status='verified'");
    expect(sql).toContain('p.id=c.post_id AND p.blog_id=c.blog_id');
    expect(sql).toContain('p.published_at<=UTC_TIMESTAMP()');
    expect(sql).toContain('c.obtained_at<=UTC_TIMESTAMP()');
    expect(sql).toContain('LIMIT 1');
  });
  it('processes sequentially with a resumable ID cursor and rejects oversized batches', async () => {
    const { pool, query } = fake([body(), body()]);
    const result = await backfillBlogTechnology(pool, { afterId: 7, limit: 2 });
    expect(query.mock.calls[0][0].values).toEqual([7, 2]);
    expect(result.complete).toBe(false);
    expect(result.nextCursor).toBe(2);
    await expect(backfillBlogTechnology(pool, { limit: 11 })).rejects.toThrow('invalid_backfill_options');
  });
  it('only explicit --apply writes and rejects ambiguous CLI options', () => {
    expect(parseTechBackfillArgs([])).toEqual({ apply: false, afterId: 0, limit: 10 });
    expect(parseTechBackfillArgs(['--after-id', '123', '--limit', '2', '--apply'])).toEqual({ apply: true, afterId: 123, limit: 2 });
    for (const args of [['--limit', '11'], ['--limit', '0'], ['--limit'], ['--apply', '--apply'], ['--unknown'], ['--after-id', '-1']])
      expect(() => parseTechBackfillArgs(args)).toThrow('invalid_backfill_options');
  });
});
