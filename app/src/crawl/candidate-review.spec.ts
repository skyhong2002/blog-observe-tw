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
  it('an operator re-review spends its own daily total, still within the per-host limit', async () => {
    const scopes: string[] = [];
    vi.mocked(validateCandidate).mockImplementation(async (_row, options) => {
      await options?.fetcher?.('https://writer.test/');
      return {
        policy: 'test',
        id: 1,
        inputUrl: 'https://writer.test',
        checkedAt: new Date().toISOString(),
        eligible: false,
        reason: 'test',
      };
    });
    const budget = await import('../jobs/budget.ts');
    const reserve = vi.spyOn(budget, 'reserveBudget').mockImplementation(async (_pool, [r]) => {
      scopes.push(`${r.scope.replace(/:[0-9a-f]{64}$/, ':<host>')}/${r.limit}`);
      return true;
    });
    const fetcher = vi.fn(async () => new Response(''));
    await runCandidateReviewBatch(harness().pool, { apply: true, ids: [1], fetcher });
    await runCandidateReviewBatch(harness().pool, { apply: true, fetcher });
    expect(scopes).toEqual(['candidates:host:<host>/40', 'candidates:operator/200', 'candidates:host:<host>/40', 'candidates:http/1500']);
    reserve.mockRestore();
  });
  it('a candidate stopped by a spent per-host budget is queued again once the budget resets (next UTC day)', async () => {
    const h = harness();
    await runCandidateReviewBatch(h.pool);
    const [sql, params] = (h.c.query.mock.calls as unknown as [string, unknown[]][]).find(([q]) =>
      q.includes('FROM discovery_candidates'),
    )!;
    expect(sql).toContain("automaticReview.reason')) IN ('candidate_host_budget_exhausted','daily_admission_budget_exhausted') AND");
    expect(params[2]).toBe(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    expect(params).toHaveLength(4);
    // A robots-held candidate comes back as soon as a later read of its host's robots.txt is open.
    expect(sql).toMatch(/IN \('robots_disallowed','robots_unreachable'\)\s+AND EXISTS\(SELECT 1 FROM robots_observations r/);
    expect(sql).toContain("r.outcome IN ('allowed','missing','partial')");
    // A crawl that does not obey robots.txt takes every robots-held candidate back at once.
    vi.stubEnv('BLOG_CRAWL_OBEY_ROBOTS', 'false');
    try {
      const off = harness();
      await runCandidateReviewBatch(off.pool);
      const [offSql] = (off.c.query.mock.calls as unknown as [string, unknown[]][]).find(([q]) => q.includes('FROM discovery_candidates'))!;
      expect(offSql).toMatch(/IN \('robots_disallowed','robots_unreachable'\)\s+AND TRUE\)/);
    } finally {
      vi.unstubAllEnvs();
    }
    // BlogBlog.Club- and IndieWeb-listed homes and readers' suggestions are reviewed first: the directory is the
    // collection's priority, and a reader is waiting on a suggestion.
    expect(sql).toMatch(
      /ORDER BY JSON_EXTRACT\(source_evidence,'\$\.directoryListing'\) IS NULL AND JSON_EXTRACT\(source_evidence,'\$\.indiewebListing'\) IS NULL\s+AND source_type<>'reader-suggestion',\s*COALESCE/,
    );
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
