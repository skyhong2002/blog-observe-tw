import { assertEphemeralDatabase } from './guard.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import { syncVocabulary } from '../../app/src/topics/sync.ts';
import { runTopicsBatch } from '../../app/src/topics/batch.ts';
import { invalidateTopicCache, registerTopicRoutes } from '../../app/src/topics/routes.ts';
const hash = (s) => createHash('sha256').update(s).digest('hex');
export async function runTopicsIntegration(pool) {
  assertEphemeralDatabase(pool);
  assert.equal(pool.pool.config.connectionConfig.port, 18169, 'clone-only integration');
  for (const table of [
    'topic_matches',
    'topic_post_indexes',
    'topic_terms',
    'topic_current',
    'topic_snapshots',
    'topic_window_articles',
    'topic_window_runs',
  ])
    await pool.query('DELETE FROM ' + table);
  await pool.query("DELETE FROM work_budgets WHERE scope LIKE 'topics:%'");
  await pool.query(
    "DELETE pt FROM post_tags pt JOIN posts p ON p.id=pt.post_id JOIN blogs b ON b.id=p.blog_id WHERE b.slug LIKE 'topic-test-%'",
  );
  await pool.query("DELETE p FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.slug LIKE 'topic-test-%'");
  await pool.query("DELETE FROM blogs WHERE slug LIKE 'topic-test-%'");
  await pool.query("DELETE FROM tags WHERE slug='topic-native-fixture'");
  const now = new Date();
  const published = new Date(now.getTime() - 60000);
  const window = { since: new Date(now.getTime() - 86400000).toISOString(), until: now.toISOString() };
  const source = {
    async page(w, cursor) {
      assert.deepEqual(w, window);
      return cursor
        ? {
            articles: [{ id: '800002', media: 'fixture2', publishedAt: published.toISOString(), tags: ['旅行', '科技'] }],
            nextCursor: null,
          }
        : {
            articles: [{ id: '800003', media: 'fixture', publishedAt: published.toISOString(), tags: ['旅行', 'AI'] }],
            nextCursor: '123_800003',
          };
    },
  };
  const a = await syncVocabulary(pool, { enabled: true, window, source, maxPages: 1, now: () => now });
  assert.equal(a.status, 'incomplete');
  const [[before]] = await pool.query('SELECT COUNT(*) n FROM topic_current');
  assert.equal(Number(before.n), 0);
  await assert.rejects(
    syncVocabulary(pool, {
      enabled: true,
      source: {
        page: async () => {
          throw Error('test upstream interruption');
        },
      },
      now: () => now,
    }),
    /upstream interruption/,
  );
  const [[still]] = await pool.query('SELECT COUNT(*) n FROM topic_current');
  assert.equal(Number(still.n), 0, 'partial must not publish');
  const b = await syncVocabulary(pool, { enabled: true, source, maxPages: 1, now: () => now });
  assert.equal(b.status, 'published');
  assert.equal(b.coverage, 'observed-article-window');
  assert.equal(b.total, 3);
  const blogIds = [];
  const postIds = [];
  for (let i = 0; i < 2; i++) {
    const [blog] = await pool.execute("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)", [
      `topic-test-${i}`,
      `話題測試${i}`,
      `https://topic-test-${i}.example/`,
      now,
    ]);
    blogIds.push(blog.insertId);
  }
  for (const [i, blogIndex] of [
    [0, 0],
    [1, 0],
    [2, 1],
    [3, 1],
  ]) {
    const title = `旅行測試 ${i}`;
    const [post] = await pool.execute(
      'INSERT INTO posts(blog_id,guid,url,title,summary,content_hash,published_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [
        blogIds[blogIndex],
        `topic-fixture-${i}`,
        `https://topic-test-${blogIndex}.example/post-${i}`,
        title,
        '',
        hash(title + '\n'),
        i === 3 ? null : published,
        now,
      ],
    );
    postIds.push(post.insertId);
  }
  const [tag] = await pool.execute(
    "INSERT INTO tags(slug,label,normalized_label,status,source_type,first_seen_at,last_seen_at,created_at,updated_at) VALUES ('topic-native-fixture','旅行','旅行','active','manual',?,?,?,?)",
    [now, now, now, now],
  );
  for (const [postId, sourceType] of [
    [postIds[0], 'crawler'],
    [postIds[2], 'manual'],
  ])
    await pool.execute(
      'INSERT INTO post_tags(post_id,tag_id,source_type,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      [postId, tag.insertId, sourceType, now, now, now, now],
    );
  const matched = await runTopicsBatch(pool, { limit: 200, now: () => now });
  assert.ok(matched.processed >= 3);
  const [[manual]] = await pool.query('SELECT source_type FROM post_tags WHERE post_id=? AND tag_id=?', [postIds[2], tag.insertId]);
  assert.equal(manual.source_type, 'manual');
  const [[ownTag]] = await pool.query('SELECT source_type FROM tags WHERE id=?', [tag.insertId]);
  assert.equal(ownTag.source_type, 'manual');
  const app = Fastify();
  registerTopicRoutes(app, pool);
  try {
    const response = await app.inject('/api/topics?days=30');
    assert.equal(response.statusCode, 200, response.body);
    const dto = response.json();
    assert.equal(dto.vocabulary.coverage, 'observed-article-window');
    assert.equal(dto.vocabulary.upstreamSnapshotConsistent, false);
    const topicId = 'tag:' + hash('旅行');
    const row = dto.items.find((t) => t.id === topicId);
    assert.ok(row, JSON.stringify(dto));
    assert.ok(row.blogs >= 2);
    assert.ok(row.posts >= 3);
    const detail = await app.inject('/api/topics/' + topicId + '?days=30');
    assert.equal(detail.statusCode, 200, detail.body);
    const fixtureBlog = detail.json().blogs.find((b) => b.id === blogIds[0]);
    assert.equal(fixtureBlog.posts, 2);
    assert.equal(fixtureBlog.score, 1.5);
    const fixture2 = detail.json().blogs.find((b) => b.id === blogIds[1]);
    assert.equal(fixture2.posts, 1, 'unknown dates excluded');
    assert.equal((await app.inject('/api/topics?days=1')).statusCode, 400);
    assert.equal((await app.inject('/api/topics/tag:not-hash')).statusCode, 400);
    assert.equal((await app.inject('/api/blogs/topic-test-0/topics?days=7')).statusCode, 200);
    await pool.execute('UPDATE posts SET title=?,content_hash=? WHERE id=?', ['別的主題', hash('別的主題\n'), postIds[1]]);
    invalidateTopicCache(pool);
    const stale = (await app.inject('/api/topics/' + topicId)).json().blogs.find((b) => b.id === blogIds[0]);
    assert.equal(stale.posts, 1, 'changed content immediately invalidates old keyword matches');
    return {
      windowVersion: b.version,
      terms: b.total,
      matched: matched.processed,
      partialRetained: true,
      manualPreserved: true,
      unknownDatesExcluded: true,
      diminishingCorrect: true,
      staleInvalidation: true,
    };
  } finally {
    await app.close();
    for (const table of [
      'topic_matches',
      'topic_post_indexes',
      'topic_terms',
      'topic_current',
      'topic_snapshots',
      'topic_window_articles',
      'topic_window_runs',
    ])
      await pool.query('DELETE FROM ' + table);
    await pool.query('DELETE FROM post_tags WHERE post_id IN (?)', [postIds]);
    await pool.query('DELETE FROM posts WHERE id IN (?)', [postIds]);
    await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogIds]);
    await pool.query('DELETE FROM tags WHERE id=?', [tag.insertId]);
    await pool.query("DELETE FROM work_budgets WHERE scope LIKE 'topics:%'");
  }
}
