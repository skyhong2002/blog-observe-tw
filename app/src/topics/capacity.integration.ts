import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { activeTopicMatcher, clearTopicMatcherCache } from './batch.ts';
import { ACTIVE_TOPIC_LIMITS, digest, normalizeTerm, POLICY_VERSION, storedNormalizedLabel } from './policy.ts';
import { prepareStagedTopicPolicy, writeTopicPolicy } from './policy-store.ts';
import { SOURCE } from './snapshot-client.ts';

/** Run only against the isolated integration server. No production configuration is read. */
export async function runTopicCapacityIntegration(pool: Pool) {
  const port = (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port;
  assert.equal(port, 18169, 'clone-only capacity integration');
  const snapshotId = randomUUID(),
    windowId = randomUUID();
  const asOf = new Date('2037-03-09T00:00:00.000Z');
  const oldDate = '2020-01-01T00:00:00.000Z';
  const original = (await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]))[0][0]?.snapshot_id;
  const raw = Array.from({ length: 1004 }, (_, i) => ({
    id: String(i + 1).padStart(64, '0'),
    label: `容量${i}${'漢'.repeat(180)}`,
    payload: { articleCount: 3, lastPublishedAt: oldDate } as Record<string, unknown>,
  }));
  Object.assign(raw[0], { label: 'AI', payload: { articleCount: 2, lastPublishedAt: oldDate } });
  Object.assign(raw[700], { label: 'ai', payload: { articleCount: 1, lastPublishedAt: oldDate } });
  Object.assign(raw[1], { label: 'ResearchTopic', payload: { articleCount: 5, lastPublishedAt: oldDate } });
  Object.assign(raw[701], { label: 'researchtopic', payload: { articleCount: 1, lastPublishedAt: oldDate, noEqual: true } });
  Object.assign(raw[2], { label: '最近低頻', payload: { articleCount: 1, lastPublishedAt: asOf.toISOString() } });
  Object.assign(raw[3], { label: '未來低頻', payload: { articleCount: 1, lastPublishedAt: '2038-01-01T00:00:00.000Z' } });
  Object.assign(raw[4], { label: 'ﷺ'.repeat(20), payload: { articleCount: 3, lastPublishedAt: oldDate } });
  let oldPointerChanged = false;
  try {
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'staging',?)", [
      snapshotId,
      JSON.stringify({ id: snapshotId, generatedAt: asOf.toISOString(), coverage: 'all-current-indexed-article-tags', total: raw.length }),
      asOf,
    ]);
    for (let at = 0; at < raw.length; at += 100)
      await pool.query('INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload) VALUES ?', [
        raw.slice(at, at + 100).map((t) => [snapshotId, t.id, t.label, storedNormalizedLabel(t.label), JSON.stringify(t.payload)]),
      ]);
    await prepareStagedTopicPolicy(pool, snapshotId, async () => {}, { maxBatches: 1 });
    let calls = 0;
    await assert.rejects(
      () =>
        prepareStagedTopicPolicy(
          pool,
          snapshotId,
          async () => {
            if (++calls === 2) throw Error('fixture lost lease');
          },
          { maxBatches: 1 },
        ),
      /fixture lost lease/,
    );
    assert.equal(
      Number((await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_term_aliases_v3 WHERE snapshot_id=?', [snapshotId]))[0][0].n),
      0,
      'projection rollback must roll back aliases and cursor together',
    );
    let result = await prepareStagedTopicPolicy(pool, snapshotId, async () => {}, { maxBatches: 1 });
    assert.equal(
      Number((await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_term_aliases_v3 WHERE snapshot_id=?', [snapshotId]))[0][0].n),
      500,
    );
    for (let i = 0; result.status !== 'ready' && i < 30; i++)
      result = await prepareStagedTopicPolicy(pool, snapshotId, async () => {}, { maxBatches: 1 });
    assert.equal(result.status, 'ready');
    const [[ai]] = await pool.query<RowDataPacket[]>('SELECT * FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id=?', [
      snapshotId,
      digest('ai'),
    ]);
    assert.equal(Number(ai.occurrences), 3, 'cross-page aliases counted exactly once');
    assert.equal(Number(ai.article_count), 2, 'duplicate alias counts must not meet threshold');
    assert.equal(ai.label, 'AI');
    assert.equal(ai.inactive_reason, 'low-frequency');
    const [[noEqual]] = await pool.query<RowDataPacket[]>(
      'SELECT exclusion_reason FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id=?',
      [snapshotId, digest('researchtopic')],
    );
    assert.equal(noEqual.exclusion_reason, 'upstream-no-equal');
    const [[expanded]] = await pool.query<RowDataPacket[]>(
      'SELECT id,normalized_label,exclusion_reason FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id=?',
      [snapshotId, digest(normalizeTerm(raw[4].label))],
    );
    assert.equal(expanded.exclusion_reason, 'invalid-label');
    assert.equal([...expanded.normalized_label].length, 255);
    assert.notEqual(expanded.id, digest(expanded.normalized_label));
    const [[selection]] = await pool.query<RowDataPacket[]>('SELECT * FROM topic_policy_selections WHERE snapshot_id=?', [snapshotId]);
    const config = typeof selection.config === 'string' ? JSON.parse(selection.config) : selection.config;
    assert.equal(Number(selection.total_terms), raw.length - 2);
    assert.ok(config.inactiveReasons['memory-budget'] > 0);
    assert.equal(config.inactiveReasons['low-frequency'], 2);
    assert.equal(config.exclusionReasons['upstream-no-equal'], 1);
    assert.ok(Number(selection.code_points) <= ACTIVE_TOPIC_LIMITS.maxCodePoints);
    assert.ok(Number(selection.estimated_bytes) <= ACTIVE_TOPIC_LIMITS.maxEstimatedBytes);
    assert.equal(selection.policy_version, POLICY_VERSION);
    assert.equal(
      Number((await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_term_aliases_v3 WHERE snapshot_id=?', [snapshotId]))[0][0].n),
      raw.length,
    );
    const matcher = await activeTopicMatcher(pool, snapshotId);
    assert.equal(matcher.statistics.terms, Number(selection.active_terms));
    assert.ok(matcher.statistics.nodes <= Number(selection.code_points) + 1);
    assert.equal(
      (await prepareStagedTopicPolicy(pool, snapshotId, async () => {})).selectionId,
      result.selectionId,
      'ready resume is idempotent',
    );
    // A changed projection version resets only its unpublished derived tables in bounded batches.
    await pool.execute("UPDATE topic_policy_selections SET policy_version='old-fixture' WHERE snapshot_id=?", [snapshotId]);
    const rebuilt = await prepareStagedTopicPolicy(pool, snapshotId, async () => {}, { maxBatches: 40 });
    assert.equal(rebuilt.selectionId, result.selectionId, 'deterministic reset must not add occurrences twice');
    assert.equal(
      Number(
        (
          await pool.query<RowDataPacket[]>('SELECT occurrences FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id=?', [
            snapshotId,
            digest('ai'),
          ])
        )[0][0].occurrences,
      ),
      3,
    );
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, snapshotId],
    );
    oldPointerChanged = true;
    await assert.rejects(() => prepareStagedTopicPolicy(pool, snapshotId, async () => {}), /cannot rewrite current/);
    if (original) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [original, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    oldPointerChanged = false;
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'staging',?)", [
      windowId,
      JSON.stringify({
        id: windowId,
        generatedAt: asOf.toISOString(),
        coverage: 'observed-article-window',
        window: { until: asOf.toISOString() },
        total: 1,
      }),
      asOf,
    ]);
    await pool.execute('INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload) VALUES (?,?,?,?,?)', [
      windowId,
      digest('窗口低頻'),
      '窗口低頻',
      '窗口低頻',
      JSON.stringify({ articleCount: 1 }),
    ]);
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await writeTopicPolicy(c, windowId);
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
    const [[windowTerm]] = await pool.query<RowDataPacket[]>(
      'SELECT last_published_at,inactive_reason FROM topic_canonical_terms_v3 WHERE snapshot_id=?',
      [windowId],
    );
    assert.equal(windowTerm.inactive_reason, null);
    assert.equal(new Date(windowTerm.last_published_at).toISOString(), asOf.toISOString());
    const [[source]] = await pool.query<RowDataPacket[]>('SELECT payload FROM topic_terms WHERE snapshot_id=?', [windowId]);
    assert.deepEqual(typeof source.payload === 'string' ? JSON.parse(source.payload) : source.payload, { articleCount: 1 });
    return {
      rawTerms: raw.length,
      canonicalTerms: Number(selection.total_terms),
      activeTerms: Number(selection.active_terms),
      estimatedBytes: Number(selection.estimated_bytes),
      codePoints: Number(selection.code_points),
      maxNodes: matcher.statistics.nodes,
      projectionRollback: true,
      crossPageIdempotent: true,
      unchangedRawPayload: true,
      windowRecencyFallback: true,
      currentGuard: true,
    };
  } finally {
    clearTopicMatcherCache();
    if (oldPointerChanged) {
      if (original) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [original, SOURCE]);
      else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    }
    for (const table of ['topic_term_aliases_v3', 'topic_canonical_terms_v3', 'topic_policy_selections', 'topic_terms'])
      await pool.query(`DELETE FROM ${table} WHERE snapshot_id IN (?)`, [[snapshotId, windowId]]);
    await pool.query('DELETE FROM topic_snapshots WHERE id IN (?)', [[snapshotId, windowId]]);
  }
}
