import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { registerPublicApi } from '../v1/routes.ts';
/** Real SQL contracts; forbidden outside the disposable integration server. */
export async function runPublicApiIntegration(pool: Pool) {
  const port = (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port;
  assert.equal(port, 18169);
  const marker = `api-${randomUUID()}`,
    blogs: number[] = [],
    posts: number[] = [],
    tags: number[] = [];
  const now = new Date(),
    published = new Date(now.getTime() - 3600000),
    app = Fastify({ exposeHeadRoutes: true });
  registerPublicApi(app, pool);
  try {
    for (const [name, status] of [
      ['public-a', 'verified'],
      ['public-b', 'verified'],
      ['private', 'seed'],
    ]) {
      const [result] = await pool.query<ResultSetHeader>('INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,?,?)', [
        `${marker}-${name}`,
        `${marker} ${name}`,
        `https://${name}.example/`,
        status,
        now,
      ]);
      blogs.push(result.insertId);
    }
    for (const [i, blogId] of blogs.entries())
      for (let j = 0; j < 2; j++) {
        const url = `https://fixture.example/${marker}/${i}/${j}`;
        const [result] = await pool.query<ResultSetHeader>(
          'INSERT INTO posts(blog_id,guid,url,title,summary,published_at,created_at) VALUES(?,?,?,?,?,?,?)',
          [blogId, url, url, marker, '<b>' + '字'.repeat(900) + '</b>', published, now],
        );
        posts.push(result.insertId);
      }
    for (const visibility of ['public', 'private']) {
      const [result] = await pool.query<ResultSetHeader>(
        "INSERT INTO tags(slug,label,normalized_label,status,visibility,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,'active',?,?,?,?,?)",
        [`${marker}-${visibility}`, `${marker}-${visibility}`, `${marker}-${visibility}`, visibility, now, now, now, now],
      );
      tags.push(result.insertId);
      for (const postId of posts)
        await pool.query('INSERT INTO post_tags(post_id,tag_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?)', [
          postId,
          result.insertId,
          now,
          now,
          now,
          now,
        ]);
    }
    const first = await app.inject(`/api/v1/articles?q=${marker}&limit=1`);
    assert.equal(first.statusCode, 200);
    let page = first.json();
    const ids: number[] = [];
    while (true) {
      ids.push(
        ...page.items.map((item: { id: number; summary: string }) => {
          assert.equal(Array.from(item.summary).length, 500);
          return item.id;
        }),
      );
      if (!page.nextCursor) break;
      const next = await app.inject(`/api/v1/articles?q=${marker}&limit=1&cursor=${page.nextCursor}`);
      assert.equal(next.statusCode, 200);
      page = next.json();
      assert.deepEqual(page.window, first.json().window);
    }
    assert.deepEqual(ids, posts.slice(0, 4).reverse());
    assert.equal(new Set(ids).size, 4);
    // An explicit until within the permitted clock-skew tolerance must not publish future posts.
    const futureUrl = `https://fixture.example/${marker}/near-future`;
    const [future] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,summary,published_at,created_at) VALUES(?,?,?,?,?,?,?)',
      [blogs[0], futureUrl, futureUrl, `${marker}-near-future`, '公開時間尚未到', new Date(Date.now() + 40000), now],
    );
    posts.push(future.insertId);
    const window = `since=${encodeURIComponent(published.toISOString())}&until=${encodeURIComponent(new Date(Date.now() + 55000).toISOString())}`;
    for (const path of ['/api/v1/articles', `/api/v1/blogs/${marker}-public-a/articles`]) {
      const response = await app.inject(`${path}?q=${marker}-near-future&${window}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().items.length, 0, 'clock skew is not permission to reveal unpublished posts');
    }
    // v1 title search remains distinct from the website's historical body search.
    const bodyUrl = `https://public-a.example/${marker}/body-only`;
    const [bodyOnly] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,summary,published_at,created_at) VALUES(?,?,?,?,?,?,?)',
      [blogs[0], bodyUrl, bodyUrl, '不含搜尋詞的標題', `蛤蜊絲瓜-${marker}`, published, now],
    );
    posts.push(bodyOnly.insertId);
    const bodyText = `只在正文與摘要出現蛤蜊絲瓜-${marker}`;
    await pool.query(
      `INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage)
       VALUES(?,?,?,?,'full','ok','rss-content',?,?,'fixture','v1',1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP(),'fixture')`,
      [bodyOnly.insertId, blogs[0], bodyText, createHash('sha256').update(bodyText).digest('hex'), bodyUrl, bodyUrl],
    );
    const bodySearch = await app.inject(`/api/v1/articles?q=${encodeURIComponent(`蛤蜊絲瓜-${marker}`)}`);
    assert.equal(bodySearch.statusCode, 200);
    assert.equal(bodySearch.json().items.length, 0, 'v1 q matches title, not body or summary');
    const directory = await app.inject(`/api/v1/blogs?q=${marker}&limit=1`);
    assert.equal(directory.statusCode, 200);
    assert.equal(directory.json().items[0].id, blogs[0]);
    const directoryNext = await app.inject(`/api/v1/blogs?q=${marker}&limit=1&cursor=${directory.json().nextCursor}`);
    assert.equal(directoryNext.json().items[0].id, blogs[1]);
    assert.equal(directoryNext.json().nextCursor, null);
    for (const suffix of ['', '/articles', '/relations']) {
      assert.equal((await app.inject(`/api/v1/blogs/${marker}-private${suffix}`)).statusCode, 404);
      assert.equal((await app.inject(`/api/v1/blogs/${marker}-public-a${suffix}`)).statusCode, 200);
    }
    assert.equal((await app.inject('/api/v1/relations')).statusCode, 200);
    const topics = await app.inject('/api/v1/topics?limit=200');
    assert.equal(topics.statusCode, 200);
    const topic = topics.json().items.find((t: { id: string }) => t.id === `rss:${tags[0]}`);
    assert.equal(topic, undefined, 'RSS tags do not form a separate topic dictionary');
    assert.equal(topics.json().matchingPolicy.titleWeight, 2);
    assert.equal(topics.json().matchingPolicy.bodyWeight, 1);
    assert.ok(!topics.json().items.some((t: { id: string }) => t.id === `rss:${tags[1]}`));
    const detail = await app.inject(`/api/v1/topics/rss%3A${tags[0]}`);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().blogs.length, 0);
    assert.equal(detail.json().articles.length, 0);
    assert.equal(detail.json().topic.excludedReason, 'not-in-tag-vocabulary');
    assert.equal(detail.json().topic.canonicalId, null);
    assert.equal((await app.inject(`/api/v1/topics/rss%3A${tags[1]}`)).statusCode, 404);
    return {
      paginationRows: ids.length,
      nearFutureExcluded: true,
      titleOnlySearch: true,
      verifiedBlogs: 2,
      privateBlogsExcluded: 1,
      nativeDetailCompatible: true,
      nativeRankingExcluded: true,
    };
  } finally {
    await app.close();
    if (posts.length) {
      await pool.query('DELETE FROM content_post_bodies WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM post_tags WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (tags.length) await pool.query('DELETE FROM tags WHERE id IN (?)', [tags]);
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
