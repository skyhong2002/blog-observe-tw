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
});
