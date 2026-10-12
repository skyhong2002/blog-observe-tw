import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { backfillTopicHistory } from './history-backfill.ts';
import { applyHistoryObservations, type HistoryObservation, recordTopicHistory } from './history-store.ts';
import { revalidateTopicHistory } from './history-worker.ts';
import { digest, MATCHER_VERSION, normalizeTerm, POLICY_VERSION } from './policy.ts';
import { SOURCE } from './snapshot-client.ts';

export async function runTopicHistoryIntegration(pool: Pool) {
  assert.equal(
    (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port,
    18169,
    'clone-only history integration',
  );
  const first = randomUUID(),
    second = randomUUID(),
    duplicate = randomUUID(),
    time = new Date('2058-08-01T00:00:00Z');
  const after = (seconds: number) => new Date(time.getTime() + seconds * 1000);
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const terms = ['拍照', 'Inside', '預告片'].map((label) => ({
    id: digest(normalizeTerm(`${label}${first}`)),
    label: `${label}${first}`,
    normalized: normalizeTerm(`${label}${first}`),
  }));
  const posts: number[] = [];
  let blogId = 0;
  const transaction = async (f: (c: PoolConnection) => Promise<unknown>) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await f(c);
      await c.commit();
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  };
  const rows = async () =>
    (
      await pool.query<RowDataPacket[]>('SELECT * FROM topic_article_evidence WHERE canonical_id IN (?) ORDER BY canonical_id,source', [
        terms.map((t) => t.id),
      ])
    )[0];
  const evidence = async (term: number, source: string) =>
    (await rows()).find((r) => r.canonical_id === terms[term].id && r.source === source)!;
  const observation = (
    term: number,
    source: 'title' | 'body',
    state: 'confirmed' | 'pending' | 'revoked',
    checkedAt: Date,
  ): HistoryObservation => ({
    termId: terms[term].id,
    label: terms[term].label,
    normalizedLabel: terms[term].normalized,
    snapshotId: first,
    postId: posts[0],
    source,
    state,
    reason: state === 'revoked' ? 'no-longer-matches' : null,
    postHash: digest('post'),
    bodyHash: digest('old-body'),
    matcherVersion: MATCHER_VERSION,
    observedAt: time,
    checkedAt,
    publishedAt: time,
  });
  try {
    for (const id of [first, second, duplicate])
      await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'published',?)", [id, '{}', time]);
    for (const t of terms)
      await pool.execute('INSERT INTO topic_canonical_terms_v3(snapshot_id,id,label,normalized_label,policy_version) VALUES (?,?,?,?,?)', [
        first,
        t.id,
        t.label,
        t.normalized,
        POLICY_VERSION,
      ]);
    const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)", [
      `history-${first}`,
      '歷史測試',
      'https://history.example/',
      time,
    ]);
    blogId = b.insertId;
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at) VALUES (?,?,?,?,?,?,?)',
      [blogId, first, `https://history.example/${first}`, terms[0].label, digest('post'), time, time],
    );
    posts.push(p.insertId);
    await pool.execute(
      "INSERT INTO relation_observations(post_id,blog_id,body_text,content_hash,status,parser_version,observed_at,next_attempt_at) VALUES (?,?,?,?,'ok','fixture',?,?)",
      [posts[0], blogId, terms[1].label, digest('new-body'), time, time],
    );
    await pool.execute(
      "INSERT INTO topic_post_indexes_v3(post_id,snapshot_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind) VALUES (?,?,?,?,?,?,'ok',?,'fixture','legacy-text')",
      [posts[0], first, digest('input'), digest('post'), digest('old-body'), time, MATCHER_VERSION],
    );
    for (const [term, source] of [
      [0, 'title'],
      [1, 'body'],
      [2, 'body'],
    ] as const)
      await pool.execute('INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) VALUES (?,?,?,?)', [
        first,
        posts[0],
        terms[term].id,
        source,
      ]);
    const imported = await backfillTopicHistory(pool, { enabled: true, snapshotId: first, limit: 1, now: () => after(1) });
    assert.equal(imported.processed, 3);
    assert.deepEqual(imported.completedSnapshots, [first]);
    assert.equal((await evidence(0, 'title')).state, 'pending', 'stale hashes are observations, not revocations');
    assert.equal(
      (await backfillTopicHistory(pool, { enabled: true, snapshotId: first })).processed,
      0,
      'checkpoint makes repeated backfill idempotent',
    );
    assert.equal((await rows()).length, 3);
    // Current source window is empty. Dedicated historical matcher still covers all historical terms.
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, second],
    );
    const verified = await revalidateTopicHistory(pool, { enabled: true, postIds: posts, now: () => after(2) });
    assert.equal(verified.processed, 1);
    assert.equal((await evidence(0, 'title')).state, 'confirmed');
    assert.equal((await evidence(1, 'body')).state, 'confirmed', 'historical term survives missing current vocabulary');
    assert.equal((await evidence(2, 'body')).state, 'revoked', 'complete historical matcher can prove a real negative');
    // A retiring carried generation has identical observations; skip them in SQL, including newer revocations.
    await pool.execute("UPDATE topic_snapshots SET status='retiring' WHERE id=?", [duplicate]);
    await pool.execute(
      'INSERT INTO topic_canonical_terms_v3(snapshot_id,id,label,normalized_label,policy_version) SELECT ?,id,label,normalized_label,policy_version FROM topic_canonical_terms_v3 WHERE snapshot_id=?',
      [duplicate, first],
    );
    await pool.execute(
      'INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) SELECT ?,post_id,term_id,source FROM topic_matches_v3 WHERE snapshot_id=?',
      [duplicate, first],
    );
    await pool.execute(
      'INSERT INTO topic_post_indexes_v3(snapshot_id,post_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind) SELECT ?,post_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind FROM topic_post_indexes_v3 WHERE snapshot_id=?',
      [duplicate, first],
    );
    const replay = await backfillTopicHistory(pool, { enabled: true, snapshotId: duplicate, now: () => after(3) });
    assert.equal(replay.processed, 0);
    assert.equal(replay.written, 0);
    assert.deepEqual(replay.completedSnapshots, [duplicate]);
    const [[retiringCheckpoint]] = await pool.query<RowDataPacket[]>('SELECT `cursor` FROM topic_history_backfill_runs WHERE id=?', [
      `snapshot:${duplicate}`,
    ]);
    assert.match(JSON.stringify(retiringCheckpoint.cursor), /retained-evidence-only/);
    assert.equal((await evidence(2, 'body')).state, 'revoked');
    await Promise.all([
      transaction((c) => applyHistoryObservations(c, [observation(2, 'body', 'confirmed', after(3))], async () => {})),
      transaction((c) => applyHistoryObservations(c, [observation(2, 'body', 'revoked', after(4))], async () => {})),
    ]);
    assert.equal((await evidence(2, 'body')).state, 'revoked', 'concurrent writers converge by checkedAt');
    await transaction((c) =>
      applyHistoryObservations(c, [{ ...observation(2, 'body', 'confirmed', after(-1)), observedAt: after(-1) }], async () => {}),
    );
    assert.equal((await evidence(2, 'body')).state, 'revoked');
    assert.equal(
      new Date((await evidence(2, 'body')).first_observed_at).getTime(),
      after(-1).getTime(),
      'older provenance retained without resurrection',
    );

    // A newer negative must survive arbitrary old snapshot replays, including same-second positive.
    await transaction((c) =>
      applyHistoryObservations(
        c,
        [observation(2, 'body', 'confirmed', time), observation(2, 'body', 'confirmed', after(2))],
        async () => {},
      ),
    );
    assert.equal((await evidence(2, 'body')).state, 'revoked');
    // A truncated parser result is not a complete negative even when its short excerpt has no hit.
    await pool.execute('UPDATE relation_observations SET body_text=?,content_hash=?,truncated=1 WHERE post_id=?', [
      '不相關的摘要',
      digest('truncated-body'),
      posts[0],
    ]);
    await revalidateTopicHistory(pool, { enabled: true, postIds: posts, now: () => after(5) });
    assert.equal((await evidence(1, 'body')).state, 'pending');
    assert.equal((await evidence(1, 'body')).reason, 'incomplete-body');
    await pool.execute('UPDATE relation_observations SET body_text=?,content_hash=?,truncated=0 WHERE post_id=?', [
      terms[1].label,
      digest('new-body'),
      posts[0],
    ]);
    await revalidateTopicHistory(pool, { enabled: true, postIds: posts, now: () => after(6) });
    assert.equal((await evidence(1, 'body')).state, 'confirmed');
    // A normal current batch cannot revoke terms that are missing from its vocabulary.
    await transaction((c) =>
      recordTopicHistory(
        c,
        {
          snapshotId: second,
          postId: posts[0],
          postHash: digest('post'),
          bodyHash: digest('new-body'),
          matchedAt: after(7),
          complete: true,
          bodyCovered: true,
          records: [],
        },
        async () => {},
      ),
    );
    assert.equal((await evidence(1, 'body')).state, 'confirmed');
    // Body disappearance is pending, never proof that its previously observed text stopped matching.
    await pool.execute("UPDATE relation_observations SET status='failed' WHERE post_id=?", [posts[0]]);
    await revalidateTopicHistory(pool, { enabled: true, postIds: posts, now: () => after(8) });
    assert.equal((await evidence(1, 'body')).state, 'pending');
    assert.equal((await evidence(1, 'body')).reason, 'body-unavailable');
    // A capped input cannot revoke a title/body match just because it was not returned.
    await transaction((c) =>
      recordTopicHistory(
        c,
        {
          snapshotId: first,
          postId: posts[0],
          postHash: digest('post'),
          bodyHash: null,
          matchedAt: after(9),
          complete: false,
          bodyCovered: false,
          records: [],
        },
        async () => {},
      ),
    );
    assert.equal((await evidence(0, 'title')).state, 'confirmed');
    // An explicit upstream noise decision is different from a window simply omitting the term.
    await pool.execute(
      'INSERT INTO topic_canonical_terms_v3(snapshot_id,id,label,normalized_label,policy_version,exclusion_reason) VALUES (?,?,?,?,?,?)',
      [second, terms[0].id, terms[0].label, terms[0].normalized, POLICY_VERSION, 'upstream-noise'],
    );
    await revalidateTopicHistory(pool, { enabled: true, postIds: posts, now: () => after(10) });
    assert.equal((await evidence(0, 'title')).state, 'revoked');
    assert.equal((await evidence(0, 'title')).reason, 'explicit-noise');
    // Exhaustion changes neither evidence nor the counter; no hidden budget reset.
    const day = time.toISOString().slice(0, 10);
    await pool.execute("UPDATE work_budgets SET used=5000 WHERE day=? AND scope='topics:maintenance-match'", [day]);
    const before = JSON.stringify(await rows());
    const blocked = await revalidateTopicHistory(pool, { enabled: true, postIds: posts, now: () => after(11) });
    assert.equal(blocked.budgetExhausted, true);
    assert.equal(JSON.stringify(await rows()), before);
    const [[budget]] = await pool.query<RowDataPacket[]>("SELECT used FROM work_budgets WHERE day=? AND scope='topics:maintenance-match'", [
      day,
    ]);
    assert.equal(Number(budget.used), 5000);
    // A different fixture calendar day tests actual post deletion without touching the exhausted day.
    await pool.execute('DELETE FROM relation_observations WHERE post_id=?', [posts[0]]);
    await pool.execute('DELETE FROM posts WHERE id=?', [posts[0]]);
    await revalidateTopicHistory(pool, { enabled: true, postIds: posts, now: () => after(86401) });
    assert.ok((await rows()).every((r) => r.state === 'revoked'));
    const [pages] = await pool.query<RowDataPacket[]>('SELECT state FROM topic_pages WHERE canonical_id IN (?)', [terms.map((t) => t.id)]);
    assert.ok(
      pages.every((r) => r.state === 'revoked'),
      'last revoked article leaves durable topic tombstones',
    );
    // Lease loss rolls back the entire writer; no successful half-checkpoint/state change.
    await assert.rejects(
      transaction((c) =>
        applyHistoryObservations(c, [observation(0, 'title', 'confirmed', after(172800))], async () => {
          throw Error('lease lost fixture');
        }),
      ),
    );
    assert.equal((await evidence(0, 'title')).state, 'revoked');
  } finally {
    if (previous) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [previous.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    await pool.execute('DELETE FROM topic_article_evidence WHERE canonical_id IN (?)', [terms.map((t) => t.id)]);
    await pool.execute('DELETE FROM topic_pages WHERE canonical_id IN (?)', [terms.map((t) => t.id)]);
    for (const id of [first, second, duplicate]) {
      await pool.execute('DELETE FROM topic_history_backfill_runs WHERE id=?', [`snapshot:${id}`]);
      for (const table of ['topic_matches_v3', 'topic_post_indexes_v3', 'topic_canonical_terms_v3'])
        await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [id]);
      await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [id]);
    }
    if (posts.length) {
      await pool.execute('DELETE FROM relation_observations WHERE post_id IN (?)', [posts]);
      await pool.execute('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogId) await pool.execute('DELETE FROM blogs WHERE id=?', [blogId]);
    await pool.execute("DELETE FROM work_budgets WHERE day IN (?,?) AND scope='topics:maintenance-match'", [
      time.toISOString().slice(0, 10),
      after(86401).toISOString().slice(0, 10),
    ]);
  }
}
