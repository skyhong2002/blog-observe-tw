import type { Pool } from 'mysql2/promise';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reserve = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true));
vi.mock('../jobs/budget.ts', () => ({ reserveBudget: reserve }));

import { interleaveTasks } from './batch.ts';
import { infer } from './service.ts';

const answer = {
  classification: 'personal' as const,
  confidence: 0.99,
  quotedEvidence: ['my personal blog'],
  bio: '個人筆記',
  topics: ['生活'],
};
function database(row: Record<string, unknown> = {}, override: unknown = null) {
  const state = { id: 1, status: 'pending', attempts: 0, next_attempt_at: null, ...row };
  const execute = vi.fn(async (sql: string) => [{ affectedRows: sql.includes('claim_token') && row.lostClaim ? 0 : 1 }]);
  const query = vi.fn(async (sql: string) => [sql.includes('ai_overrides') ? (override ? [{ result_json: override }] : []) : [state]]);
  return { pool: { execute, query } as unknown as Pool, execute, query };
}
describe('durable inference cache and retry', () => {
  beforeEach(() => reserve.mockReset().mockResolvedValue(true));
  it('cache hit consumes no daily budget or gateway request', async () => {
    const db = database({ status: 'ok', result_json: answer, actual_model: 'resolved' });
    const gateway = vi.fn();
    expect((await infer(db.pool, 'profile', 'blog', 1, 'my personal blog', 'rss-summary', { gateway })).status).toBe('ok');
    expect(reserve).not.toHaveBeenCalled();
    expect(gateway).not.toHaveBeenCalled();
  });
  it('manual override takes precedence before even creating a cache row', async () => {
    const db = database({}, answer);
    expect((await infer(db.pool, 'profile', 'blog', 1, 'input', 'rss-summary')).overridden).toBe(true);
    expect(db.execute).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });
  it('retry delay and max attempts prevent busy-loop requests', async () => {
    for (const row of [{ attempts: 3 }, { next_attempt_at: new Date('2099-01-01') }]) {
      const db = database(row);
      expect((await infer(db.pool, 'topics', 'post', 1, 'input', 'rss-summary')).status).toBe('deferred');
    }
    expect(reserve).not.toHaveBeenCalled();
  });
  it('reserves full request byte upper bound before gateway and fences writes', async () => {
    const db = database();
    const gateway = vi.fn(async () => ({ result: answer, actualModel: 'resolved' }));
    expect((await infer(db.pool, 'profile', 'blog', 1, 'my personal blog', 'rss-summary', { gateway })).status).toBe('ok');
    expect(reserve.mock.calls[0][1]).toMatchObject([
      { scope: 'ai:attempts', amount: 1, limit: 10 },
      { scope: 'ai:task:profile', amount: 1, limit: 2 },
      { scope: 'ai:tokens', limit: 80000 },
    ]);
    expect(db.execute.mock.calls.some(([sql]) => sql.includes("status='ok'") && sql.includes('claim_token=?'))).toBe(true);
    expect(gateway).toHaveBeenCalledOnce();
  });
  it('daily exhaustion does not call gateway; failure schedules sanitized retry', async () => {
    const db = database();
    reserve.mockResolvedValue(false);
    const gateway = vi.fn();
    expect((await infer(db.pool, 'profile', 'blog', 1, 'input', 'rss-summary', { gateway })).status).toBe('deferred');
    expect(gateway).not.toHaveBeenCalled();
    reserve.mockResolvedValue(true);
    const failure = vi.fn(async () => {
      throw Error('Bearer secret');
    });
    expect((await infer(database().pool, 'profile', 'blog', 1, 'input', 'rss-summary', { gateway: failure })).status).toBe('failed');
  });
  it('interleaves profiles and articles and lets remaining task run after another budget is exhausted', () => {
    expect(interleaveTasks(['b1', 'b2'], ['p100', 'p101'], 3)).toEqual(['b1', 'p100', 'b2']);
    expect(interleaveTasks([], ['p100', 'p101'], 3)).toEqual(['p100', 'p101']);
  });
});

it('rechecks ownership evidence in injected provider results and cached classification', async () => {
  const input = JSON.stringify(['Site description:']);
  const spoof = { ...answer, quotedEvidence: ['Site description:'] };
  for (const cached of [false, true]) {
    const db = database(cached ? { status: 'ok', result_json: spoof, actual_model: 'fixture' } : {});
    const gateway = vi.fn(async () => ({ result: spoof, actualModel: 'fixture' }));
    const inferred = await infer(db.pool, 'classification', 'candidate', 1, input, 'site-identity', { gateway });
    expect(inferred.result?.classification).toBe('uncertain');
  }
});
