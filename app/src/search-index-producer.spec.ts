import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { produceBodySearchIndex, searchIndexPostIds } from './search-index-producer.ts';

const row = {
  id: 20875,
  url: 'https://anise.tw/290726',
  blog_url: 'https://anise.tw/',
  source_url: 'https://anise.tw/feed',
  article_url: 'https://anise.tw/290726',
  body_bytes: Buffer.from('這道蛤蜊絲瓜很鮮甜'),
  content_hash: 'c'.repeat(64),
};
function fixture(value: unknown = row) {
  const connection = {
    query: vi.fn().mockResolvedValue([[value]]),
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  return { connection, pool: { getConnection: vi.fn().mockResolvedValue(connection) } as unknown as Pool };
}
describe('explicit small body index producer', () => {
  it.each([[], [1, 1], [0], [NaN], Array.from({ length: 11 }, (_, i) => i + 1)])(
    'rejects invalid unbounded selection %j before SQL',
    (ids) => {
      expect(() => searchIndexPostIds(ids)).toThrow();
    },
  );
  it('defaults to dry-run without transaction or index writes', async () => {
    const f = fixture();
    const result = await produceBodySearchIndex(f.pool, [20875]);
    expect(result.items[0].status).toBe('dry-run');
    expect(f.connection.query).toHaveBeenCalledTimes(1);
    expect(f.connection.beginTransaction).not.toHaveBeenCalled();
    expect(f.connection.commit).not.toHaveBeenCalled();
  });
  it('atomically replaces only selected derived postings from locked public evidence', async () => {
    const f = fixture();
    const result = await produceBodySearchIndex(f.pool, [20875], true);
    expect(result.items[0].status).toBe('stored');
    expect(f.connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(f.connection.query.mock.calls[0][0].sql).toContain('FOR UPDATE');
    expect(f.connection.query.mock.calls[1][1]).toEqual([20875]);
    expect(f.connection.commit).toHaveBeenCalledTimes(1);
  });
  it('explicit apply clears only selected stale derived postings for missing/withdrawn evidence', async () => {
    const f = fixture(undefined);
    f.connection.query.mockResolvedValue([[]]);
    expect((await produceBodySearchIndex(f.pool, [20875], true)).items[0].status).toBe('unindexed');
    expect(f.connection.query).toHaveBeenCalledTimes(2);
    expect(f.connection.query.mock.calls[1][1]).toEqual([20875]);
    expect(f.connection.commit).toHaveBeenCalledTimes(1);
  });
  it('cross-owner source and oversized input are never indexed', async () => {
    for (const r of [
      { ...row, source_url: 'https://other.example/private' },
      { ...row, body_bytes: Buffer.alloc(65537) },
    ]) {
      const f = fixture(r);
      const result = await produceBodySearchIndex(f.pool, [20875], true);
      expect(['unindexed', 'overcap']).toContain(result.items[0].status);
      expect(f.connection.query).toHaveBeenCalledTimes(2);
      expect(f.connection.query.mock.calls[1][1]).toEqual([20875]);
    }
  });
  it('failed write rolls back and stops batch without fake stored result or retry', async () => {
    const f = fixture();
    f.connection.query.mockResolvedValueOnce([[row]]).mockRejectedValueOnce({ code: 'ER_STATEMENT_TIMEOUT' });
    await expect(produceBodySearchIndex(f.pool, [20875, 20876], true)).rejects.toThrow('search_index_unavailable');
    expect(f.connection.rollback).toHaveBeenCalledTimes(1);
    expect(f.connection.commit).not.toHaveBeenCalled();
    expect(f.pool.getConnection).toHaveBeenCalledTimes(1);
  });
  it('pending pool wait times out without starting SQL and destroys late acquisition', async () => {
    vi.useFakeTimers();
    try {
      let resolve!: (v: unknown) => void;
      const f = fixture();
      f.pool.getConnection = vi.fn(() => new Promise((r) => (resolve = r))) as never;
      const run = produceBodySearchIndex(f.pool, [20875], true);
      const rejection = expect(run).rejects.toThrow('search_index_unavailable');
      await vi.advanceTimersByTimeAsync(501);
      await rejection;
      resolve(f.connection);
      await Promise.resolve();
      await Promise.resolve();
      expect(f.connection.destroy).toHaveBeenCalledTimes(1);
      expect(f.connection.query).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('commit rejection does not report a stored result and releases only after rollback', async () => {
    const f = fixture();
    f.connection.commit.mockRejectedValueOnce(Error('fixture_commit_failure'));
    await expect(produceBodySearchIndex(f.pool, [20875, 20876], true)).rejects.toThrow('search_index_unavailable');
    expect(f.connection.commit).toHaveBeenCalledTimes(1);
    expect(f.connection.rollback).toHaveBeenCalledTimes(1);
    expect(f.connection.release).toHaveBeenCalledTimes(1);
    expect(f.connection.destroy).not.toHaveBeenCalled();
    expect(f.pool.getConnection).toHaveBeenCalledTimes(1);
  });
  it('destroys an acquired connection at its deadline without commit or returning it to the pool', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let rejectQuery!: (error: Error) => void;
      f.connection.query.mockImplementationOnce(() => new Promise((_, reject) => (rejectQuery = reject)));
      f.connection.destroy.mockImplementation(() => rejectQuery(Error('fixture_connection_destroyed')));
      const run = produceBodySearchIndex(f.pool, [20875], true);
      const rejection = expect(run).rejects.toThrow('search_index_unavailable');
      await vi.advanceTimersByTimeAsync(5001);
      await rejection;
      expect(f.connection.beginTransaction).toHaveBeenCalledTimes(1);
      expect(f.connection.destroy).toHaveBeenCalledTimes(1);
      expect(f.connection.commit).not.toHaveBeenCalled();
      expect(f.connection.rollback).not.toHaveBeenCalled();
      expect(f.connection.release).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('invalid UTF8 clears stale postings and records a per-post status without stopping the next post', async () => {
    const f = fixture();
    f.connection.query.mockImplementation(async (_sql, args) => {
      if (_sql.sql.includes('SELECT p.id')) return [[args[0] === 20875 ? { ...row, body_bytes: Buffer.from([0xc3, 0x28]) } : row]];
      return [[]];
    });
    const result = await produceBodySearchIndex(f.pool, [20875, 20876], true);
    expect(result.items.map((item) => item.status)).toEqual(['invalid-utf8', 'stored']);
    expect(f.connection.commit).toHaveBeenCalledTimes(2);
    const deletes = f.connection.query.mock.calls.filter(([sql]) => sql.sql.includes('DELETE'));
    expect(deletes.map(([, args]) => args)).toEqual([[20875], [20876]]);
  });
});
