import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { recordCandidateCheck } from './candidate-promotion.ts';
import { CANDIDATE_POLICY, type CandidateCheck } from './candidate-validation.ts';

const checked = (): CandidateCheck => ({
  policy: CANDIDATE_POLICY,
  id: 1,
  inputUrl: 'https://writer.test/',
  checkedAt: new Date().toISOString(),
  eligible: false,
  reason: 'no_verified_feed_or_sitemap',
});
describe('candidate writer entry guards', () => {
  it('dry-run cannot acquire a SQL connection or persist a weekly review gate', async () => {
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    expect(await recordCandidateCheck(pool, checked(), false)).toMatchObject({ status: 'dry-run' });
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('rejects stale evidence before acquiring a writer connection', async () => {
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    await expect(recordCandidateCheck(pool, { ...checked(), checkedAt: '2001-01-01T00:00:00Z' }, true)).rejects.toThrow('fresh');
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('rejects oversized evidence before taking a SQL lock', async () => {
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    await expect(recordCandidateCheck(pool, { ...checked(), reason: 'x'.repeat(130 * 1024) }, true)).rejects.toThrow('limit');
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
  it('invalid depth and missing personal proof become audited declines, never endless throws', async () => {
    for (const evidence of [{ discoveryDepth: 9 }, { discoveryDepth: 1 }]) {
      const c = {
        query: vi.fn(async (sql: string) =>
          sql.includes('GET_LOCK')
            ? [[{ held: 1 }]]
            : sql.includes('RELEASE_LOCK')
              ? [[{ released: 1 }]]
              : sql.includes('FROM discovery_candidates')
                ? [
                    [
                      {
                        id: 1,
                        url: 'https://writer.test/',
                        name: 'Writer',
                        status: 'candidate',
                        source_type: 'blogroll',
                        source_evidence: evidence,
                      },
                    ],
                  ]
                : [[]],
        ),
        execute: vi.fn(async (_sql: string) => [{ affectedRows: 1 }]),
        beginTransaction: vi.fn(),
        commit: vi.fn(),
        rollback: vi.fn(),
        release: vi.fn(),
        destroy: vi.fn(),
      };
      const pool = { getConnection: vi.fn(async () => c) } as unknown as Pool;
      const result = await recordCandidateCheck(pool, { ...checked(), eligible: true }, true);
      expect(result.status).toBe('candidate');
      expect(['discovery_depth_invalid', 'personal_publication_unverified']).toContain(result.reason);
      expect(c.commit).toHaveBeenCalledOnce();
      expect(c.execute.mock.calls.some(([sql]) => sql.includes('discovery_candidate_audits'))).toBe(true);
    }
  });
});
