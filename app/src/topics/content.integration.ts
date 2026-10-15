import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/mysql2';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { buildApp } from '../app.js';
import { hashToken } from '../auth/google-login.ts';
import { registerContentRoutes } from '../content/routes.ts';
import * as schema from '../db/schema.ts';
import { loadOverview } from '../overview.js';
import { loadSearch } from '../search.ts';
import { indexFulltextPosts, loadFulltextSearch } from '../search-fulltext.ts';
import { runTopicsBatch } from './batch.ts';
import { digest } from './matcher.ts';
import { invalidateTopicCache, registerTopicRoutes } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';

export async function runContentTopicsIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const token = randomUUID(),
    slug = `content-topics-${token}`,
    version = randomUUID(),
    rollbackVersion = randomUUID(),
    now = new Date();
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  let blogId: number | undefined, postId: number | undefined, userId: number | undefined, futurePostId: number | undefined;
  let gateway: FastifyInstance | undefined;
  const app = Fastify();
  try {
    const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)", [
      slug,
      '內容測試',
      'https://content-fixture.example/',
      now,
    ]);
    blogId = b.insertId;
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,summary,content_hash,published_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [
        blogId,
        token,
        'https://content-fixture.example/post',
        '短標題',
        '公開摘要'.repeat(400) + 'PRIVATE_SUMMARY_TAIL',
        digest('短標題公開摘要'),
        new Date(now.getTime() - 1000),
        now,
      ],
    );
    postId = p.insertId;
    const body = '正文前言。'.repeat(160) + '私藏綠茶' + '正文後段。'.repeat(200) + 'PRIVATE_FULL_BODY_TAIL';
    await pool.execute(
      `INSERT INTO content_post_bodies(post_id,blog_id,body_text,body_html,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage) VALUES (?,?,?,?,?,'full','ok','feed-content',?,?,'fixture','v1',1,?,?,?,'full')`,
      [
        postId,
        blogId,
        body,
        '<p>' + body + '</p>',
        digest(body),
        'https://content-fixture.example/feed',
        'https://content-fixture.example/post',
        now,
        now,
        now,
      ],
    );
    await pool.execute(
      "INSERT INTO relation_observations(post_id,blog_id,body_text,content_hash,status,parser_version,observed_at,next_attempt_at) VALUES (?,?,?,?,'ok','fixture',?,?)",
      [postId, blogId, '舊版紅茶', digest('舊版紅茶'), now, now],
    );
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at,synced_at) VALUES (?,?,'published',?,?)", [
      version,
      JSON.stringify({
        coverage: 'observed-article-window',
        generatedAt: now.toISOString(),
        total: 2,
        window: { until: now.toISOString() },
      }),
      now,
      now,
    ]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, version],
    );
    for (const label of ['私藏綠茶', '舊版紅茶'])
      await pool.execute('INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload) VALUES (?,?,?,?,?)', [
        version,
        digest(label),
        label,
        label,
        JSON.stringify({ label }),
      ]);
    await runTopicsBatch(pool, { limit: 200 });
    let [hits] = await pool.query<RowDataPacket[]>('SELECT term_id,source FROM topic_matches_v3 WHERE post_id=? AND snapshot_id=?', [
      postId,
      version,
    ]);
    assert.deepEqual(
      hits.map((r) => [r.term_id, r.source]),
      [[digest('私藏綠茶'), 'body']],
    );
    // An immutable older generation must not make the current article appear
    // dirty, nor may rematching the current generation erase rollback evidence.
    await pool.execute(
      `INSERT INTO topic_post_indexes_v3(snapshot_id,post_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind,body_obtained_at,needs_refresh)
      SELECT ?,post_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind,body_obtained_at,needs_refresh FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id=?`,
      [rollbackVersion, version, postId],
    );
    await pool.execute(
      'INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) SELECT ?,post_id,term_id,source FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?',
      [rollbackVersion, version, postId],
    );
    const unchanged = await runTopicsBatch(pool, { limit: 200, since: new Date(now.getTime() - 2000) });
    assert.equal(unchanged.processed, 0, 'old snapshot index must not cause current-generation rematching');
    // Metadata search never reads bodies; body text is found through the historical fulltext index.
    assert.equal((await loadSearch(pool, { q: '私藏綠茶', page: 1, limit: 20, blog: slug })).items.length, 0);
    await indexFulltextPosts(pool, [postId]);
    const search = await loadFulltextSearch(pool, { q: '私藏綠茶', page: 1, limit: 20, blog: slug });
    assert.equal(search.items.length, 1);
    assert.ok(search.items[0].snippet.includes('私藏綠茶'));
    assert.ok(!JSON.stringify(search).includes('PRIVATE_FULL_BODY_TAIL'));
    assert.ok(Array.from(search.items[0].snippet).length <= 240);
    const [future] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,summary,published_at,created_at) VALUES (?,?,?,?,?,?,?)',
      [
        blogId,
        token + '-future',
        'https://content-fixture.example/pinned',
        'FUTURE_PINNED_2115',
        '置頂原始資料',
        new Date('2115-02-02T00:00:00Z'),
        now,
      ],
    );
    futurePostId = future.insertId;
    const overview = await loadOverview(pool);
    assert.equal(
      overview.posts.some((row: { id: number }) => row.id === futurePostId),
      false,
    );
    assert.equal(overview.posts[0].id, postId);
    assert.equal(overview.blogs.find((row: { slug: string }) => row.slug === slug)?.postCount, 1);
    assert.ok(overview.totals.posts >= 1);
    const recent = overview.recentBlogs.find((row: { slug: string }) => row.slug === slug);
    assert.equal(recent?.latestPost.id, postId);
    assert.ok(!JSON.stringify(overview).includes('PRIVATE_FULL_BODY_TAIL'));
    registerTopicRoutes(app, pool);
    registerContentRoutes(app, pool);
    for (const endpoint of ['/api/content/coverage', `/api/blogs/${slug}/content`]) {
      const metadata = await app.inject(endpoint);
      assert.equal(metadata.statusCode, 200, metadata.body);
      assert.equal(metadata.json().publicContent, 'summary-only');
      assert.ok(!/body_text|body_html|selector|PRIVATE_FULL_BODY_TAIL/.test(metadata.body));
    }
    const secret = 'only-a-fixture-session-secret-0123456789',
      cookie = 'fixture-reader-' + token;
    const [user] = await pool.execute<ResultSetHeader>(
      'INSERT INTO users(google_sub,email,name,created_at,last_login_at) VALUES (?,?,?,?,?)',
      [token, token + '@example.invalid', '測試讀者', now, now],
    );
    userId = user.insertId;
    await pool.execute('INSERT INTO user_sessions(token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)', [
      hashToken(cookie, secret),
      userId,
      now,
      new Date(now.getTime() + 3600000),
    ]);
    await pool.execute('INSERT INTO user_follows(user_id,blog_id,created_at) VALUES (?,?,?)', [userId, blogId, now]);
    gateway = await buildApp(
      {
        port: 18165,
        publicOrigin: 'https://blog.observe.tw',
        uiOrigin: 'http://127.0.0.1:1',
        adminEmails: new Set(),
        login: { clientId: 'fixture', clientSecret: 'fixture', sessionSecret: secret, origin: 'https://blog.observe.tw' },
      },
      // @ts-expect-error JS gateway's injected store default is inferred as null.
      { store: { pool, db: drizzle(pool, { schema, mode: 'default' }) } },
    );
    for (const endpoint of ['/api/overview', `/api/blogs/${slug}`, '/me/feed.xml']) {
      const response: { statusCode: number; body: string } = await gateway.inject({
        url: endpoint,
        headers: { cookie: `blog_session=${cookie}` },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.ok(!/PRIVATE_SUMMARY_TAIL|PRIVATE_FULL_BODY_TAIL|body_text|body_html|FUTURE_PINNED_2115/.test(response.body));
    }
    const path = `/api/blogs/${slug}/topics`;
    assert.equal(
      (await app.inject(path)).json().items.some((row: { label: string }) => row.label === '私藏綠茶'),
      true,
    );
    await pool.execute(
      "UPDATE content_post_bodies SET body_text='改寫正文',body_html='<p>改寫正文</p>',content_hash=?,revision=revision+1 WHERE post_id=?",
      [digest('改寫正文'), postId],
    );
    invalidateTopicCache(pool);
    assert.equal((await app.inject(path)).json().items.length, 0, 'changed stored body immediately invalidates previous match');
    await runTopicsBatch(pool, { limit: 200 });
    [hits] = await pool.query<RowDataPacket[]>('SELECT term_id FROM topic_matches_v3 WHERE post_id=? AND snapshot_id=?', [postId, version]);
    assert.equal(hits.length, 0);
    await pool.execute("UPDATE content_post_bodies SET status='partial',completeness='partial' WHERE post_id=?", [postId]);
    await runTopicsBatch(pool, { limit: 200 });
    [hits] = await pool.query<RowDataPacket[]>('SELECT term_id FROM topic_matches_v3 WHERE post_id=? AND snapshot_id=?', [postId, version]);
    assert.equal(hits[0]?.term_id, digest('舊版紅茶'));
    const [rollbackHits] = await pool.query<RowDataPacket[]>(
      'SELECT term_id,source FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?',
      [rollbackVersion, postId],
    );
    assert.deepEqual(
      rollbackHits.map((r) => [r.term_id, r.source]),
      [[digest('私藏綠茶'), 'body']],
      'current-generation replacement must preserve rollback rows',
    );
    return {
      privateBodyMatched: true,
      rollbackGenerationPreserved: true,
      fullSnapshotPreferred: true,
      changedHashInvalidated: true,
      legacyFallback: true,
      boundedSearchSnippet: true,
      recentBlogLatestPost: true,
      publicMetadataOnly: true,
      authenticatedRssExcerptOnly: true,
      futurePinnedExcludedFromLatest: true,
      futureDateAndIndexCountsPreserved: true,
    };
  } finally {
    await app.close();
    if (gateway) await gateway.close();
    if (userId) {
      await pool.execute('DELETE FROM user_follows WHERE user_id=?', [userId]);
      await pool.execute('DELETE FROM user_sessions WHERE user_id=?', [userId]);
      await pool.execute('DELETE FROM users WHERE id=?', [userId]);
    }
    if (previous) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [previous.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    if (postId)
      for (const table of ['topic_matches_v3', 'topic_post_indexes_v3', 'content_post_bodies', 'relation_observations'])
        await pool.execute(`DELETE FROM ${table} WHERE post_id=?`, [postId]);
    if (futurePostId) {
      const [[raw]] = await pool.query<RowDataPacket[]>('SELECT published_at FROM posts WHERE id=?', [futurePostId]);
      assert.equal(new Date(raw.published_at).getUTCFullYear(), 2115);
      for (const table of ['topic_matches_v3', 'topic_post_indexes_v3'])
        await pool.execute(`DELETE FROM ${table} WHERE post_id=?`, [futurePostId]);
      await pool.execute('DELETE FROM posts WHERE id=?', [futurePostId]);
    }
    if (postId) await pool.execute('DELETE FROM posts WHERE id=?', [postId]);
    if (blogId) await pool.execute('DELETE FROM blogs WHERE id=?', [blogId]);
    await pool.execute('DELETE FROM topic_term_aliases_v3 WHERE snapshot_id=?', [version]);
    await pool.execute('DELETE FROM topic_canonical_terms_v3 WHERE snapshot_id=?', [version]);
    await pool.execute('DELETE FROM topic_terms WHERE snapshot_id=?', [version]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [version]);
  }
}
