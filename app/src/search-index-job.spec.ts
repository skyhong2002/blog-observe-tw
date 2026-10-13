import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { createIndexJobClaim, createIndexJobEnqueue, indexJobIds, runSearchIndexJob, SEARCH_INDEX_JOB } from './search-index-job.ts';

const pool = {} as Pool;
describe('bounded index job', () => {
  it('rejects invalid selections and copies without invoking iterator', () => {
    for (const value of [[], [0], [1, 1], Array.from({ length: 11 }, (_, i) => i + 1), ['1']]) expect(() => indexJobIds(value)).toThrow();
    const ids = [1];
    Object.defineProperty(ids, Symbol.iterator, {
      value: function* () {
        yield 99;
      },
    });
    expect(indexJobIds(ids)).toEqual([1]);
  });
  it('acknowledges only after add and carries IDs only, with no automatic retry', async () => {
    const add = vi.fn().mockResolvedValue({ id: '1' });
    const enqueue = createIndexJobEnqueue(add);
    expect(await enqueue([1, 2])).toEqual({ acceptedPostIds: [1, 2] });
    expect(add).toHaveBeenCalledWith(SEARCH_INDEX_JOB, { postIds: [1, 2] }, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 });
  });
  it('retains pending admission after timeout and does not replay unknown enqueue', async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const add = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const enqueue = createIndexJobEnqueue(add, 10);
    const first = enqueue([1]);
    const asserted = expect(first).rejects.toThrow('index_queue_unknown');
    await vi.advanceTimersByTimeAsync(10);
    await asserted;
    await expect(enqueue([2])).rejects.toThrow('index_queue_pending');
    expect(add).toHaveBeenCalledTimes(1);
    resolve({});
    await Promise.resolve();
    await Promise.resolve();
    vi.useRealTimers();
  });
  it('disabled/invalid jobs do not claim or read SQL', async () => {
    const claim = vi.fn(),
      produce = vi.fn();
    expect(await runSearchIndexJob(pool, { postIds: [1] }, { claim, produce })).toEqual({ status: 'disabled' });
    expect(await runSearchIndexJob(pool, { postIds: ['PRIVATE'] }, { enabled: true, claim, produce })).toEqual({ status: 'invalid' });
    expect(claim).not.toHaveBeenCalled();
    expect(produce).not.toHaveBeenCalled();
  });
  it('atomic claim denial / unknown claim failure never runs producer', async () => {
    const produce = vi.fn();
    for (const claim of [vi.fn().mockResolvedValue(false), vi.fn().mockRejectedValue(Error('private'))]) {
      expect(await runSearchIndexJob(pool, { postIds: [1] }, { enabled: true, claim, produce })).toEqual({
        status: 'needs-repair',
        postIds: [1],
      });
    }
    expect(produce).not.toHaveBeenCalled();
  });
  it('fresh producer runs apply once; private/missing evidence is not fabricated as stored', async () => {
    const events: string[] = [];
    const produce = vi.fn(async () => {
      events.push('produce');
      return { mode: 'apply' as const, indexVersion: 'native-body-grams-v1', exhaustive: false as const, items: [] };
    });
    const result = await runSearchIndexJob(
      pool,
      { postIds: [1], secret: 'PRIVATE' },
      {
        enabled: true,
        claim: async () => {
          events.push('claim');
          return true;
        },
        produce,
      },
    );
    expect(events).toEqual(['claim', 'produce']);
    expect(produce).toHaveBeenCalledExactlyOnceWith(pool, [1], true);
    expect(result.status).toBe('completed');
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('failed producer is repair, not retry or fabricated SQL rollback', async () => {
    const produce = vi.fn().mockRejectedValue(Error('secret query'));
    expect(await runSearchIndexJob(pool, { postIds: [1] }, { enabled: true, claim: async () => true, produce })).toEqual({
      status: 'needs-repair',
      postIds: [1],
    });
    expect(produce).toHaveBeenCalledTimes(1);
  });
});

describe('bounded atomic claim', () => {
  it('timeout retains admission; late NX never starts producer; settled slot permits a fresh explicit request', async () => {
    vi.useFakeTimers();
    try {
      let settle!: (value: boolean) => void;
      const setNx = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<boolean>((resolve) => {
              settle = resolve;
            }),
        )
        .mockResolvedValue(false);
      const claim = createIndexJobClaim(setNx, 10);
      const produce = vi.fn();
      const first = runSearchIndexJob(pool, { postIds: [1] }, { enabled: true, claim: () => claim('job-1'), produce });
      await vi.advanceTimersByTimeAsync(10);
      expect(await first).toEqual({ status: 'needs-repair', postIds: [1] });
      expect(await runSearchIndexJob(pool, { postIds: [2] }, { enabled: true, claim: () => claim('job-2'), produce })).toEqual({
        status: 'needs-repair',
        postIds: [2],
      });
      expect(setNx).toHaveBeenCalledTimes(1);
      settle(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(produce).not.toHaveBeenCalled();
      // Explicit retry uses NX again. Existing marker denies it, never silently clears/replays.
      expect(await runSearchIndexJob(pool, { postIds: [1] }, { enabled: true, claim: () => claim('job-1'), produce })).toEqual({
        status: 'needs-repair',
        postIds: [1],
      });
      expect(setNx.mock.calls).toEqual([['job-1'], ['job-1']]);
      expect(produce).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it('NX failure is sanitized and settled admission permits another explicit claim', async () => {
    const setNx = vi.fn().mockRejectedValueOnce(Error('secret')).mockResolvedValue(true);
    const claim = createIndexJobClaim(setNx);
    await expect(claim('one')).rejects.toThrow('index_claim_unknown');
    expect(await claim('two')).toBe(true);
  });
});
