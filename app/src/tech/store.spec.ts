import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TECH_LIMITS } from './contracts.ts';
import { detectTechnology } from './detector.ts';
import { publicTechSourceSql, recordTechObservation, sameTechPublication } from './store.ts';

const input = () => ({
  blogId: 1,
  sourceUrl: 'https://blog.example/',
  observation: detectTechnology({ url: 'https://blog.example/', html: '<meta name="generator" content="WordPress">' }),
});
afterEach(() => vi.useRealTimers());
describe('technology ownership and bounded writer', () => {
  it.each([
    ['https://medium.com/@alice/post', 'https://medium.com/@alice', true],
    ['https://medium.com/@bob/post', 'https://medium.com/@alice', false],
    ['https://matters.town/@alice/post', 'https://matters.town/@alice', true],
    ['https://note.com/bob/a', 'https://note.com/alice', false],
    ['https://blog.example/blog/article', 'https://blog.example/blog/', true],
    ['https://blog.example/blogger/article', 'https://blog.example/blog/', false],
    ['https://other.example/', 'https://blog.example/', false],
    ['http://blog.example/', 'https://blog.example/', false],
  ])('publication ownership: %s vs %s', (url, publication, allowed) => expect(sameTechPublication(url, publication)).toBe(allowed));
  it('rejects invalid input before touching pool and reports safe DB failures', async () => {
    const getConnection = vi.fn().mockRejectedValue(Error('secret connection string'));
    const pool = { getConnection } as unknown as Pool;
    expect(await recordTechObservation(pool, { ...input(), blogId: -1 })).toEqual({ written: false, reason: 'invalid-input' });
    expect(getConnection).not.toHaveBeenCalled();
    expect(await recordTechObservation(pool, input())).toEqual({ written: false, reason: 'unavailable' });
  });
  it('times out acquisition and releases a late connection without writing', async () => {
    vi.useFakeTimers();
    let supply: (value: unknown) => void = () => {};
    const pool = {
      getConnection: () =>
        new Promise((resolve) => {
          supply = resolve;
        }),
    } as unknown as Pool;
    const promise = recordTechObservation(pool, input());
    await vi.advanceTimersByTimeAsync(TECH_LIMITS.storeTimeoutMs + 1);
    expect(await promise).toEqual({ written: false, reason: 'unavailable' });
    const connection = { release: vi.fn(), beginTransaction: vi.fn() };
    supply(connection);
    await Promise.resolve();
    expect(connection.release).toHaveBeenCalledOnce();
    expect(connection.beginTransaction).not.toHaveBeenCalled();
  });
  it('keeps one unresolved acquisition after timeout instead of accumulating queue waiters', async () => {
    vi.useFakeTimers();
    const pending = Promise.withResolvers<unknown>();
    const getConnection = vi.fn(() => pending.promise);
    const pool = { getConnection } as unknown as Pool;
    const first = recordTechObservation(pool, input());
    await vi.advanceTimersByTimeAsync(TECH_LIMITS.storeTimeoutMs + 1);
    expect(await first).toEqual({ written: false, reason: 'unavailable' });
    for (let i = 0; i < 40; i++) expect(await recordTechObservation(pool, input())).toEqual({ written: false, reason: 'unavailable' });
    expect(getConnection).toHaveBeenCalledTimes(1);
    const released = Promise.withResolvers<void>();
    const connection = { release: vi.fn(() => released.resolve()), beginTransaction: vi.fn() };
    pending.resolve(connection);
    await released.promise;
    expect(connection.beginTransaction).not.toHaveBeenCalled();
    getConnection.mockRejectedValueOnce(Error('safe mock failure'));
    expect(await recordTechObservation(pool, input())).toEqual({ written: false, reason: 'unavailable' });
    expect(getConnection).toHaveBeenCalledTimes(2);
  });
  it('destroys an in-flight timed-out transaction instead of allowing delayed writes', async () => {
    vi.useFakeTimers();
    const connection = {
      beginTransaction: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(() => new Promise(() => {})),
      destroy: vi.fn(),
      release: vi.fn(),
    };
    const pool = { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool;
    const promise = recordTechObservation(pool, input());
    await vi.advanceTimersByTimeAsync(TECH_LIMITS.storeTimeoutMs + 1);
    expect(await promise).toEqual({ written: false, reason: 'unavailable' });
    expect(connection.destroy).toHaveBeenCalledOnce();
    expect(connection.release).not.toHaveBeenCalled();
  });
  it('read predicate includes both successful and failed-attempt article provenance', () => {
    const predicate = publicTechSourceSql();
    expect(predicate).toContain("b.status='verified'");
    expect(predicate).toContain('s.source_post_id');
    expect(predicate).toContain('s.last_attempt_source_post_id');
    expect(predicate).toContain('published_at<=UTC_TIMESTAMP()');
    expect(() => publicTechSourceSql('s;drop')).toThrow('invalid_sql_alias');
  });
});
