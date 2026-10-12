import { assertEphemeralDatabase } from './guard.mjs';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { reserveBudget } from '../../app/src/jobs/budget.ts';
import { withJobLease } from '../../app/src/jobs/lease.ts';
import { infer } from '../../app/src/ai/service.ts';
import { registerAiRoutes } from '../../app/src/ai/routes.ts';
import { registerRelationRoutes } from '../../app/src/relations/routes.ts';
import { registerTopicRoutes } from '../../app/src/topics/routes.ts';
export async function runCoreIntegration(pool) {
  assertEphemeralDatabase(pool);
  assert.equal(pool.pool.config.connectionConfig.port, 18169);
  assert.equal(new URL(process.env.BLOG_DB_URL).port, '18169');
  const result = {};
  const now = new Date('2039-01-01T23:59:59Z');
  try {
    await pool.query('DELETE FROM ai_results WHERE entity_id=999999');
    await pool.query('DELETE FROM ai_overrides WHERE entity_id=999999');
    await pool.query("DELETE FROM work_budgets WHERE scope LIKE 'test:%' OR scope LIKE 'ai:%'");
    const reservations = await Promise.all(
      Array.from({ length: 20 }, () => reserveBudget(pool, [{ scope: 'test:parallel', amount: 1, limit: 7 }], now)),
    );
    assert.equal(reservations.filter(Boolean).length, 7);
    assert.equal(
      await reserveBudget(
        pool,
        [
          { scope: 'test:atomic-a', amount: 2, limit: 10 },
          { scope: 'test:parallel', amount: 1, limit: 7 },
        ],
        now,
      ),
      false,
    );
    const [[counter]] = await pool.query("SELECT COUNT(*) n FROM work_budgets WHERE scope='test:atomic-a'");
    assert.equal(counter.n, 0);
    assert.equal(await reserveBudget(pool, [{ scope: 'test:parallel', amount: 1, limit: 7 }], new Date('2039-01-02T00:00:00Z')), true);
    let nested;
    await withJobLease(pool, 'test-lease', async (check) => {
      await check();
      nested = await withJobLease(pool, 'test-lease', async () => 1);
    });
    assert.equal(nested, null);
    result.budgets = { parallel: 20, accepted: 7, atomicRollback: true, utcMidnight: true, exclusiveLease: true };
    let calls = 0;
    const model = {
      classification: 'personal',
      confidence: 0.99,
      quotedEvidence: ['我是測試作者,這是我的個人部落格。'],
      bio: '測試作者的個人部落格',
      topics: ['生活'],
    };
    const opt = {
      gateway: async () => {
        calls++;
        return { result: model, actualModel: 'fixture' };
      },
    };
    const args = [pool, 'profile', 'blog', 999999, '我是測試作者,這是我的個人部落格。', 'fixture', opt];
    assert.equal((await infer(...args)).status, 'ok');
    assert.equal((await infer(...args)).status, 'ok');
    assert.equal(calls, 1);
    const [[usage]] = await pool.query("SELECT used FROM work_budgets WHERE scope='ai:attempts' AND day=UTC_DATE()");
    assert.equal(usage.used, 1);
    await pool.execute(
      "INSERT INTO ai_overrides(entity_type,entity_id,task,result_json,actor,note,updated_at) VALUES ('blog',999999,'profile',?,'test','fixture',UTC_TIMESTAMP())",
      [JSON.stringify({ ...model, bio: '人工內容' })],
    );
    const overridden = await infer(...args);
    assert.equal(overridden.result.bio, '人工內容');
    assert.equal(calls, 1);
    result.ai = { cacheHitUncharged: true, manualOverride: true };
    const app = Fastify();
    registerAiRoutes(app, pool);
    await registerRelationRoutes(app, pool);
    registerTopicRoutes(app, pool);
    for (const path of ['/api/relations', '/api/topics']) {
      const r = await app.inject(path);
      assert.equal(r.statusCode, 200, r.body.slice(0, 200));
    }
    for (const path of ['/api/relations?days=1', '/api/topics?days=31']) assert.equal((await app.inject(path)).statusCode, 400);
    result.routes = 'valid200-invalid400';
    await app.close();
    const [[counts]] = await pool.query(
      'SELECT (SELECT COUNT(*) FROM blogs) blogs,(SELECT COUNT(*) FROM posts) posts,(SELECT COUNT(*) FROM seed_records) seedRecords',
    );
    result.restored = counts;
    await pool.query('DELETE FROM ai_results WHERE entity_id=999999');
    await pool.query('DELETE FROM ai_overrides WHERE entity_id=999999');
    await pool.query("DELETE FROM work_budgets WHERE scope LIKE 'test:%' OR scope LIKE 'ai:%'");
    return result;
  } finally {
    await pool.query('DELETE FROM ai_results WHERE entity_id=999999');
    await pool.query('DELETE FROM ai_overrides WHERE entity_id=999999');
    await pool.query("DELETE FROM work_budgets WHERE scope LIKE 'test:%' OR scope LIKE 'ai:%'");
  }
}
