import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getIndexablePages, getPageIndexability, getPageMetadata } from '../seo/indexability.ts';
import { registerPageApi } from '../seo/page-api.ts';
import { getPublicPages, resolvePublicPage } from '../seo/page-routes.ts';
import { createPublicPageRedirect } from '../seo/redirects.ts';
import { sitemapBlogs, sitemapTopics } from '../seo/sitemap-entries.ts';
import { durableTopicDetail, historyEvidenceSql, readTopicHistory, topicHistoryDisposition } from './history-read.ts';
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
    await countsMatchEvidenceDefinition(pool, app, run, now);
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
    // The lean sitemap read lists the same pages as the full one; revoked, noise and merged IDs stay out.
    const lean = (await sitemapTopics(pool, { from: null, to: null })).filter((p) => ids.includes(p.entityId));
    assert.deepEqual(
      lean.map((p) => [p.entityId, p.canonicalPath, new Date(p.lastmod as Date).toISOString()]),
      [[ids[0], `/topics/${keys[0]}/`, oldDate.toISOString()]],
    );
    const half = ids[0].slice(0, 8);
    assert.equal((await sitemapTopics(pool, { from: half, to: null })).filter((p) => p.entityId === ids[0]).length, 1, 'from is inclusive');
    assert.equal((await sitemapTopics(pool, { from: null, to: half })).filter((p) => p.entityId === ids[0]).length, 0, 'to is exclusive');
    assert.ok(
      (await sitemapBlogs(pool)).some((p) => p.entityId === String(blog)) === false,
      'a blog without a readable route is not listed',
    );
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
    assert.ok(!(await sitemapTopics(pool, { from: null, to: null })).some((p) => p.entityId === ids[0]), 'unverified source drops at once');
    assert.equal((await readTopicHistory(pool, ids[0])).total, 0);
    const masked = await app.inject(`/api/pages/topics/${keys[0]}`);
    assert.equal(masked.statusCode, 404);
    assert.equal(masked.headers['cache-control'], 'no-store');
    assert.equal((await app.inject(`/topics/${keys[0]}/`)).statusCode, 404);
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [blog]);
    assert.equal((await app.inject(`/topics/${keys[0]}/`)).statusCode, 200);
    assert.ok((await sitemapTopics(pool, { from: null, to: null })).some((p) => p.entityId === ids[0]));
    await pool.execute("UPDATE topic_article_evidence SET state='revoked' WHERE canonical_id=?", [ids[0]]);
    assert.ok(!(await sitemapTopics(pool, { from: null, to: null })).some((p) => p.entityId === ids[0]), 'revoked evidence drops at once');
    await pool.execute("UPDATE topic_article_evidence SET state='confirmed' WHERE canonical_id=?", [ids[0]]);
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

/**
 * Topic page counts read without the body tables equal the historyEvidenceSql definition (which joins them for
 * freshness): one row per public article, pending included, duplicates/unverified/future/revoked out; a withdrawal
 * answers 410 on the next metadata request.
 */
async function countsMatchEvidenceDefinition(pool: Pool, app: ReturnType<typeof Fastify>, run: string, now: Date) {
  const key = `history-counts-${run.slice(0, 8)}`,
    id = digest(key),
    hash = digest(`${run}-counts`),
    day = (n: number) => new Date(now.getTime() + n * 86400_000);
  const blogs: number[] = [],
    posts: number[] = [];
  try {
    for (const status of ['verified', 'verified', 'seed']) {
      const [b] = await pool.execute<ResultSetHeader>('INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,?,?)', [
        `history-counts-${blogs.length}-${run}`,
        run,
        `https://counts-${blogs.length}.example/`,
        status,
        now,
      ]);
      blogs.push(b.insertId);
    }
    // [blog, published offset in days, evidence rows]
    const fixture: [number, number, [string, string][]][] = [
      [
        0,
        -30,
        [
          ['title', 'confirmed'],
          ['body', 'confirmed'],
        ],
      ],
      [0, -20, [['body', 'pending']]],
      [1, -10, [['title', 'confirmed']]],
      [2, -5, [['title', 'confirmed']]],
      [0, 3, [['title', 'confirmed']]],
      [1, -1, [['body', 'revoked']]],
    ];
    for (const [i, [blog, offset, evidence]] of fixture.entries()) {
      const [p] = await pool.execute<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
        [blogs[blog], `${run}-counts-${i}`, `https://counts.example/${run}/${i}`, `計數文章${i}`, hash, day(offset), now, now],
      );
      posts.push(p.insertId);
      for (const [source, state] of evidence)
        await pool.execute(
          'INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,source_snapshot_id,post_hash,body_hash,matcher_version,first_observed_at,last_observed_at,checked_at,published_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
          [id, p.insertId, source, state, run, hash, hash, MATCHER_VERSION, now, now, now, day(offset)],
        );
    }
    await pool.execute(
      "INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage) VALUES(?,?,'正文',?,'full','ok','feed','u','u','a','1',1,?,?,?,'full')",
      [posts[0], blogs[0], hash, now, now, now],
    );
    await pool.execute(
      'INSERT INTO topic_pages(canonical_id,label,normalized_label,state,merged_into,first_snapshot_id,last_snapshot_id,first_observed_at,last_observed_at,last_article_at,updated_at) VALUES(?,?,?,?,NULL,?,?,?,?,?,?)',
      [id, key, key, 'active', run, run, now, now, now, now],
    );
    await pool.execute("INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES('topic',?,?,?)", [key, id, now]);
    await pool.execute("INSERT INTO public_page_routes(kind,entity_id,canonical_key,created_at) VALUES('topic',?,?,?)", [id, key, now]);

    const [[definition]] = await pool.query<RowDataPacket[]>(
      `WITH ${historyEvidenceSql()} SELECT COUNT(*) posts,COUNT(DISTINCT blog_id) blogs,MAX(published_at) lastmod,SUM(fresh=1) fresh FROM historical`,
      [id],
    );
    assert.deepEqual([Number(definition.posts), Number(definition.blogs), Number(definition.fresh)], [3, 2, 2]);
    const counts = await getPageIndexability(pool, 'topic', id);
    assert.deepEqual([counts.posts, counts.blogs, counts.indexable], [3, 2, true]);
    const listed = (await getPageMetadata(pool, 'topic', [id])).get(id);
    assert.deepEqual([listed?.posts, listed?.blogs], [3, 2]);
    const site = (await getIndexablePages(pool, 'topic')).find((p) => p.entityId === id);
    assert.equal(new Date(site?.lastmod as Date).toISOString(), new Date(definition.lastmod).toISOString());
    const api = await app.inject(`/api/pages/topics/${key}`);
    assert.equal(api.statusCode, 200);
    assert.deepEqual([api.json().page.posts, api.json().page.blogs, api.json().page.entityId], [3, 2, id]);

    await pool.execute("UPDATE topic_article_evidence SET state='revoked' WHERE canonical_id=?", [id]);
    const withdrawn = await app.inject(`/api/pages/topics/${key}`);
    assert.equal(withdrawn.statusCode, 410, 'a withdrawal is visible on the next metadata request');
    assert.equal(withdrawn.headers['cache-control'], 'no-store');
    assert.equal((await getPageIndexability(pool, 'topic', id)).posts, 0);
  } finally {
    for (const table of ['public_page_routes', 'public_route_keys'])
      await pool.query(`DELETE FROM ${table} WHERE kind='topic' AND entity_id=?`, [id]);
    await pool.query('DELETE FROM topic_article_evidence WHERE canonical_id=?', [id]);
    await pool.query('DELETE FROM topic_pages WHERE canonical_id=?', [id]);
    if (posts.length) await pool.query('DELETE FROM content_post_bodies WHERE post_id IN (?)', [posts]);
    if (posts.length) await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
