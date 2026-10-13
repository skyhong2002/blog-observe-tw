import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PassiveFetchObservation } from '../crawl/feed.ts';
import type { RecordTechObservationInput } from './contracts.ts';
import { createTechFetchBatch } from './fetch-batch.ts';
import { TechObservationQueue } from './observer.ts';

const context = { blogId: 7, blogUrl: 'https://batch-tech.test/' };
const at = new Date('2026-10-12T00:00:00Z');
const event = (url = context.blogUrl, extra = {}): PassiveFetchObservation => ({
  requestedUrl: url,
  url,
  status: 200,
  headers: { 'content-type': 'text/html' },
  html: '<meta name="generator" content="WordPress 7.1.3"><p>RAW-SECRET</p>',
  htmlTruncated: false,
  observedAt: at,
  ...extra,
});
const fixture = (rows: object[] = []) => {
  const query = vi.fn(async (_sql: unknown, _values: unknown[]) => [rows]);
  const pool = { query } as unknown as Pool;
  const writer = vi.fn(async (_pool: Pool, _input: RecordTechObservationInput) => ({ written: true, reason: 'stored' as const }));
  const queue = new TechObservationQueue(writer);
  const batch = createTechFetchBatch(pool, context, { enabled: true, queue })!;
  return { query, pool, writer, queue, batch };
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe('bounded committed existing-HTML batch', () => {
  it('does not create an observer while disabled', () => {
    vi.stubEnv('BLOG_TECH_ENABLED', 'false');
    expect(createTechFetchBatch({} as Pool, context)).toBeUndefined();
  });
  it('empty XML batches do not even scan committed article URLs', async () => {
    const f = fixture();
    const urls = new Proxy([] as string[], {
      get() {
        throw Error('must not inspect empty batch URLs');
      },
    });
    await expect(f.batch.commit(urls)).resolves.toBeUndefined();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.writer).not.toHaveBeenCalled();
  });
  it('duplicate GUIDs for one committed URL resolve to one deterministic public ID with bounded SQL results', async () => {
    const f = fixture([{ id: 4, url: `${context.blogUrl}post` }]);
    f.batch.observer(event(`${context.blogUrl}post`));
    await f.batch.commit([`${context.blogUrl}post`, `${context.blogUrl}post`]);
    await f.queue.idle();
    const [statement, values] = f.query.mock.calls[0] as [{ sql: string }, unknown[]];
    expect(statement.sql).toContain('MIN(p.id) AS id');
    expect(statement.sql).toContain('GROUP BY p.url ORDER BY id LIMIT 32');
    expect(values).toEqual([context.blogId, context.blogUrl, `${context.blogUrl}post`]);
    expect(f.writer).toHaveBeenCalledOnce();
    expect(f.writer.mock.calls[0][1].sourcePostId).toBe(4);
  });
  it('retains original fetch time and only sanitized DTOs, and waits for commit', async () => {
    const f = fixture([{ id: 8, url: `${context.blogUrl}post` }]);
    f.batch.observer(event(`${context.blogUrl}post`));
    expect(f.query).not.toHaveBeenCalled();
    expect(f.writer).not.toHaveBeenCalled();
    await f.batch.commit([`${context.blogUrl}post`]);
    await f.queue.idle();
    const input = f.writer.mock.calls[0] as unknown as [Pool, { sourcePostId: number; observation: { observedAt: string } }];
    expect(input[1].sourcePostId).toBe(8);
    expect(input[1].observation.observedAt).toBe(at.toISOString());
    expect(JSON.stringify(input[1])).not.toContain('RAW-SECRET');
    expect(JSON.stringify(input[1])).not.toContain('<meta');
    const sql = (f.query.mock.calls[0] as unknown as [{ sql: string; timeout: number }])[0];
    expect(sql.sql).toContain("b.status='verified'");
    expect(sql.sql).toContain('p.published_at<=UTC_TIMESTAMP()');
    expect(sql.timeout).toBe(2500);
  });
  it('does not store missing/future/deleted posts returned by the public lookup or uncommitted URLs', async () => {
    const f = fixture();
    f.batch.observer(event(`${context.blogUrl}missing`));
    await f.batch.commit([`${context.blogUrl}missing`]);
    f.batch.observer(event(`${context.blogUrl}not-imported`));
    await f.batch.commit([]);
    await f.queue.idle();
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.writer).not.toHaveBeenCalled();
  });
  it.each([
    { status: 304 },
    { html: undefined },
    { headers: { 'content-type': 'application/rss+xml', 'x-powered-by': 'WordPress' } },
    { url: 'https://foreign.test/' },
    { requestedUrl: 'https://foreign.test/' },
    { observedAt: new Date(NaN) },
  ])('ignores non-HTML/304/foreign/unproven-time input %j', async (extra) => {
    const f = fixture();
    f.batch.observer(event(context.blogUrl, extra));
    await f.batch.commit([]);
    await f.queue.idle();
    expect(f.query).not.toHaveBeenCalled();
    expect(f.writer).not.toHaveBeenCalled();
  });
  it('discards failed imports and caps staged observations at32', async () => {
    const f = fixture();
    f.batch.observer(event());
    f.batch.discard();
    await f.batch.commit([]);
    expect(f.writer).not.toHaveBeenCalled();
    for (let i = 0; i < 40; i++) f.batch.observer(event());
    await f.batch.commit([]);
    await f.queue.idle();
    expect(f.writer).toHaveBeenCalledTimes(32);
    expect(f.queue.stats().dropped).toBe(8);
  });
  it('isolates post lookup failures from a successful import', async () => {
    const f = fixture();
    f.query.mockRejectedValueOnce(Error('private-db-error'));
    f.batch.observer(event(`${context.blogUrl}post`));
    await expect(f.batch.commit([`${context.blogUrl}post`])).resolves.toBeUndefined();
    expect(f.writer).not.toHaveBeenCalled();
  });
  it('bounds pool acquisition wait and prevents accumulating unresolved reads', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let finish!: (value: object[][]) => void;
    f.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    f.batch.observer(event(`${context.blogUrl}post`));
    const first = f.batch.commit([`${context.blogUrl}post`]);
    await vi.advanceTimersByTimeAsync(2500);
    await first;
    f.batch.observer(event(`${context.blogUrl}post`));
    await f.batch.commit([`${context.blogUrl}post`]);
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.writer).not.toHaveBeenCalled();
    finish([[{ id: 8, url: `${context.blogUrl}post` }]]);
    await Promise.resolve();
    await f.queue.idle();
    expect(f.writer).not.toHaveBeenCalled();
  });
});
