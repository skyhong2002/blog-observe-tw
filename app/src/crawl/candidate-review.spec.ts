import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./candidate-validation.ts', () => ({ CANDIDATE_POLICY: 'test', validateCandidate: vi.fn() }));
vi.mock('./candidate-promotion.ts', () => ({ recordCandidateCheck: vi.fn() }));

import { recordCandidateCheck } from './candidate-promotion.ts';
import { runCandidateReviewBatch } from './candidate-review.ts';
import { validateCandidate } from './candidate-validation.ts';

function harness() {
  let held = 1;
  let failRelease = false;
  const c = {
    query: vi.fn(async (sql: string) =>
      sql.includes('GET_LOCK')
        ? [[{ held: 1 }]]
        : sql.includes('IS_USED_LOCK')
          ? [[{ held }]]
          : sql.includes('RELEASE_LOCK')
            ? failRelease
              ? Promise.reject(Error('connection lost'))
              : [[{ released: 1 }]]
            : [[{ id: 1, url: 'https://writer.test', name: 'Writer', status: 'candidate' }]],
    ),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  const pool = { pool: { config: { connectionLimit: 2 } }, getConnection: vi.fn(async () => c) } as unknown as Pool;
  return {
    c,
    pool,
    lose: () => {
      held = 0;
    },
    failRelease: () => {
      failRelease = true;
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateCandidate).mockResolvedValue({
    policy: 'test',
    id: 1,
    inputUrl: 'https://writer.test',
    checkedAt: new Date().toISOString(),
    eligible: false,
    reason: 'test',
  });
  vi.mocked(recordCandidateCheck).mockResolvedValue({ status: 'candidate' });
});
describe('resumable candidate review batch', () => {
  it('dry-run never writes a weekly checkpoint or approval', async () => {
    const h = harness();
    const result = await runCandidateReviewBatch(h.pool);
    expect(result.results[0]).toMatchObject({ status: 'dry-run' });
    expect(recordCandidateCheck).not.toHaveBeenCalled();
    expect(h.c.release).toHaveBeenCalledOnce();
  });
  it('an operator re-review selects only the given candidates, skipping the queue but not the exclusions', async () => {
    const h = harness();
    await runCandidateReviewBatch(h.pool, { ids: [20, 31, -1] });
    const [sql, params] = (h.c.query.mock.calls as unknown as [string, unknown][]).find(([q]) => q.includes('FROM discovery_candidates'))!;
    expect(sql).toContain('d.id IN (?)');
    expect(sql).toContain("status='candidate'");
    expect(sql).toContain("a.source_type IN ('manual','human-review','admin')");
    expect(sql).not.toContain('automaticReview.policy');
    expect(params).toEqual([[20, 31], 25]);
  });
  it('checks lease again after a slow network request, before any write', async () => {
    const h = harness();
    vi.mocked(validateCandidate).mockImplementation(async () => {
      h.lose();
      return {
        policy: 'test',
        id: 1,
        inputUrl: 'https://writer.test',
        checkedAt: new Date().toISOString(),
        eligible: true,
        reason: 'test',
      };
    });
    await expect(runCandidateReviewBatch(h.pool, { apply: true })).rejects.toThrow('lease lost');
    expect(recordCandidateCheck).not.toHaveBeenCalled();
  });
  it('destroys a connection when releasing its named lock fails', async () => {
    const h = harness();
    h.failRelease();
    await expect(runCandidateReviewBatch(h.pool)).rejects.toThrow('connection lost');
    expect(h.c.destroy).toHaveBeenCalledOnce();
    expect(h.c.release).not.toHaveBeenCalled();
  });
  it('retries only transient SQL lock errors with a fresh writer transaction', async () => {
    const h = harness();
    vi.mocked(recordCandidateCheck)
      .mockRejectedValueOnce(Object.assign(Error('deadlock'), { code: 'ER_LOCK_DEADLOCK' }))
      .mockResolvedValue({ status: 'candidate' });
    const result = await runCandidateReviewBatch(h.pool, { apply: true });
    expect(result.results[0]).toMatchObject({ status: 'candidate' });
    expect(recordCandidateCheck).toHaveBeenCalledTimes(2);
  });
  it('reports a failed write for future retry without claiming approval', async () => {
    const h = harness();
    vi.mocked(recordCandidateCheck).mockRejectedValue(Error('db unavailable'));
    const result = await runCandidateReviewBatch(h.pool, { apply: true });
    expect(result.results[0]).toMatchObject({ status: 'write-failed' });
    expect(recordCandidateCheck).toHaveBeenCalledOnce();
  });
  it('rejects a pool that could deadlock while holding its lease', async () => {
    const h = harness();
    (h.pool as unknown as { pool: { config: { connectionLimit: number } } }).pool.config.connectionLimit = 1;
    await expect(runCandidateReviewBatch(h.pool)).rejects.toThrow('poolSize');
    expect(h.pool.getConnection).not.toHaveBeenCalled();
  });
});
