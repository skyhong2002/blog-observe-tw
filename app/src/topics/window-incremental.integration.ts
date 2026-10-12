import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SOURCE } from './snapshot-client.ts';
import { syncVocabulary } from './sync.ts';
import type { SourceArticle } from './window-contract.ts';
import { cleanupWindowCache, startWindowRun } from './window-incremental.ts';

export async function runWindowIncrementalIntegration(pool: Pool) {
  assert.equal((pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port, 18169);
  const [[original]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const ids: string[] = [];
  const base = new Date('2038-01-12T12:00:00.000Z'),
    next = new Date(base.getTime() + 15 * 60_000),
    third = new Date(next.getTime() + 15 * 60_000);
  const article = (id: string, at: number, tags: string[]): SourceArticle => ({
    id,
    media: 'fixture',
    publishedAt: new Date(at).toISOString(),
    tags,
  });
  const old = article('910001', base.getTime() - 12 * 3600_000, ['保留主題']);
  const edited = article('910002', base.getTime() - 20 * 60_000, ['重疊詞', '舊標籤']);
  const expired = article('910003', base.getTime() - 23 * 3600_000 - 55 * 60_000, ['過期話題']);
  const source = { page: async () => ({ articles: [edited, old, expired], nextCursor: null }) };
  const payload = async (snapshot: string, label: string) => {
    const [[row]] = await pool.query<RowDataPacket[]>('SELECT payload FROM topic_terms WHERE snapshot_id=? AND label=?', [snapshot, label]);
    return row ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload) : null;
  };
  try {
    const baseline = await syncVocabulary(pool, {
      enabled: true,
      window: { since: new Date(base.getTime() - 86400_000).toISOString(), until: base.toISOString() },
      source,
      now: () => base,
    });
    assert.equal(baseline.status, 'published');
    const baseId = 'version' in baseline ? String(baseline.version) : '';
    ids.push(baseId);
    // Mimic pre-migration cache metadata; it is backfilled locally without source HTTP calls.
    await pool.execute('UPDATE topic_window_articles SET published_at=NULL WHERE run_id=?', [baseId]);
    const nextId = randomUUID();
    ids.push(nextId);
    const plan = await startWindowRun(pool, nextId, next, async () => {});
    assert.equal(plan.strategy, 'incremental-overlap');
    assert.equal(plan.window.since, '2038-01-12T11:00:00.000Z');
    const late = article('910004', base.getTime() - 45 * 60_000, ['晚到詞']);
    const fresh = article('910005', base.getTime() + 10 * 60_000, ['新詞']);
    const updated = { ...edited, tags: ['重疊詞', '新標籤'] };
    const incremental = await syncVocabulary(pool, {
      enabled: true,
      now: () => next,
      source: {
        page: async (window) => {
          assert.deepEqual(window, plan.window);
          return { articles: [fresh, updated, late], nextCursor: null };
        },
      },
    });
    assert.equal(incremental.status, 'published', JSON.stringify(incremental));
    assert.equal((await payload(nextId, '重疊詞')).articleCount, 1);
    assert.equal((await payload(nextId, '保留主題')).articleCount, 1);
    assert.equal((await payload(nextId, '晚到詞')).articleCount, 1);
    assert.equal((await payload(nextId, '新詞')).articleCount, 1);
    assert.equal(await payload(nextId, '舊標籤'), null);
    assert.equal(await payload(nextId, '過期話題'), null);
    const [[active]] = await pool.query<RowDataPacket[]>(
      'SELECT inactive_reason,exclusion_reason FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND label=?',
      [nextId, '新詞'],
    );
    assert.equal(active.inactive_reason, null);
    assert.equal(active.exclusion_reason, null);
    const [[snapshot]] = await pool.query<RowDataPacket[]>('SELECT manifest FROM topic_snapshots WHERE id=?', [nextId]);
    const manifest = typeof snapshot.manifest === 'string' ? JSON.parse(snapshot.manifest) : snapshot.manifest;
    assert.equal(manifest.window.since, '2038-01-11T12:15:00.000Z');
    assert.equal(manifest.sourceWindow.since, '2038-01-12T11:00:00.000Z');
    assert.equal(manifest.parentVersion, baseId);
    assert.equal(manifest.syncStrategy, 'incremental-overlap');
    assert.equal(manifest.lookbackSeconds, 3600);
    const thirdId = randomUUID();
    ids.push(thirdId);
    await startWindowRun(pool, thirdId, third, async () => {});
    await assert.rejects(
      syncVocabulary(pool, {
        enabled: true,
        now: () => third,
        source: {
          page: async () => {
            throw Error('fixture unavailable');
          },
        },
      }),
      /fixture unavailable/,
    );
    const [[current]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
    assert.equal(current.snapshot_id, nextId);
    let cleanupChecks = 0;
    await assert.rejects(
      cleanupWindowCache(pool, async () => {
        if (++cleanupChecks === 2) throw Error('cleanup lease lost');
      }),
      /cleanup lease lost/,
    );
    const [[atomicMarker]] = await pool.query<RowDataPacket[]>('SELECT sync_strategy FROM topic_window_runs WHERE id=?', [baseId]);
    assert.equal(atomicMarker.sync_strategy, 'full-window', 'failed cleanup rolls back the retirement marker');
    const [[atomicCache]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_window_articles WHERE run_id=?', [baseId]);
    assert.equal(Number(atomicCache.n), 3, 'failed cleanup rolls back deletions too');
    await cleanupWindowCache(pool, async () => {});
    const [[cache]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_window_articles WHERE run_id=?', [nextId]);
    assert.ok(Number(cache.n) > 0, 'active parent and current cache protected');
    const resumed = await syncVocabulary(pool, {
      enabled: true,
      now: () => third,
      source: { page: async () => ({ articles: [fresh, updated, late], nextCursor: null }) },
    });
    assert.equal(resumed.status, 'published');
    assert.equal((await payload(thirdId, '重疊詞')).articleCount, 1);
    assert.equal((await payload(thirdId, '保留主題')).articleCount, 1);
    const cleanup = await cleanupWindowCache(pool, async () => {});
    assert.ok(cleanup.deleted > 0);
    const [[oldCache]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_window_articles WHERE run_id IN (?,?)', [
      baseId,
      nextId,
    ]);
    assert.equal(Number(oldCache.n), 0);
    assert.ok(await payload(baseId, '保留主題'), 'cleanup preserves source vocabulary and published snapshots');
    const [[retiredCache]] = await pool.query<RowDataPacket[]>('SELECT sync_strategy FROM topic_window_runs WHERE id=?', [nextId]);
    assert.equal(retiredCache.sync_strategy, 'cache-retired');
    // A legitimate pointer rollback still has its raw vocabulary, but its reclaimed article cache
    // must trigger a new full baseline instead of silently publishing just one hour of articles.
    await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [nextId, SOURCE]);
    const rollbackRun = randomUUID();
    ids.push(rollbackRun);
    const rollbackTime = new Date(third.getTime() + 15 * 60_000);
    const rollbackPlan = await startWindowRun(pool, rollbackRun, rollbackTime, async () => {});
    assert.equal(rollbackPlan.strategy, 'full-window');
    assert.equal(rollbackPlan.parentVersion, null);
    assert.equal(rollbackPlan.window.since, new Date(rollbackTime.getTime() - 86400_000).toISOString());
    const [[retainedPointer]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
    assert.equal(retainedPointer.snapshot_id, nextId, 'full baseline remains staged and keeps the rolled-back last-good pointer');

    return {
      overlapDeduplicated: true,
      rollingDayRetained: true,
      lateHourObserved: true,
      editedPayloadReplaced: true,
      singleRecentTermActive: true,
      failureRetainsLastGood: true,
      resume: true,
      cacheReclaimed: true,
      rawVocabularyPreserved: true,
      rollbackRebuildsFullBaseline: true,
      cacheRetirementAtomic: true,
    };
  } finally {
    if (original) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [original.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    for (const table of ['topic_policy_selections', 'topic_term_aliases_v3', 'topic_canonical_terms_v3', 'topic_terms'])
      if (ids.length) await pool.query(`DELETE FROM ${table} WHERE snapshot_id IN (?)`, [ids]);
    if (ids.length) {
      await pool.query('DELETE FROM topic_window_articles WHERE run_id IN (?)', [ids]);
      await pool.query('DELETE FROM topic_window_runs WHERE id IN (?)', [ids]);
      await pool.query('DELETE FROM topic_snapshots WHERE id IN (?)', [ids]);
    }
    await pool.execute("DELETE FROM work_budgets WHERE day=? AND scope LIKE 'topics:%'", [base.toISOString().slice(0, 10)]);
  }
}
