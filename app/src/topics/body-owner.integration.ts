import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { runTopicsBatch } from './batch.ts';
import { topicBodyHash, topicBodyHtml, topicBodyJoins, topicBodyObtainedAt, topicBodyText } from './body.ts';
import { historyEvidenceSql } from './history-read.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { evidence } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';
/** Ownership regression with real guarded SQL; synthetic only, no HTTP/native DB. */
export async function runTopicBodyOwnerIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const now = new Date(),
    past = new Date(now.getTime() - 3600000),
    snapshot = randomUUID(),
    label = '蛤蜊絲瓜',
    term = digest(label),
    blogs: number[] = [],
    posts: number[] = [];
  let checks = 0;
  const check = (value: unknown, message: string) => {
    try {
      assert.ok(value, message);
    } catch (error) {
      if (error && typeof error === 'object') Object.defineProperty(error, 'testOrdinal', { value: checks + 1 });
      throw error;
    }
    checks++;
  };
  const [[existingPost]] = await pool.query<RowDataPacket[]>('SELECT id FROM posts LIMIT 1');
  check(!existingPost, 'fixture requires empty disposable corpus so batch selects only its own post');
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const blog = async (status: string) => {
    const slug = `body-owner-${randomUUID()}`;
    const [r] = await pool.execute<ResultSetHeader>('INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,?,?)', [
      slug,
      slug,
      `https://${slug}.example/`,
      status,
      past,
    ]);
    blogs.push(r.insertId);
    return r.insertId;
  };
  try {
    const owner = await blog('verified'),
      foreign = await blog('verified');
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,summary,content_hash,published_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
      [owner, randomUUID(), 'https://body-owner.example/post', label, null, digest('metadata'), past, past],
    );
    posts.push(p.insertId);
    await pool.execute(
      `INSERT INTO content_post_bodies(post_id,blog_id,body_text,body_html,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage) VALUES (?,?,?,? ,?,'full','ok','rss-content','https://body-owner.example/feed','https://body-owner.example/post','generic-public','blog-content-v2',1,?,?,?,'full')`,
      [p.insertId, owner, label, `<article>${label}</article>`, digest('body'), past, past, past],
    );
    await pool.execute(
      `INSERT INTO relation_observations(post_id,blog_id,body_text,content_hash,status,parser_version,observed_at,next_attempt_at,truncated) VALUES (?,?,?,?,'ok','fixture',?,?,0)`,
      [p.insertId, owner, label, digest('relation'), past, past],
    );
    const read = async () => {
      const [[r]] = await pool.query<RowDataPacket[]>(
        `SELECT ${topicBodyHash} hash,${topicBodyText} text,${topicBodyHtml} html,${topicBodyObtainedAt} observed FROM posts p ${topicBodyJoins} WHERE p.id=?`,
        [p.insertId],
      );
      return r;
    };
    let row = await read();
    check(
      row.hash === digest('body') && row.text === label && row.html === `<article>${label}</article>` && row.observed instanceof Date,
      'same owner private body precedence golden',
    );
    await pool.execute("UPDATE content_post_bodies SET status='missing' WHERE post_id=?", [p.insertId]);
    row = await read();
    check(
      row.hash === digest('relation') && row.text === label && row.html === null && row.observed instanceof Date,
      'same owner relation fallback golden',
    );
    await pool.execute("UPDATE content_post_bodies SET status='ok' WHERE post_id=?", [p.insertId]);
    for (const status of ['verified', 'seed', 'rejected', 'moved']) {
      await pool.execute('UPDATE blogs SET status=? WHERE id=?', [status, foreign]);
      await pool.execute('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [foreign, p.insertId]);
      await pool.execute('UPDATE relation_observations SET blog_id=? WHERE post_id=?', [foreign, p.insertId]);
      row = await read();
      check(
        row.hash === null && row.text === null && row.html === null && row.observed === null,
        `foreign ${status} owner with unchanged hashes excluded all fields`,
      );
    }
    // Transfer the post to a new verified owner while the cached bodies retain the old owner/hash.
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [foreign]);
    await pool.execute('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [owner, p.insertId]);
    await pool.execute('UPDATE relation_observations SET blog_id=? WHERE post_id=?', [owner, p.insertId]);
    await pool.execute('UPDATE posts SET blog_id=? WHERE id=?', [foreign, p.insertId]);
    for (const oldStatus of ['seed', 'rejected', 'moved']) {
      await pool.execute('UPDATE blogs SET status=? WHERE id=?', [oldStatus, owner]);
      row = await read();
      check(
        row.hash === null && row.text === null && row.html === null && row.observed === null,
        `post newverified owner excludes old ${oldStatus} body unchangedhash`,
      );
    }
    await pool.execute('UPDATE posts SET blog_id=? WHERE id=?', [owner, p.insertId]);
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [owner]);
    await pool.execute('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [foreign, p.insertId]);
    // Each fallback can only use its own correct owner, even when the other row is foreign.
    await pool.execute('UPDATE relation_observations SET blog_id=? WHERE post_id=?', [owner, p.insertId]);
    row = await read();
    check(row.hash === digest('relation') && row.html === null, 'foreign cb cannot suppress valid own relation');
    await pool.execute('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [owner, p.insertId]);
    await pool.execute('UPDATE relation_observations SET blog_id=? WHERE post_id=?', [foreign, p.insertId]);
    row = await read();
    check(row.hash === digest('body'), 'foreign relation cannot affect valid own cb');
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'published',?)", [
      snapshot,
      JSON.stringify({ coverage: 'observed-article-window' }),
      past,
    ]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, snapshot],
    );
    await pool.execute(
      "INSERT INTO topic_policy_selections(snapshot_id,policy_version,selection_id,status,as_of,active_terms,config) VALUES (?,?,?,'ready',?,1,'{}')",
      [snapshot, POLICY_VERSION, digest(snapshot), past],
    );
    await pool.execute('INSERT INTO topic_canonical_terms_v3(snapshot_id,id,label,normalized_label,policy_version) VALUES (?,?,?,?,?)', [
      snapshot,
      term,
      label,
      label,
      POLICY_VERSION,
    ]);
    await pool.execute(
      "INSERT INTO topic_post_indexes_v3(snapshot_id,post_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind,body_obtained_at) VALUES (?,?,?,?,?, ?,'ok',?,?,'html',?)",
      [snapshot, p.insertId, digest('input'), digest('metadata'), digest('body'), past, MATCHER_VERSION, CLEANUP_VERSION, past],
    );
    await pool.execute("INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) VALUES (?,?,?,'body')", [
      snapshot,
      p.insertId,
      term,
    ]);
    const rank = async () => {
      const [r] = await pool.query<RowDataPacket[]>(`WITH ${evidence()} SELECT * FROM evidence`, [new Date(now.getTime() - 86400000), now]);
      return r;
    };
    check((await rank()).length === 1, 'actual ranking own body positive');
    // Minimal global evidence fixture: preserve actual history reader joins and freshness checks.
    await pool.execute(
      `INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,source_snapshot_id,post_hash,body_hash,matcher_version,first_observed_at,last_observed_at,checked_at,published_at) VALUES (?,?,'body','confirmed',?,?,?,?,?,?,?,?)`,
      [term, p.insertId, snapshot, digest('metadata'), digest('body'), MATCHER_VERSION, past, past, past, past],
    );
    const historical = async () => {
      const [r] = await pool.query<RowDataPacket[]>(`WITH ${historyEvidenceSql()} SELECT fresh FROM historical`, [term]);
      return r;
    };
    const baseHistorySql = historyEvidenceSql();
    const bodyOnlyHistorySql = baseHistorySql.replace("AND e.source IN ('title','body')", "AND e.source='body'");
    check(
      bodyOnlyHistorySql !== baseHistorySql && !bodyOnlyHistorySql.includes("AND e.source IN ('title','body')"),
      'body-only helper changes exact source filter in actual history SQL',
    );
    const historicalBodyOnly = async () => {
      const [rows] = await pool.query<RowDataPacket[]>(`WITH ${bodyOnlyHistorySql} SELECT fresh FROM historical`, [term]);
      return rows;
    };
    check(Number((await historical())[0]?.fresh) === 1, 'actual history own body positive');
    const covered = async () => {
      const [[r]] = await pool.query<RowDataPacket[]>(
        `SELECT COALESCE(SUM(i.status='ok' AND i.matcher_version=? AND i.needs_refresh=0 AND (i.post_hash<=>p.content_hash) AND (i.body_hash<=>(${topicBodyHash}))),0) covered FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN topic_post_indexes_v3 i ON i.post_id=p.id AND i.snapshot_id=? ${topicBodyJoins} WHERE p.id=? AND b.status='verified' AND p.published_at>=? AND p.published_at<=?`,
        [MATCHER_VERSION, snapshot, p.insertId, new Date(now.getTime() - 86400000), now],
      );
      return Number(r.covered);
    };
    check((await covered()) === 1, 'actual frequency coverage predicate own positive');
    await pool.execute('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [foreign, p.insertId]);
    check((await rank()).length === 0, 'actual ranking foreign body rejected');
    check(Number((await historical())[0]?.fresh) === 0, 'actual history foreign body pending not fresh');
    check((await covered()) === 0, 'actual frequency predicate foreign body not covered');
    await pool.execute('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [owner, p.insertId]);
    check(
      (await rank()).length === 1 && Number((await historical())[0]?.fresh) === 1 && (await covered()) === 1,
      'owner restored samehash ranking/history/frequency recover',
    );
    await pool.execute('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [foreign, p.insertId]);
    await pool.execute(
      `INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,source_snapshot_id,post_hash,body_hash,matcher_version,first_observed_at,last_observed_at,checked_at,published_at) VALUES (?,?,'title','confirmed',?,?,NULL,?,?,?,?,?)`,
      [term, p.insertId, snapshot, digest('metadata'), MATCHER_VERSION, past, past, past, past],
    );
    check(Number((await historical())[0]?.fresh) === 1, 'fresh title history remains valid while foreign body evidence stays stale');
    check(Number((await historicalBodyOnly())[0]?.fresh) === 0, 'body-only actual history remains stale while aggregate title is fresh');
    const matched = await runTopicsBatch(pool, { limit: 1, now: () => now });
    check(matched.processed === 1, 'batch rematches missing own body');
    const [[idx]] = await pool.query<RowDataPacket[]>(
      'SELECT body_hash,body_kind FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id=?',
      [snapshot, p.insertId],
    );
    check(idx.body_hash === null && idx.body_kind === 'none', 'window batch stores its actual none kind/null hash');
    const [hits] = await pool.query<RowDataPacket[]>('SELECT source FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?', [
      snapshot,
      p.insertId,
    ]);
    check(hits.length === 1 && hits[0].source === 'title', 'batch title retained foreign body not matched');
    check((await rank()).length === 1 && (await covered()) === 1, 'legacy title rematch ranking and frequency retained');
    await pool.execute('UPDATE posts SET published_at=NULL WHERE id=?', [p.insertId]);
    check(
      (await rank()).length === 0 && Number((await historical())[0]?.fresh) === 1,
      'NULL date history public but outside dated ranking unchanged',
    );
    await pool.execute('DELETE FROM posts WHERE id=?', [p.insertId]);
    const [[missing]] = await pool.query<RowDataPacket[]>(
      `SELECT ${topicBodyHash} hash,${topicBodyText} text,${topicBodyHtml} html,${topicBodyObtainedAt} observed FROM (SELECT ? id) seed LEFT JOIN posts p ON p.id=seed.id ${topicBodyJoins}`,
      [p.insertId],
    );
    check(
      missing.hash === null && missing.text === null && missing.html === null && missing.observed === null,
      'left joined missing post cannot select orphaned body',
    );
    return {
      checks,
      synthetic: true,
      productionIncidence: 'unknown',
      scope: 'helper/ranking/history SQL + frequency actual coverage predicate + real window batch; no HTTP',
    };
  } finally {
    if (previous) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [previous.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    if (posts.length) {
      for (const table of ['content_post_bodies', 'relation_observations', 'topic_article_evidence'])
        await pool.query(`DELETE FROM ${table} WHERE post_id IN (?)`, [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    for (const table of ['topic_matches_v3', 'topic_post_indexes_v3', 'topic_canonical_terms_v3', 'topic_policy_selections'])
      await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [snapshot]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [snapshot]);
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
