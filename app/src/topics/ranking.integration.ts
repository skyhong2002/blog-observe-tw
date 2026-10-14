import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { topicDetail as publicDetail } from '../public-api/topics.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION, projectTopicTerms } from './policy.ts';
import { ranking, resolveTopic, topicEvidenceDetail, vocabularyStatus } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';

/** The golden fixture controls the corpus/time and exercises actual SQL, not a mirrored JS formula. */
export async function runTopicRankingIntegration(pool: Pool, persisted = { policy: POLICY_VERSION, matcher: MATCHER_VERSION }) {
  assertEphemeralDatabase(pool);
  assert.equal((pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port, 18169);
  const snapshot = randomUUID(),
    now = new Date('2037-10-12T12:00:00Z');
  const [[original]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const blogs: number[] = [],
    posts: number[] = [],
    tags: number[] = [];
  const projected = projectTopicTerms([
    { id: digest('AI'), label: 'AI', payload: { articleCount: 20 } },
    { id: digest('ai'), label: 'ai', payload: { articleCount: 10 } },
    { id: digest('性'), label: '性', payload: { articleCount: 100 } },
    { id: digest('2026'), label: '2026', payload: { articleCount: 200 } },
  ]);
  try {
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at,synced_at) VALUES (?,?,'published',?,?)", [
      snapshot,
      JSON.stringify({ coverage: 'observed-article-window' }),
      now,
      now,
    ]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, snapshot],
    );
    for (const t of projected.terms)
      await pool.execute(
        'INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,exclusion_reason,occurrences,policy_version) VALUES (?,?,?,?,?,?,?)',
        [snapshot, t.id, t.normalizedLabel, t.label, t.exclusionReason, t.occurrences, persisted.policy],
      );
    for (const a of projected.aliases)
      await pool.execute('INSERT INTO topic_term_aliases_v3(snapshot_id,term_id,canonical_id) VALUES (?,?,?)', [
        snapshot,
        a.termId,
        a.canonicalId,
      ]);
    for (let b = 0; b < 2; b++) {
      const [blog] = await pool.execute<ResultSetHeader>(
        "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)",
        [`ranking-${snapshot}-${b}`, `排名測試${b}`, `https://ranking-${b}.example/`, now],
      );
      blogs.push(blog.insertId);
      for (let p = 0; p < 3; p++) {
        const hash = digest(`body-${b}-${p}`),
          postHash = digest(`post-${b}-${p}`);
        const [post] = await pool.execute<ResultSetHeader>(
          'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at) VALUES (?,?,?,?,?,?,?)',
          [
            blog.insertId,
            `${snapshot}-${b}-${p}`,
            `https://ranking-${b}.example/${p}`,
            b === 0 && p < 2 ? 'AI 模型' : '穩定性',
            postHash,
            new Date(now.getTime() - 60000),
            now,
          ],
        );
        posts.push(post.insertId);
        await pool.execute(
          "INSERT INTO relation_observations(post_id,blog_id,body_text,content_hash,status,parser_version,observed_at,next_attempt_at) VALUES (?,?,?,?,'ok','fixture',?,?)",
          [post.insertId, blog.insertId, 'AI 模型', hash, now, now],
        );
        await pool.execute(
          "INSERT INTO topic_post_indexes_v3(post_id,snapshot_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind) VALUES (?,?,?,?,?,?,'ok',?,?,?)",
          [post.insertId, snapshot, digest('input'), postHash, hash, now, persisted.matcher, CLEANUP_VERSION, 'text'],
        );
        await pool.execute("INSERT INTO topic_matches_v3(post_id,term_id,snapshot_id,source) VALUES (?,?,?,'body')", [
          post.insertId,
          digest('ai'),
          snapshot,
        ]);
        if (b === 0 && p < 2)
          await pool.execute("INSERT INTO topic_matches_v3(post_id,term_id,snapshot_id,source) VALUES (?,?,?,'title')", [
            post.insertId,
            digest('ai'),
            snapshot,
          ]);
        // Deliberately stale excluded evidence must still never enter the public ranking.
        await pool.execute("INSERT INTO topic_matches_v3(post_id,term_id,snapshot_id,source) VALUES (?,?,?,'body')", [
          post.insertId,
          digest('性'),
          snapshot,
        ]);
      }
    }
    const result = await ranking(pool, 30, undefined, true, 100, now);
    assert.equal(result.items.length, 1, 'AI/ai merge into one row; excluded words disappear');
    assert.deepEqual(result.items[0], {
      id: `tag:${digest('ai')}`,
      label: 'AI',
      source: 'tag-vocabulary',
      score: 5,
      posts: 6,
      blogs: 2,
      titlePosts: 2,
      bodyOnlyPosts: 4,
      recentShare: 1,
      baselineShare: null,
      lift: null,
      matchingRule: 'title-and-body',
      matchingReason: null,
    });
    const withCoverage = await ranking(pool, 30, undefined, true, 100, now, true);
    assert.equal(withCoverage.matchedPosts, 6, 'title/body overlap counts one distinct article');
    assert.deepEqual(withCoverage.items, result.items);
    await pool.execute("UPDATE blogs SET status='seed' WHERE id=?", [blogs[1]]);
    const singleBlog = await ranking(pool, 30, undefined, true, 100, now, true);
    assert.equal(singleBlog.matchedPosts, 3, 'no eligible ranking still retains public article coverage');
    assert.deepEqual(singleBlog.items, []);
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [blogs[1]]);
    const extraId = digest('旅行');
    await pool.execute(
      'INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,occurrences,policy_version) VALUES (?,?,?,?,?,?)',
      [snapshot, extraId, '旅行', '旅行', 10, persisted.policy],
    );
    for (const postId of [posts[0], posts[3]])
      await pool.execute("INSERT INTO topic_matches_v3(post_id,term_id,snapshot_id,source) VALUES (?,?,?,'body')", [
        postId,
        extraId,
        snapshot,
      ]);
    const limited = await ranking(pool, 30, undefined, true, 1, now, true);
    assert.equal(limited.matchedPosts, 6, 'multiple topics and outer LIMIT never inflate or truncate coverage');
    assert.equal(limited.items.length, 1);
    assert.equal(limited.truncated, true);
    await pool.execute('DELETE FROM topic_matches_v3 WHERE snapshot_id=? AND term_id=?', [snapshot, extraId]);
    await pool.execute('DELETE FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id=?', [snapshot, extraId]);
    const perBlog = await topicEvidenceDetail(pool, `tag:${digest('AI')}`, 30, true, now);
    assert.ok(perBlog);
    assert.equal(perBlog.topic.canonicalId, `tag:${digest('ai')}`);
    assert.equal(perBlog.blogs.find((b) => b.id === blogs[0])?.score, 3.25, '2 title + 1 body; title/body overlap counts once');
    assert.equal(perBlog.blogs.find((b) => b.id === blogs[1])?.score, 1.75, '3 body-only diminishing contributions');
    assert.equal(perBlog.articles.length, 6);
    const excluded = await topicEvidenceDetail(pool, `tag:${digest('性')}`, 30, true, now);
    assert.equal(excluded?.topic.excludedReason, 'too-short');
    assert.deepEqual(excluded?.articles, []);
    const numeric = await publicDetail(pool, `tag:${digest('2026')}`, 720);
    assert.equal(numeric?.topic.excludedReason, 'pure-number');
    const status = await vocabularyStatus(pool);
    assert.equal(status.excludedTermCount, 2);
    assert.deepEqual(status.exclusionReasons, { 'too-short': 1, 'pure-number': 1 });
    for (const [index, label] of ['ＡＩ', '本地自造分類'].entries()) {
      const [tag] = await pool.execute<ResultSetHeader>(
        "INSERT INTO tags(slug,label,normalized_label,status,source_type,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,'active','crawler',?,?,?,?)",
        [`rank-${snapshot}-${index}`, label, label, now, now, now, now],
      );
      tags.push(tag.insertId);
    }
    assert.equal((await resolveTopic(pool, `rss:${tags[0]}`))?.canonicalId, `tag:${digest('ai')}`);
    const unknown = await topicEvidenceDetail(pool, `rss:${tags[1]}`, 30, true, now);
    assert.equal(unknown?.topic.excludedReason, 'not-in-tag-vocabulary');
    assert.deepEqual(unknown?.blogs, []);
    await pool.execute('UPDATE topic_post_indexes_v3 SET matcher_version=? WHERE post_id=?', ['obsolete', posts[0]]);
    const stale = await ranking(pool, 30, undefined, true, 100, now);
    assert.equal(stale.items[0].posts, 5, 'obsolete policy indexes cannot leak');
    await pool.execute('UPDATE posts SET content_hash=? WHERE id=?', [digest('changed'), posts[1]]);
    const changed = await ranking(pool, 30, undefined, true, 100, now);
    assert.equal(changed.items[0].posts, 4, 'changed title hash invalidates evidence');
    await pool.execute('UPDATE topic_canonical_terms_v3 SET policy_version=? WHERE snapshot_id=?', ['unrecognized', snapshot]);
    assert.deepEqual((await ranking(pool, 30, undefined, true, 100, now)).items, [], 'unknown/mixed policy evidence stays excluded');
    await pool.execute('UPDATE topic_canonical_terms_v3 SET policy_version=? WHERE snapshot_id=?', [persisted.policy, snapshot]);
    assert.equal(
      (await ranking(pool, 30, undefined, true, 100, now)).items[0].posts,
      4,
      'restoring the exact pair restores only fresh evidence',
    );
    return {
      persisted,
      unknownPolicyExcluded: true,
      mergedCanonical: true,
      titleBodyDedup: true,
      titleWeightedScore: 3.25,
      bodyOnlyScore: 1.75,
      aliasCompatible: true,
      excludedReasonQueryable: true,
      staleVersionExcluded: true,
    };
  } finally {
    if (original) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [original.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    for (const table of ['topic_matches_v3', 'topic_post_indexes_v3', 'topic_term_aliases_v3', 'topic_canonical_terms_v3'])
      await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [snapshot]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [snapshot]);
    if (posts.length) {
      await pool.query('DELETE FROM relation_observations WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
    if (tags.length) await pool.query('DELETE FROM tags WHERE id IN (?)', [tags]);
  }
}
