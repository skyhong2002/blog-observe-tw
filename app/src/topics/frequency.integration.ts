import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { FREQUENCY_POLICY, refreshTopicFrequencies } from './frequency.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { ranking, topicEvidenceDetail } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';

/** Fixed calendar corpus proves denominator, de-duplication, partial coverage and atomic failure behavior. */
export async function runTopicFrequencyIntegration(pool: Pool) {
  assert.equal(
    (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port,
    18169,
    'clone-only frequency integration',
  );
  const snapshot = randomUUID(),
    now = new Date('2051-06-15T00:00:00.000Z');
  const original = (await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]))[0][0]?.snapshot_id;
  const blogs: number[] = [],
    posts: number[] = [];
  const terms = ['一般詞彙', '邊界詞彙', '稀有詞彙', '尚無命中', '排除詞彙', '超額詞彙'].map((label) => ({ label, id: digest(label) }));
  let pointed = false;
  try {
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'published',?)", [
      snapshot,
      JSON.stringify({ coverage: 'observed-article-window' }),
      now,
    ]);
    await pool.execute(
      "INSERT INTO topic_policy_selections(snapshot_id,policy_version,selection_id,status,as_of,config) VALUES (?,?,?,'ready',?,?)",
      [snapshot, POLICY_VERSION, digest(snapshot), now, '{}'],
    );
    for (const [i, t] of terms.entries())
      await pool.execute(
        'INSERT INTO topic_canonical_terms_v3(snapshot_id,id,label,normalized_label,policy_version,exclusion_reason,inactive_reason) VALUES (?,?,?,?,?,?,?)',
        [snapshot, t.id, t.label, t.label, POLICY_VERSION, i === 4 ? 'tag-noise' : null, i === 5 ? 'memory-budget' : null],
      );
    for (const [index, status] of ['verified', 'verified', 'candidate'].entries()) {
      const [r] = await pool.execute<ResultSetHeader>('INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,?,?)', [
        `frequency-${snapshot}-${status}-${index}`,
        `頻率測試${status}`,
        `https://${status}-${index}.example/`,
        status,
        now,
      ]);
      blogs.push(r.insertId);
    }
    for (let i = 0; i < 103; i++) {
      const published =
        i === 100
          ? new Date(now.getTime() + 86400000)
          : i === 101
            ? new Date(now.getTime() - 366 * 86400000)
            : new Date(now.getTime() - (i >= 50 && i < 100 ? 60 : 1) * 86400000);
      const hash = digest(`post-${snapshot}-${i}`);
      const [p] = await pool.execute<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at) VALUES (?,?,?,?,?,?,?)',
        [blogs[i === 102 ? 2 : i % 2], `${snapshot}-${i}`, `https://frequency.example/${snapshot}/${i}`, '頻率文章', hash, published, now],
      );
      posts.push(p.insertId);
      if (i < 11 || i >= 100)
        await pool.execute(
          "INSERT INTO topic_post_indexes_v3(post_id,snapshot_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind,needs_refresh) VALUES (?,?,?,?,NULL,?,'ok',?,'fixture','none',?)",
          [p.insertId, snapshot, digest('input'), i === 10 ? digest('stale') : hash, now, MATCHER_VERSION, i === 0 ? 1 : 0],
        );
    }
    const match = async (post: number, term: number, source: 'title' | 'body') =>
      pool.execute('INSERT INTO topic_matches_v3(post_id,term_id,snapshot_id,source) VALUES (?,?,?,?)', [
        posts[post],
        terms[term].id,
        snapshot,
        source,
      ]);
    await match(0, 0, 'title');
    await match(0, 0, 'body');
    await match(1, 0, 'body');
    await match(1, 0, 'title');
    await match(2, 0, 'body');
    await match(3, 1, 'body');
    await match(4, 1, 'title');
    await match(5, 2, 'body');
    await match(6, 4, 'body');
    await match(7, 5, 'body');
    for (const excluded of [10, 100, 101, 102]) await match(excluded, 0, 'body');
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, snapshot],
    );
    pointed = true;
    const result = await refreshTopicFrequencies(pool, { now, force: true });
    assert.equal(result.status, 'refreshed');
    const [[run]] = await pool.query<RowDataPacket[]>('SELECT * FROM topic_frequency_runs WHERE snapshot_id=?', [snapshot]);
    assert.equal(Number(run.total_posts), 100, 'denominator includes unmatched public articles but not pending/future/old posts');
    assert.equal(Number(run.covered_posts), 9, 'dirty known-positive observation retained but not counted as complete coverage');
    assert.equal(run.policy_version, FREQUENCY_POLICY.version);
    const [frequencies] = await pool.query<RowDataPacket[]>(
      'SELECT term_id,matched_posts,title_posts,high_frequency FROM topic_term_frequencies WHERE snapshot_id=? ORDER BY term_id',
      [snapshot],
    );
    const high = frequencies.find((t) => t.term_id === terms[0].id)!;
    const boundary = frequencies.find((t) => t.term_id === terms[1].id)!;
    const cold = frequencies.find((t) => t.term_id === terms[2].id)!;
    assert.deepEqual([Number(high.matched_posts), Number(high.title_posts), Number(high.high_frequency)], [3, 2, 1]);
    assert.deepEqual([Number(boundary.matched_posts), Number(boundary.title_posts), Number(boundary.high_frequency)], [2, 1, 0]);
    assert.deepEqual([Number(cold.matched_posts), Number(cold.title_posts), Number(cold.high_frequency)], [1, 0, 0]);
    assert.equal(frequencies.length, 3, 'missing/excluded/over-budget terms receive no fabricated baseline');
    // Public SQL uses the same verified corpus. Fifty of the 100 baseline posts
    // are recent, so a stable observed numerator produces a twofold share ratio.
    const ranks = await ranking(pool, 30, undefined, true, 100, now);
    const rankedHigh = ranks.items.find((t) => t.id === `tag:${terms[0].id}`)!;
    const rankedBoundary = ranks.items.find((t) => t.id === `tag:${terms[1].id}`)!;
    assert.ok(rankedHigh);
    assert.ok(rankedBoundary);
    assert.deepEqual([rankedHigh.posts, rankedHigh.titlePosts, rankedHigh.bodyOnlyPosts, rankedHigh.matchingRule], [2, 2, 0, 'title-only']);
    assert.equal(rankedHigh.matchingReason, FREQUENCY_POLICY.reason);
    assert.equal(rankedHigh.recentShare, 2 / 50);
    assert.equal(rankedHigh.baselineShare, 2 / 100);
    assert.equal(rankedHigh.lift, 2);
    assert.deepEqual(
      [rankedBoundary.posts, rankedBoundary.titlePosts, rankedBoundary.bodyOnlyPosts, rankedBoundary.matchingRule],
      [2, 1, 1, 'title-and-body'],
    );
    assert.equal(rankedBoundary.recentShare, 2 / 50);
    assert.equal(rankedBoundary.baselineShare, 2 / 100);
    assert.equal(rankedBoundary.lift, 2);
    const highDetail = await topicEvidenceDetail(pool, `tag:${terms[0].id}`, 30, true, now);
    assert.equal(highDetail?.topic.matchingRule, 'title-only');
    assert.equal(highDetail?.topic.matchingReason, FREQUENCY_POLICY.reason);
    assert.deepEqual(
      highDetail?.articles.map((p) => Number(p.id)).sort((a, b) => a - b),
      [posts[0], posts[1]].sort((a, b) => a - b),
    );
    const coldDetail = await topicEvidenceDetail(pool, `tag:${terms[2].id}`, 30, true, now);
    assert.equal(coldDetail?.topic.matchingRule, 'title-and-body');
    assert.equal(coldDetail?.articles.length, 1);
    assert.equal(coldDetail?.blogs[0].bodyOnlyPosts, 1, 'cold body evidence must remain publicly visible');
    // Evidence arriving after a baseline refresh has no baseline row: keep it,
    // expose no invented infinite lift, and do not apply a title-only rule.
    await match(8, 3, 'body');
    await match(9, 3, 'body');
    const newTerm = (await ranking(pool, 30, undefined, true, 100, now)).items.find((t) => t.id === `tag:${terms[3].id}`)!;
    assert.ok(newTerm);
    assert.equal(newTerm.posts, 2);
    assert.equal(newTerm.matchingRule, 'title-and-body');
    assert.equal(newTerm.baselineShare, 0);
    assert.equal(newTerm.lift, null);
    const perBlog = await ranking(pool, 30, `frequency-${snapshot}-verified-0`, true, 100, now);
    assert.ok(perBlog.items.length);
    assert.ok(
      perBlog.items.every((t) => t.lift === null),
      'site-local numerator must not be divided by a whole-site baseline',
    );
    const mixedScope = await ranking(pool, 30, undefined, false, 100, now);
    assert.ok(mixedScope.items.length);
    assert.ok(
      mixedScope.items.every((t) => t.lift === null),
      'a corpus including unverified sources cannot be compared with the verified-only baseline',
    );
    assert.equal((await refreshTopicFrequencies(pool, { now: new Date(now.getTime() + 1000) })).status, 'fresh');
    const failing = new Proxy(pool, {
      get(target, key) {
        if (key === 'getConnection')
          return async () => {
            const c = await target.getConnection();
            return new Proxy(c, {
              get(connection, method) {
                if (method === 'execute')
                  return (sql: unknown, ...args: unknown[]) => {
                    if (String(sql).startsWith('INSERT INTO topic_term_frequencies'))
                      return Promise.reject(Error('fixture insert failure'));
                    return Reflect.apply(connection.execute, connection, [sql, ...args]);
                  };
                const value = Reflect.get(connection, method);
                return typeof value === 'function' ? value.bind(connection) : value;
              },
            }) as PoolConnection;
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await assert.rejects(
      () => refreshTopicFrequencies(failing, { now: new Date(now.getTime() + 3600000), force: true }),
      /fixture insert failure/,
    );
    assert.deepEqual(
      (
        await pool.query<RowDataPacket[]>(
          'SELECT term_id,matched_posts,title_posts,high_frequency FROM topic_term_frequencies WHERE snapshot_id=? ORDER BY term_id',
          [snapshot],
        )
      )[0],
      frequencies,
      'failed replacement must leave complete previous baseline',
    );
    const [[preserved]] = await pool.query<RowDataPacket[]>('SELECT updated_at FROM topic_frequency_runs WHERE snapshot_id=?', [snapshot]);
    assert.equal(new Date(preserved.updated_at).toISOString(), now.toISOString());
    return {
      totalPosts: 100,
      coveredPosts: 9,
      highFrequency: { matchedPosts: 3, titlePosts: 2, ratio: 0.03 },
      thresholdBoundaryKept: true,
      coldTermKept: true,
      titleBodyDeduplicated: true,
      dirtyPositiveRetained: true,
      lastGoodRetained: true,
      publicTitleOnlyVerified: true,
      publicColdBodyPreserved: true,
      publicLift: 2,
      absentBaselineLift: null,
      mixedScopeLift: null,
    };
  } finally {
    if (pointed) {
      if (original) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [original, SOURCE]);
      else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    }
    await pool.execute('DELETE FROM topic_term_frequencies WHERE snapshot_id=?', [snapshot]);
    await pool.execute('DELETE FROM topic_frequency_runs WHERE snapshot_id=?', [snapshot]);
    if (posts.length) {
      await pool.query('DELETE FROM topic_matches_v3 WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM topic_post_indexes_v3 WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
    for (const table of ['topic_canonical_terms_v3', 'topic_policy_selections'])
      await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [snapshot]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [snapshot]);
  }
}
