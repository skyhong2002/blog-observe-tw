import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { selectSharedLabelCandidates } from './shared-label-job.ts';
import { isPublicSharedLabelTopic } from './shared-label-selection.ts';

/** Small synthetic SQL fixture. No upstream traffic, real publisher data or production schema. */
export async function runSharedLabelSelectionIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const nonce = randomBytes(5).toString('hex');
  const label = `離線測試B3${nonce}`;
  const id = createHash('sha256').update(label).digest('hex');
  const now = new Date();
  let blog = 0,
    post = 0,
    checks = 0;
  const check = async (expected: boolean, value = label) => {
    assert.equal(await isPublicSharedLabelTopic(pool, value), expected);
    checks++;
    if (value === label) {
      assert.equal(
        (await selectSharedLabelCandidates(pool)).includes(label),
        expected,
        'worker LIMIT admission agrees with public evidence validation',
      );
      checks++;
    }
  };
  try {
    await check(false);
    const [b] = await pool.query<ResultSetHeader>(
      "INSERT INTO blogs(slug,name,url,status,status_label,discovered_at) VALUES (?,?,?,'verified','fixture',?)",
      [`b3-${nonce}`, 'Synthetic B3 source', `https://${nonce}.example/`, now],
    );
    blog = b.insertId;
    const [p] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
      [blog, nonce, `https://${nonce}.example/post`, 'Synthetic evidence', new Date(now.getTime() - 1000), now],
    );
    post = p.insertId;
    const snapshot = '00000000-0000-4000-8000-000000000001';
    await pool.query(
      `INSERT INTO topic_pages(canonical_id,label,normalized_label,state,first_snapshot_id,last_snapshot_id,first_observed_at,last_observed_at,updated_at)
       VALUES (?,?,?,'pending',?,?,?,?,?)`,
      [id, label, label, snapshot, snapshot, now, now, now],
    );
    // The dictionary/page row without a public matched article is still ineligible.
    await check(false);
    await pool.query(
      `INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,source_snapshot_id,matcher_version,first_observed_at,last_observed_at,checked_at)
       VALUES (?,?,'title','pending',?,'synthetic-fixture-v1',?,?,?)`,
      [id, post, snapshot, now, now, now],
    );
    await check(true);
    await check(false, label.toLowerCase());
    for (const status of ['seed', 'rejected', 'moved']) {
      await pool.query('UPDATE blogs SET status=? WHERE id=?', [status, blog]);
      await check(false);
    }
    await pool.query("UPDATE blogs SET status='verified' WHERE id=?", [blog]);
    await check(true);
    await pool.query("UPDATE topic_article_evidence SET state='revoked' WHERE canonical_id=?", [id]);
    await check(false);
    await pool.query("UPDATE topic_article_evidence SET state='pending' WHERE canonical_id=?", [id]);
    for (const state of ['revoked', 'merged']) {
      await pool.query('UPDATE topic_pages SET state=? WHERE canonical_id=?', [state, id]);
      await check(false);
    }
    await pool.query("UPDATE topic_pages SET state='pending',reason='explicit-noise' WHERE canonical_id=?", [id]);
    await check(false);
    await pool.query('UPDATE topic_pages SET reason=NULL WHERE canonical_id=?', [id]);
    await pool.query('UPDATE posts SET published_at=? WHERE id=?', [new Date('2099-01-01'), post]);
    await check(false);
    await pool.query('UPDATE posts SET published_at=NULL WHERE id=?', [post]);
    await check(true);
    await pool.query('DELETE FROM posts WHERE id=?', [post]);
    await check(false);
    return { checks, realSql: true, upstreamRequests: 0 };
  } finally {
    await pool.query('DELETE FROM topic_article_evidence WHERE canonical_id=?', [id]);
    await pool.query('DELETE FROM topic_pages WHERE canonical_id=?', [id]);
    if (post) await pool.query('DELETE FROM posts WHERE id=?', [post]);
    if (blog) await pool.query('DELETE FROM blogs WHERE id=?', [blog]);
  }
}
