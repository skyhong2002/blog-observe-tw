import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getIndexablePages, getPageIndexability, getPageMetadata } from '../seo/indexability.ts';
import { registerPageApi } from '../seo/page-api.ts';
import { getPublicPages, resolvePublicPage } from '../seo/page-routes.ts';
import { createPublicPageRedirect } from '../seo/redirects.ts';
import { durableTopicDetail, readTopicHistory, topicHistoryDisposition } from './history-read.ts';
import { digest, MATCHER_VERSION } from './policy.ts';

export async function runTopicHistoryReadIntegration(pool: Pool) {
  assert.equal((pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port, 18169);
  const oldFlag = process.env.BLOG_TOPIC_HISTORY_READ_ENABLED;
  process.env.BLOG_TOPIC_HISTORY_READ_ENABLED = 'true';
  const run = randomUUID(),
    snapshot = randomUUID(),
    now = new Date(),
    oldDate = new Date(Date.now() - 400 * 86400_000);
  oldDate.setMilliseconds(0);
  now.setMilliseconds(0);
  const keys = ['available', 'revoked', 'noise', 'merged', 'middle', 'cycle'].map((s) => `history-${s}-${run.slice(0, 8)}`);
  const ids = keys.map(digest),
    postHash = digest(run),
    unknown = digest(`${run}-unknown`);
  let blog = 0,
    post = 0;
  const app = Fastify();
  registerPageApi(app, pool);
  const redirect = createPublicPageRedirect(pool);
  app.get('/*', async (req, reply) => {
    if (await redirect(req, reply)) return reply;
    return { rendered: true };
  });
  try {
    const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)", [
      `history-blog-${run}`,
      run,
      'https://history.example/',
      now,
    ]);
    blog = b.insertId;
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
      [blog, run, 'https://history.example/post', '公開文章標題', postHash, oldDate, oldDate, now],
    );
    post = p.insertId;
    for (let i = 0; i < ids.length; i++) {
      await pool.execute(
        'INSERT INTO topic_pages(canonical_id,label,normalized_label,state,merged_into,first_snapshot_id,last_snapshot_id,first_observed_at,last_observed_at,last_article_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [
          ids[i],
          i === 2 ? '＋＋' : keys[i],
          keys[i],
          i === 1 ? 'revoked' : i >= 3 ? 'merged' : 'active',
          i === 3 ? ids[4] : i === 4 ? ids[0] : i === 5 ? ids[5] : null,
          snapshot,
          snapshot,
          now,
          now,
          oldDate,
          now,
        ],
      );
      await pool.execute("INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES('topic',?,?,?)", [
        keys[i],
        ids[i],
        now,
      ]);
      await pool.execute("INSERT INTO public_page_routes(kind,entity_id,canonical_key,created_at) VALUES('topic',?,?,?)", [
        ids[i],
        keys[i],
        now,
      ]);
      if (i < 3)
        await pool.execute(
          'INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,source_snapshot_id,post_hash,matcher_version,first_observed_at,last_observed_at,checked_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
          [ids[i], post, 'title', i === 1 ? 'revoked' : 'confirmed', snapshot, postHash, MATCHER_VERSION, now, now, now, oldDate],
        );
    }
    // No current-snapshot term exists for these IDs. One old article on one blog is enough.
    assert.equal((await topicHistoryDisposition(pool, ids[0])).status, 'available');
    const detail = await durableTopicDetail(pool, `tag:${ids[0]}`, 30, now);
    assert.equal(detail?.articles.length, 0);
    assert.equal(detail?.history.total, 1);
    assert.equal(detail?.history.articles[0].evidenceState, 'confirmed');
    assert.deepEqual(
      Object.keys(detail!.history.articles[0]).sort(),
      ['id', 'title', 'url', 'publishedAt', 'blogSlug', 'blogName', 'evidenceState', 'observedAt'].sort(),
    );
    const registry = await getPublicPages(pool, 'topic', [ids[0]]);
    assert.equal(registry.get(ids[0])?.canonicalPath, `/topics/${keys[0]}/`);
    const indexable = await getPageIndexability(pool, 'topic', ids[0]);
    assert.equal(indexable.indexable, true);
    assert.equal(indexable.windowDays, null);
    assert.equal(indexable.posts, 1);
    assert.equal(indexable.blogs, 1);
    assert.equal((await getPageMetadata(pool, 'topic', [ids[0]])).size, 1);
    const site = (await getIndexablePages(pool, 'topic')).find((p) => p.entityId === ids[0]);
    assert.ok(site);
    assert.equal(new Date(site.lastmod as Date).toISOString(), oldDate.toISOString());
    for (const key of [keys[3], `tag%3A${ids[3]}`]) {
      const r = await app.inject(`/topics/${key}/?days=90`);
      assert.equal(r.statusCode, 301);
      assert.equal(r.headers.location, `/topics/${keys[0]}/?days=90`);
    }
    assert.equal((await resolvePublicPage(pool, 'topic', keys[3]))?.entityId, ids[0]);
    assert.equal((await app.inject(`/topics/${keys[0]}/`)).statusCode, 200);
    assert.equal((await app.inject(`/topics/tag%3A${unknown}/`)).statusCode, 404);
    assert.equal((await app.inject(`/topics/${keys[5]}/`)).statusCode, 404);
    for (const id of [ids[1], ids[2]]) assert.equal((await app.inject(`/topics/tag%3A${id}/`)).statusCode, 410);
    await pool.execute('UPDATE posts SET content_hash=? WHERE id=?', [digest('changed'), post]);
    const pending = await readTopicHistory(pool, ids[0]);
    assert.equal(pending.pending, 1);
    assert.equal(pending.confirmed, 0);
    assert.equal((await app.inject(`/topics/${keys[0]}/`)).statusCode, 200);
    await pool.execute("UPDATE blogs SET status='seed' WHERE id=?", [blog]);
    assert.equal((await topicHistoryDisposition(pool, ids[0])).status, 'masked');
    assert.equal((await readTopicHistory(pool, ids[0])).total, 0);
    const masked = await app.inject(`/api/pages/topics/${keys[0]}`);
    assert.equal(masked.statusCode, 404);
    assert.equal(masked.headers['cache-control'], 'no-store');
    assert.equal((await app.inject(`/topics/${keys[0]}/`)).statusCode, 404);
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [blog]);
    assert.equal((await app.inject(`/topics/${keys[0]}/`)).statusCode, 200);
    const [[e]] = await pool.query<RowDataPacket[]>('SELECT state FROM topic_article_evidence WHERE canonical_id=?', [ids[0]]);
    assert.equal(e.state, 'confirmed');
    await pool.execute('DELETE FROM posts WHERE id=?', [post]);
    assert.equal((await topicHistoryDisposition(pool, ids[0])).status, 'gone');
    assert.equal((await app.inject(`/topics/${keys[0]}/`)).statusCode, 410);
  } finally {
    await app.close();
    for (const table of ['public_page_routes', 'public_route_keys'])
      await pool.query(`DELETE FROM ${table} WHERE kind='topic' AND entity_id IN (?)`, [ids]);
    await pool.query('DELETE FROM topic_article_evidence WHERE canonical_id IN (?)', [ids]);
    await pool.query('DELETE FROM topic_pages WHERE canonical_id IN (?)', [ids]);
    if (post) await pool.query('DELETE FROM posts WHERE id=?', [post]);
    if (blog) await pool.query('DELETE FROM blogs WHERE id=?', [blog]);
    if (oldFlag === undefined) delete process.env.BLOG_TOPIC_HISTORY_READ_ENABLED;
    else process.env.BLOG_TOPIC_HISTORY_READ_ENABLED = oldFlag;
  }
}
