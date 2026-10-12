import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
    assert.equal(topic.blogs, 2);
    assert.equal(topic.posts, 4);
    assert.equal(topic.score, 3);
    assert.ok(!topics.json().items.some((t: { id: string }) => t.id === `rss:${tags[1]}`));
    const detail = await app.inject(`/api/v1/topics/rss%3A${tags[0]}`);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().blogs.length, 2);
    assert.equal(detail.json().articles.length, 4);
    assert.equal((await app.inject(`/api/v1/topics/rss%3A${tags[1]}`)).statusCode, 404);
    return { paginationRows: ids.length, verifiedBlogs: 2, privateBlogsExcluded: 1, topicScore: topic.score };
  } finally {
    await app.close();
    if (posts.length) {
      await pool.query('DELETE FROM post_tags WHERE post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (tags.length) await pool.query('DELETE FROM tags WHERE id IN (?)', [tags]);
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
