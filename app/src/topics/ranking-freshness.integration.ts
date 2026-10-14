import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify, { type LightMyRequestResponse } from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { topicBodyHash, topicBodyJoins } from './body.ts';
import { windowGateCtes } from './display-gate.ts';
import { FREQUENCY_POLICY } from './frequency.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { publicationLabelSql } from './publication-noise.ts';
import { runTopicRankingIntegration } from './ranking.integration.ts';
import { compactHomeRanking, evidence, ranking, registerTopicRoutes } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
// Golden SQL from b96ef9b. Compare actual MariaDB rows, not a mirrored scoring implementation.
const legacyEvidence = (blogScoped = false) =>
  `scoped_posts AS (SELECT p.id,p.blog_id,p.published_at,p.content_hash FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE p.published_at>=? AND p.published_at<=? AND b.status='verified' ${blogScoped ? 'AND b.slug=?' : ''}), evidence AS (
 SELECT p.id post_id,p.blog_id,p.published_at,CONCAT('tag:',t.id) topic_id,t.label,'tag-vocabulary' source,MAX(m.source='title') title_hit
 FROM scoped_posts p JOIN topic_matches_v3 m ON m.post_id=p.id JOIN topic_current c ON c.snapshot_id=m.snapshot_id AND c.source=${literal(SOURCE)}
 JOIN topic_canonical_terms_v3 t ON t.snapshot_id=m.snapshot_id AND t.id=m.term_id
 LEFT JOIN topic_term_frequencies f ON f.snapshot_id=t.snapshot_id AND f.term_id=t.id
 LEFT JOIN topic_frequency_runs fr ON fr.snapshot_id=t.snapshot_id AND fr.policy_version=${literal(FREQUENCY_POLICY.version)}
 JOIN topic_post_indexes_v3 i ON i.post_id=p.id AND i.snapshot_id=m.snapshot_id
 ${topicBodyJoins}
 WHERE i.status='ok' AND (i.post_hash<=>p.content_hash) AND (i.body_hash<=>(${topicBodyHash}))
 AND i.matcher_version=${literal(MATCHER_VERSION)} AND t.policy_version=${literal(POLICY_VERSION)}
 AND t.exclusion_reason IS NULL AND t.inactive_reason IS NULL AND ${publicationLabelSql('t.label')} AND m.source IN ('title','body')
 AND (m.source='title' OR fr.snapshot_id IS NULL OR COALESCE(f.high_frequency,0)=0)
 GROUP BY p.id,p.blog_id,p.published_at,t.id,t.label
), recent AS (SELECT * FROM evidence)`;

export async function runRankingFreshnessIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  let comparisons = 0,
    dateCases = false;
  const explain: { variant: string; plan: unknown }[] = [];
  const wrapped: Pool = Object.create(pool);
  wrapped.query = (async (sql: string, args: unknown[] = []) => {
    const scoped = sql.startsWith(`WITH ${evidence(true)}`) || sql.startsWith(`WITH ${evidence(true, true, true)}`);
    const gated = sql.startsWith(`WITH ${evidence(scoped, true, true)}`);
    const current = evidence(scoped, true, gated);
    if (!sql.startsWith(`WITH ${current}`)) return pool.query(sql, args);
    // Compare materialization only: apply the same display gate to both query plans.
    // The independent 2% SQL threshold oracle is run by display-gate.integration.ts.
    const previous = gated
      ? legacyEvidence(scoped).replace('recent AS (SELECT * FROM evidence)', windowGateCtes())
      : legacyEvidence(scoped);
    const old = sql.replace(current, previous);
    const result = await pool.query<RowDataPacket[]>(sql, args);
    const [before] = await pool.query<RowDataPacket[]>(old, args);
    assert.deepEqual(result[0], before, 'fresh-post materialization must preserve exact ranking/detail rows');
    comparisons++;
    if (sql.includes('per_blog AS') && sql.includes('LIMIT 101') && !scoped) {
      const compact = await compactHomeRanking(pool, 30, args[1] as Date);
      const standard = await ranking(pool, 30, undefined, true, 30, args[1] as Date, false);
      assert.deepEqual(compact, standard, 'compact home must preserve public counts, weights, native-label admission and ordering');
      comparisons++;
    }
    if (!dateCases && sql.includes('per_blog AS')) {
      dateCases = true;
      for (const [variant, text] of [
        ['legacy', old],
        ['fresh-posts', sql],
      ]) {
        const [[row]] = await pool.query<RowDataPacket[]>(`EXPLAIN FORMAT=JSON ${text}`, args);
        explain.push({ variant, plan: JSON.parse(row.EXPLAIN) });
      }
      const [posts] = await pool.query<RowDataPacket[]>(
        "SELECT p.id,p.published_at FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.slug LIKE 'ranking-%' ORDER BY p.id LIMIT 2",
      );
      assert.equal(posts.length, 2);
      try {
        await pool.execute('UPDATE posts SET published_at=NULL WHERE id=?', [posts[0].id]);
        await pool.execute('UPDATE posts SET published_at=? WHERE id=?', [new Date((args[1] as Date).getTime() + 86400000), posts[1].id]);
        const [dated] = await pool.query<RowDataPacket[]>(sql, args);
        const [oldDated] = await pool.query<RowDataPacket[]>(old, args);
        assert.deepEqual(dated, oldDated);
        assert.equal(Number(dated[0].posts), 4, 'NULL and future dates are outside the ranking window');
        comparisons++;
      } finally {
        for (const post of posts) await pool.execute('UPDATE posts SET published_at=? WHERE id=?', [post.published_at, post.id]);
      }
    }
    return result;
  }) as Pool['query'];
  const existing = await runTopicRankingIntegration(wrapped);
  const barriers = [];
  for (const mutation of ['seed', 'rejected', 'moved', 'delete', 'future', 'bodyhash'] as const)
    barriers.push(await rankingBarrier(pool, mutation));
  return { existing, comparisons, dateCases, explain, barriers, productionTimingClaim: false };
}

/** Real home route, real SQL, explicit read/commit barriers. No sleeping, HTTP or shared-result cache. */
async function rankingBarrier(pool: Pool, mutation: 'seed' | 'rejected' | 'moved' | 'delete' | 'future' | 'bodyhash') {
  assertEphemeralDatabase(pool);
  const snapshot = randomUUID(),
    now = new Date(),
    blogs: number[] = [],
    posts: number[] = [];
  const revoked = digest(`${snapshot}-revoked`),
    control = digest(`${snapshot}-control`);
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  let release!: () => void, read!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    observed = new Promise<void>((resolve) => {
      read = resolve;
    });
  let reads = 0;
  const order: string[] = [];
  const routePool: Pool = Object.create(pool);
  routePool.query = (async (sql: string, args: unknown[] = []) => {
    if (!sql.startsWith('WITH scoped_posts')) throw Error('home_route_must_not_read_vocabulary_or_coverage');
    reads++;
    const result = await pool.query(sql, args);
    if (reads === 1) {
      order.push('A-read');
      read();
      await held;
      order.push('A-released');
    } else order.push('B-read');
    return result;
  }) as Pool['query'];
  const app = Fastify();
  registerTopicRoutes(app, routePool);
  let a: Promise<LightMyRequestResponse> | undefined;
  try {
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at,synced_at) VALUES (?,?,'published',?,?)", [
      snapshot,
      '{}',
      now,
      now,
    ]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, snapshot],
    );
    for (const [id, label] of [
      [revoked, '撤銷主題'],
      [control, '保留主題'],
    ])
      await pool.execute('INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,policy_version) VALUES (?,?,?,?,?)', [
        snapshot,
        id,
        label,
        label,
        POLICY_VERSION,
      ]);
    for (let i = 0; i < 4; i++) {
      const [blog] = await pool.execute<ResultSetHeader>(
        "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)",
        [`barrier-${snapshot}-${i}`, `fixture${i}`, `https://barrier-${i}.example/`, now],
      );
      blogs.push(blog.insertId);
      const postHash = digest(`${snapshot}-post${i}`),
        bodyHash = digest(`${snapshot}-body${i}`);
      const [post] = await pool.execute<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at) VALUES (?,?,?,?,?,?,?)',
        [blog.insertId, `${snapshot}-${i}`, `https://barrier-${i}.example/post`, 'fixture', postHash, new Date(now.getTime() - 60000), now],
      );
      posts.push(post.insertId);
      await pool.execute(
        "INSERT INTO relation_observations(post_id,blog_id,body_text,content_hash,status,parser_version,observed_at,next_attempt_at) VALUES (?,?,?,?,'ok','fixture',?,?)",
        [post.insertId, blog.insertId, 'fixture body', bodyHash, now, now],
      );
      await pool.execute(
        "INSERT INTO topic_post_indexes_v3(post_id,snapshot_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind) VALUES (?,?,?,?,?,?,'ok',?,?,'text')",
        [post.insertId, snapshot, digest('input'), postHash, bodyHash, now, MATCHER_VERSION, CLEANUP_VERSION],
      );
      await pool.execute("INSERT INTO topic_matches_v3(post_id,term_id,snapshot_id,source) VALUES (?,?,?,'body')", [
        post.insertId,
        i < 2 ? revoked : control,
        snapshot,
      ]);
    }
    a = app.inject('/api/topics?days=30&view=home');
    await Promise.race([
      observed,
      a.then(() => {
        throw Error('A_finished_before_SQL_barrier');
      }),
    ]);
    const writer = await pool.getConnection();
    try {
      await writer.beginTransaction();
      order.push('writer-begin');
      if (['seed', 'rejected', 'moved'].includes(mutation))
        await writer.execute('UPDATE blogs SET status=? WHERE id IN (?,?)', [mutation, blogs[0], blogs[1]]);
      else if (mutation === 'delete') await writer.execute('DELETE FROM posts WHERE id IN (?,?)', [posts[0], posts[1]]);
      else if (mutation === 'future')
        await writer.execute('UPDATE posts SET published_at=? WHERE id IN (?,?)', [new Date(Date.now() + 3600000), posts[0], posts[1]]);
      else
        await writer.execute('UPDATE relation_observations SET content_hash=? WHERE post_id IN (?,?)', [
          digest('revoked body'),
          posts[0],
          posts[1],
        ]);
      await writer.commit();
      order.push('writer-committed');
    } catch (error) {
      await writer.rollback();
      throw error;
    } finally {
      writer.release();
    }
    const b = await app.inject('/api/topics?days=30&view=home');
    order.push('B-returned');
    assert.equal(b.statusCode, 200);
    assert.equal(b.headers['cache-control'], 'no-store');
    assert.equal(b.json().view, 'home');
    assert.equal(b.json().cacheSeconds, 0);
    assert.deepEqual(
      b.json().items.map((x: { id: string }) => x.id),
      [`tag:${control}`],
    );
    assert.equal(b.json().items[0].posts, 2);
    assert.equal(b.json().items[0].blogs, 2);
    assert.equal(reads, 2, 'B must run a fresh SQL read while A remains held');
    release();
    assert.ok(a);
    const old = await a;
    order.push('A-returned');
    assert.equal(old.statusCode, 200);
    assert.equal(old.json().items.length, 2);
    assert.ok(
      old.json().items.some((x: { id: string }) => x.id === `tag:${revoked}`),
      'precommit A may return its own prior read',
    );
    assert.deepEqual(order, ['A-read', 'writer-begin', 'writer-committed', 'B-read', 'B-returned', 'A-released', 'A-returned']);
    return {
      mutation,
      homeRequests: 2,
      rankingSQLReads: reads,
      independentWriterCommits: 1,
      retainedControlTopics: 1,
      removedTopics: 1,
      order,
    };
  } finally {
    release();
    if (a) await a;
    await app.close();
    if (previous) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [previous.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    for (const table of ['topic_matches_v3', 'topic_post_indexes_v3', 'topic_canonical_terms_v3'])
      await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [snapshot]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [snapshot]);
    if (posts.length) {
      await pool.query('DELETE FROM relation_observations WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
