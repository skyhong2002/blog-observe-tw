import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { FREQUENCY_POLICY } from './frequency.ts';
import { carryTopicIndexes } from './index-carry.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { evidence, ranking } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';

/** Exercise the same transaction boundaries as publication against the disposable clone only. */
export async function runIndexCarryIntegration(pool: Pool) {
  assert.equal((pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port, 18169);
  const [[original]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const ids = Array.from({ length: 5 }, () => randomUUID()),
    [oldId, sameId, newId, mismatchId, rollbackId] = ids;
  const blogs: number[] = [],
    posts: number[] = [];
  const now = new Date('2039-10-12T12:00:00Z'),
    ai = digest('ai');
  const postStates = async (snapshot = newId) =>
    (
      await pool.query<RowDataPacket[]>(
        'SELECT post_id,snapshot_id,needs_refresh FROM topic_post_indexes_v3 WHERE post_id IN (?) AND snapshot_id=? ORDER BY post_id',
        [posts, snapshot],
      )
    )[0];
  const visible = async () => {
    const [[row]] = await pool.query<RowDataPacket[]>(
      `WITH ${evidence(false, true)} SELECT COUNT(*) n FROM recent WHERE topic_id=? AND blog_id IN (?)`,
      [new Date(now.getTime() - 30 * 86400_000), now, `tag:${ai}`, blogs],
    );
    return Number(row.n);
  };
  const carry = async (from: string, to: string) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const result = await carryTopicIndexes(c, from, to);
      await c.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [to, SOURCE]);
      await c.commit();
      return result;
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  };
  try {
    for (const [i, id] of ids.entries()) {
      await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at,synced_at) VALUES (?,?,'published',?,?)", [
        id,
        JSON.stringify({ id, generatedAt: now.toISOString(), coverage: 'observed-article-window' }),
        now,
        now,
      ]);
      await pool.execute(
        "INSERT INTO topic_policy_selections(snapshot_id,policy_version,selection_id,status,as_of,config) VALUES (?,?,?,'ready',?,?)",
        [id, i === 3 ? 'obsolete-policy' : POLICY_VERSION, digest(id), now, '{}'],
      );
      for (const label of i >= 2 ? ['AI', '新詞'] : ['AI', '退休詞'])
        await pool.execute(
          'INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,occurrences,policy_version) VALUES (?,?,?,?,?,?)',
          [id, digest(label.toLowerCase()), label.toLowerCase(), label, 3, POLICY_VERSION],
        );
    }
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, oldId],
    );
    for (let b = 0; b < 2; b++) {
      const [blog] = await pool.execute<ResultSetHeader>(
        "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)",
        [`carry-${oldId}-${b}`, `索引接續${b}`, `https://carry-${b}.example/`, now],
      );
      blogs.push(blog.insertId);
      for (let j = 0; j < (b === 0 ? 2 : 1); j++) {
        const hash = digest(`carry-${b}-${j}`);
        const [post] = await pool.execute<ResultSetHeader>(
          'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at) VALUES (?,?,?,?,?,?,?)',
          [
            blog.insertId,
            `${oldId}-${b}-${j}`,
            `https://carry-${b}.example/${j}`,
            'AI 模型',
            hash,
            new Date(now.getTime() - (j === 1 ? 72 : 1) * 3600_000),
            now,
          ],
        );
        posts.push(post.insertId);
        await pool.execute(
          "INSERT INTO topic_post_indexes_v3(post_id,snapshot_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind) VALUES (?,?,?,?,NULL,?,'ok',?,?,'empty')",
          [post.insertId, oldId, hash, hash, now, MATCHER_VERSION, CLEANUP_VERSION],
        );
        await pool.execute("INSERT INTO topic_matches_v3(post_id,term_id,snapshot_id,source) VALUES (?,?,?,'title')", [
          post.insertId,
          ai,
          oldId,
        ]);
      }
    }
    await pool.execute("INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) VALUES (?,?,?,'body')", [
      oldId,
      posts[0],
      digest('退休詞'),
    ]);
    await pool.execute(
      'INSERT INTO topic_frequency_runs(snapshot_id,baseline_from,baseline_until,total_posts,covered_posts,threshold_ratio,policy_version,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [oldId, new Date(now.getTime() - 30 * 86400_000), now, 100, 80, 0.1, FREQUENCY_POLICY.version, now],
    );
    await pool.execute(
      'INSERT INTO topic_term_frequencies(snapshot_id,term_id,matched_posts,title_posts,high_frequency) VALUES (?,?,?,?,?)',
      [oldId, ai, 3, 3, 0],
    );
    assert.equal(await visible(), 3);
    const oldRank = (await ranking(pool, 30, undefined, true, 100, now)).items;
    assert.deepEqual(await carry(oldId, sameId), { reused: true, recentQueued: false });
    assert.equal(await visible(), 3, 'new generation keeps public positive evidence');
    assert.ok(
      (await postStates(sameId)).every((p) => p.snapshot_id === sameId && p.needs_refresh === 0),
      'unchanged set does not dirty indexes',
    );
    assert.deepEqual(await carry(sameId, newId), { reused: true, recentQueued: true });
    assert.deepEqual(await carry(sameId, newId), { reused: true, recentQueued: true }, 'same carry can safely run again');
    const [[retired]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_matches_v3 WHERE snapshot_id=? AND term_id=?', [
      newId,
      digest('退休詞'),
    ]);
    assert.equal(Number(retired.n), 0, 'removed terms are not copied');
    const changed = await postStates();
    assert.ok(changed.every((p) => p.snapshot_id === newId));
    assert.equal(changed.find((p) => p.post_id === posts[1])?.needs_refresh, 0, 'older than 48h is not dirtied by a new term');
    assert.ok(changed.filter((p) => p.post_id !== posts[1]).every((p) => p.needs_refresh === 1));
    // Pending work from a previous cycle survives another carry even outside the recent window.
    await pool.execute('UPDATE topic_post_indexes_v3 SET needs_refresh=1 WHERE post_id=? AND snapshot_id=?', [posts[1], newId]);
    assert.equal(await visible(), 3, 'needs_refresh retains already verified public evidence');
    await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [oldId, SOURCE]);
    assert.equal(await visible(), 3, 'pointer rollback restores complete old evidence');
    assert.deepEqual(
      (await ranking(pool, 30, undefined, true, 100, now)).items,
      oldRank,
      'pointer rollback restores original scores and order',
    );
    assert.ok(
      (await postStates(oldId)).every((p) => p.needs_refresh === 0),
      'new generation does not mutate old index state',
    );
    await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [newId, SOURCE]);
    const [[frequency]] = await pool.query<RowDataPacket[]>(
      'SELECT matched_posts FROM topic_term_frequencies WHERE snapshot_id=? AND term_id=?',
      [newId, ai],
    );
    assert.equal(Number(frequency.matched_posts), 3);
    const [coverageRows] = await pool.query<RowDataPacket[]>(
      'SELECT snapshot_id,covered_posts FROM topic_frequency_runs WHERE snapshot_id IN (?,?)',
      [sameId, newId],
    );
    assert.equal(
      Number(coverageRows.find((r) => r.snapshot_id === sameId)?.covered_posts),
      80,
      'same active set retains baseline coverage',
    );
    assert.equal(
      Number(coverageRows.find((r) => r.snapshot_id === newId)?.covered_posts),
      0,
      'new active terms conservatively reset carried coverage until recomputed',
    );
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      assert.deepEqual(await carryTopicIndexes(c, newId, mismatchId), { reused: false, recentQueued: false });
      await c.rollback();
      assert.ok(
        (await postStates()).every((p) => p.snapshot_id === newId),
        'policy mismatch cannot carry or mutate old evidence',
      );
      await c.beginTransaction();
      await carryTopicIndexes(c, newId, rollbackId);
      const [[pending]] = await c.query<RowDataPacket[]>(
        'SELECT needs_refresh FROM topic_post_indexes_v3 WHERE post_id=? AND snapshot_id=?',
        [posts[1], rollbackId],
      );
      assert.equal(pending.needs_refresh, 1, 'existing pending work is never reset by carry');
      await c.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [rollbackId, SOURCE]);
      // A publication failure after carry must roll back every index, frequency and pointer write.
      await c.rollback();
    } finally {
      c.release();
    }
    assert.ok((await postStates()).every((p) => p.snapshot_id === newId));
    const [[current]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
    assert.equal(current.snapshot_id, newId);
    const [[rolled]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_frequency_runs WHERE snapshot_id=?', [rollbackId]);
    assert.equal(Number(rolled.n), 0);
    assert.equal(await visible(), 3);
    // Check the 48h bound independently from preserved pending flags.
    await pool.execute('UPDATE topic_post_indexes_v3 SET needs_refresh=0 WHERE post_id=? AND snapshot_id=?', [posts[1], newId]);
    const [recentOnly] = await pool.query<RowDataPacket[]>(
      'SELECT post_id FROM topic_post_indexes_v3 WHERE needs_refresh=1 AND post_id IN (?) AND snapshot_id=?',
      [posts, newId],
    );
    assert.deepEqual(
      recentOnly.map((r) => Number(r.post_id)).sort((a, b) => a - b),
      [posts[0], posts[2]].sort((a, b) => a - b),
    );
    // A retry after destination rematching must not restore an obsolete positive match.
    await pool.execute('DELETE FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?', [newId, posts[0]]);
    await pool.execute('UPDATE topic_post_indexes_v3 SET needs_refresh=0 WHERE snapshot_id=? AND post_id=?', [newId, posts[0]]);
    await pool.execute('UPDATE topic_term_frequencies SET matched_posts=777 WHERE snapshot_id=? AND term_id=?', [newId, ai]);
    await carry(sameId, newId);
    const [[rematched]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?', [
      newId,
      posts[0],
    ]);
    assert.equal(Number(rematched.n), 0, 'retry cannot resurrect old source matches over a destination zero-hit result');
    const [[clean]] = await pool.query<RowDataPacket[]>(
      'SELECT needs_refresh FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id=?',
      [newId, posts[0]],
    );
    assert.equal(Number(clean.needs_refresh), 0, 'retry does not dirty an already rematched destination');
    const [[newFrequency]] = await pool.query<RowDataPacket[]>(
      'SELECT matched_posts FROM topic_term_frequencies WHERE snapshot_id=? AND term_id=?',
      [newId, ai],
    );
    assert.equal(Number(newFrequency.matched_posts), 777, 'retry preserves destination frequency refresh');
    return {
      publicEvidencePreserved: true,
      newRecentTermsQueued: true,
      sameSetClean: true,
      pendingPreserved: true,
      policyMismatchRejected: true,
      publicationRollbackAtomic: true,
      frequencyCarry: true,
      pointerRollbackPreserved: true,
      removedTermsNotCopied: true,
      repeatedCarryIdempotent: true,
      rematchSurvivesRetry: true,
    };
  } finally {
    if (original) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [original.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    if (posts.length) {
      await pool.query('DELETE FROM topic_matches_v3 WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM topic_post_indexes_v3 WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
    for (const table of ['topic_term_frequencies', 'topic_frequency_runs', 'topic_policy_selections', 'topic_canonical_terms_v3'])
      await pool.query(`DELETE FROM ${table} WHERE snapshot_id IN (?)`, [ids]);
    await pool.query('DELETE FROM topic_snapshots WHERE id IN (?)', [ids]);
  }
}
