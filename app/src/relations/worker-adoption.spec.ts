import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ ingest: vi.fn(), stored: vi.fn(), save: vi.fn(), retain: vi.fn(), assert: vi.fn() }));
vi.mock('../content/store.ts', () => ({ ingestContentEvidence: m.ingest, storedRelationContent: m.stored }));
vi.mock('../crawl/feed.ts', () => ({
  politeFetch: async () => new Response('<article>body</article>', { headers: { 'content-type': 'text/html' } }),
}));
vi.mock('../jobs/budget.ts', () => ({ reserveBudget: async () => true }));
vi.mock('../jobs/lease.ts', () => ({
  withJobLease: async (_p: unknown, _n: string, fn: (assert: () => Promise<void>) => unknown) => fn(m.assert),
}));
vi.mock('./routes.ts', () => ({ invalidateRelationCache: vi.fn() }));
vi.mock('./store.ts', () => ({
  loadAliases: async () => [],
  reconcileTargets: async () => 0,
  saveObservation: m.save,
  discoverCandidates: async () => {},
  retainFailedObservation: m.retain,
  deferObservation: async () => {},
}));

import { runRelationBatch } from './worker.ts';

beforeEach(() => {
  vi.resetAllMocks();
  m.assert.mockResolvedValue(undefined);
  m.ingest.mockResolvedValue({ postId: 1, status: 'ok', changed: true, hash: null });
  m.stored.mockResolvedValueOnce(null).mockResolvedValue({ parsed: { truncated: false } });
});
function fixture() {
  const events: string[] = [];
  const c = {
    beginTransaction: async () => {
      events.push('begin');
    },
    commit: async () => {
      events.push('commit');
    },
    rollback: async () => {
      events.push('rollback');
    },
    release: () => {
      events.push('release');
    },
  };
  const pool = {
    getConnection: async () => c,
    query: async (sql: string) => [
      sql.includes('FROM posts') ? [{ id: 1, blog_id: 5, url: 'https://anise.tw/post', blog_url: 'https://anise.tw/' }] : [],
    ],
  };
  return { events, pool: pool as unknown as Pool };
}
describe('relations committed body adoption', () => {
  it('saveObservation failure retains committed body event and queue failure never becomes relation noteFailure', async () => {
    const f = fixture();
    m.save.mockRejectedValue(Error('save failed'));
    const enqueue = vi.fn(async (ids: readonly number[]) => {
      f.events.push('enqueue');
      return { acceptedPostIds: ids };
    });
    await runRelationBatch(f.pool, { indexAdoptionEnabled: true, enqueueIndex: enqueue });
    expect(f.events).toEqual(['begin', 'commit', 'release', 'enqueue']);
    expect(enqueue).toHaveBeenCalledWith([1]);
    expect(m.retain).toHaveBeenCalledTimes(1);
  });
  it('outer lease failure still flushes committed IDs from finally', async () => {
    const f = fixture();
    m.save.mockRejectedValue(Error('save failed'));
    m.assert.mockImplementation(async () => {
      if (m.save.mock.calls.length) throw Error('lease lost');
    });
    const enqueue = vi.fn(async (ids: readonly number[]) => ({ acceptedPostIds: ids }));
    await expect(runRelationBatch(f.pool, { indexAdoptionEnabled: true, enqueueIndex: enqueue })).rejects.toThrow('lease lost');
    expect(enqueue).toHaveBeenCalledWith([1]);
    expect(m.retain).not.toHaveBeenCalled();
  });
  it('queue failure after successful relation does not create relation failure', async () => {
    const f = fixture(),
      report = vi.fn();
    await runRelationBatch(f.pool, {
      indexAdoptionEnabled: true,
      enqueueIndex: async () => {
        throw Error('queue');
      },
      onIndexAdoptionReport: report,
    });
    expect(m.retain).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ state: 'needs-repair', pendingPostIds: [1] }));
    expect(f.events).not.toContain('rollback');
  });
});
