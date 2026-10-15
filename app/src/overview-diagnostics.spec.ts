import { describe, expect, it } from 'vitest';
import { overviewFailureDetails, overviewPoolState, overviewRead } from './overview-diagnostics.ts';

describe('bounded overview diagnostics', () => {
  it('records actual MariaDB numeric timeout even when mysql2 has no string code', async () => {
    const failure = Object.assign(Error('private SELECT body and secret parameters'), {
      errno: 1969,
      sqlState: '70100',
      sql: 'private query',
      sqlMessage: 'private details',
    });
    const pool = {
      pool: {
        _allConnections: { length: 4 },
        _freeConnections: { length: 1 },
        _connectionQueue: { length: 2 },
        config: { connectionLimit: 4 },
      },
    };
    let error: unknown;
    try {
      await overviewRead(pool, 'home.mentions', async () => {
        throw failure;
      });
    } catch (e) {
      error = e;
    }
    const log = overviewFailureDetails(error, pool);
    expect(log).toMatchObject({
      queryStage: 'home.mentions',
      failureKind: 'statement-timeout',
      databaseCode: 'unknown',
      databaseErrno: 1969,
      sqlState: '70100',
      poolState: { size: 4, free: 1, active: 3, queued: 2, limit: 4 },
    });
    expect(log.readElapsedMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(log)).not.toMatch(/private|SELECT|secret/);
    expect(error).not.toHaveProperty('cause');
    expect(JSON.stringify(error)).not.toMatch(/private|SELECT|secret/);
  });
  it.each([
    'home.authors',
    'home.totals',
    'home.recentBlogs',
    'full.posts',
    'full.tags',
    'full.authors',
    'full.blogs',
    'full.totals',
    'full.recentBlogs',
    'home.icons',
    'full.icons',
  ])('identifies %s without changing the rejection contract', async (stage) => {
    let error: unknown;
    try {
      await overviewRead({}, stage, async () => {
        throw Object.assign(Error('private'), { code: 'ECONNRESET' });
      });
    } catch (e) {
      error = e;
    }
    expect(overviewFailureDetails(error, {})).toMatchObject({
      queryStage: stage,
      databaseCode: 'ECONNRESET',
      failureKind: 'connection-error',
      poolState: { size: null, free: null, active: null, queued: null, limit: null },
    });
  });
  it('preserves successful fresh reads without retaining or sharing work', async () => {
    let value = 1;
    expect(await overviewRead({}, 'home.totals', async () => value)).toBe(1);
    value = 2;
    expect(await overviewRead({}, 'home.totals', async () => value)).toBe(2);
  });
  it('distinguishes admission, driver queue, lock and connection failures', () => {
    expect(overviewFailureDetails(Object.assign(Error('topic_cache_busy'), { statusCode: 503 }), {})).toMatchObject({
      queryStage: 'admission',
      failureKind: 'admission-busy',
      databaseErrno: null,
    });
    for (const [error, kind] of [
      [Error('Queue limit reached.'), 'pool-queue-limit'],
      [Error('Pool is closed.'), 'pool-closed'],
      [{ errno: 1205 }, 'lock-timeout'],
      [{ errno: 1213 }, 'deadlock'],
      [{ code: 'ETIMEDOUT', errno: -110 }, 'connection-error'],
    ] as const)
      expect(overviewFailureDetails(error, {}).failureKind).toBe(kind);
  });
  it('never copies arbitrary error data or treats missing/invalid counters as zero', () => {
    const log = overviewFailureDetails(
      {
        code: 'private-key-or-query',
        errno: '1969',
        sqlState: 'private sql',
        message: 'private secret',
        headers: { Authorization: 'private' },
      },
      {},
    );
    expect(log).toMatchObject({
      queryStage: 'unknown',
      failureKind: 'unknown',
      databaseCode: 'unknown',
      databaseErrno: null,
      sqlState: null,
      readElapsedMs: null,
    });
    expect(JSON.stringify(log)).not.toMatch(/private|secret|Authorization/);
    expect(
      overviewPoolState({
        pool: { _allConnections: { length: -1 }, _freeConnections: { length: Infinity }, config: { connectionLimit: '4' } },
      }),
    ).toMatchObject({ size: null, free: null, limit: null });
  });
});
