/** Isolated SQL fixture: scheduled articles must not affect public aggregates. */
import assert from 'node:assert/strict';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../tests/integration/guard.mjs';
import { buildApp } from './app.js';
import { loadCatalog } from './catalog.js';
import { loadAuthorCatalog } from './catalog-authors.js';
import { loadOverview } from './overview.js';
import { loadRelationCoverage } from './relations/routes.ts';

export async function runFutureVisibilityIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const suffix = Date.now().toString(36),
    slug = `future-check-${suffix}`;
  const now = new Date(),
    past = new Date(now.getTime() - 60_000),
    future = new Date(now.getTime() + 86400_000);
  let blogId = 0,
    otherBlogId = 0,
    authorId = 0,
    tagId = 0;
  const posts: number[] = [];
  const app = await buildApp(
    { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165, publicOrigin: 'https://weblog.tw' },
    // @ts-expect-error JS gateway supports an injected fixture pool.
    { store: { pool } },
  );
  const baseline = await loadOverview(pool);
  try {
    const [blog] = await pool.execute<ResultSetHeader>(
      "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)",
      [slug, slug, `https://${slug}.example/`, now],
    );
    blogId = blog.insertId;
    const [otherBlog] = await pool.execute<ResultSetHeader>(
      "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)",
      [`${slug}-other`, `${slug}-other`, `https://${slug}-other.example/`, now],
    );
    otherBlogId = otherBlog.insertId;
    const [author] = await pool.execute<ResultSetHeader>(
      "INSERT INTO authors(display_name,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,'candidate',?,?,?,?)",
      [slug, now, now, now, now],
    );
    authorId = author.insertId;
    await pool.execute(
      "INSERT INTO blog_authors(blog_id,author_id,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,'active',?,?,?,?)",
      [blogId, authorId, now, now, now, now],
    );
    const [tag] = await pool.execute<ResultSetHeader>(
      "INSERT INTO tags(slug,label,normalized_label,status,visibility,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,'active','public',?,?,?,?)",
      [slug, slug, slug, now, now, now, now],
    );
    tagId = tag.insertId;
    for (const [index, published] of [past, null, future].entries()) {
      const url = `https://${slug}.example/${index}`;
      const [post] = await pool.execute<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
        [blogId, url, url, `${slug}-${index}`, published, now],
      );
      const postId = post.insertId;
      posts.push(postId);
      await pool.execute(
        'INSERT INTO post_authors(post_id,author_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        [postId, authorId, now, now, now, now],
      );
      await pool.execute(
        "INSERT INTO content_post_bodies(post_id,blog_id,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage) VALUES (?,?,'full','ok','rss-content',?,?,'fixture','fixture',1,?,?,?,'fixture')",
        [postId, blogId, url, url, now, now, now],
      );
      await pool.execute(
        "INSERT INTO relation_observations(post_id,blog_id,status,parser_version,observed_at,last_success_at,next_attempt_at,published_at) VALUES (?,?,'ok','fixture',?,?,?,?)",
        [postId, blogId, now, now, now, published],
      );
      await pool.execute(
        "INSERT INTO relation_links(source_post_id,source_blog_id,ordinal,target_url,target_reason,anchor_text,context,location,observed_at,resolution_checked_at) VALUES (?,?,0,?,'publication-home','fixture','fixture','body',?,?)",
        [postId, blogId, `https://unresolved-${slug}.example/`, now, now],
      );
    }
    await pool.execute('INSERT INTO post_tags(post_id,tag_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?)', [
      posts[2],
      tagId,
      now,
      now,
      now,
      now,
    ]);
    const overview = await loadOverview(pool);
    assert.equal(overview.totals.posts, baseline.totals.posts + 2);
    assert.equal(overview.blogs.find((b: { id: number }) => b.id === blogId)?.postCount, 2);
    assert.equal(Number(overview.authors.find((a: { id: number }) => a.id === authorId)?.postCount), 2);
    assert.ok(!overview.tags.some((t: { slug: string }) => t.slug === slug), 'future-only tag excluded');
    const tagResponse = await app.inject(`/api/tags/${slug}`);
    assert.equal(tagResponse.statusCode, 200, tagResponse.body);
    assert.deepEqual(tagResponse.json().posts, []);
    assert.deepEqual(tagResponse.json().blogs, [], 'future-only post cannot establish a public blog/tag relationship');
    await pool.execute(
      "INSERT INTO blog_tags(blog_id,tag_id,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,'active',?,?,?,?)",
      [blogId, tagId, now, now, now, now],
    );
    const detail = await app.inject(`/api/blogs/${slug}`);
    assert.equal(detail.statusCode, 200, detail.body);
    assert.equal(
      Number(detail.json().blog.tags.find((t: { slug: string }) => t.slug === slug)?.postCount),
      0,
      'tag count ignores future post',
    );
    const catalog = await loadCatalog(pool, { q: slug });
    assert.equal(catalog.blogs[0].postCount, 2);
    assert.equal(catalog.totals.posts, baseline.totals.posts + 2);
    const authors = await loadAuthorCatalog(pool, { author: String(authorId) });
    assert.equal(authors.authors[0].postCount, 2);
    const content = await app.inject(`/api/blogs/${slug}/content`);
    assert.equal(content.statusCode, 200, content.body);
    assert.equal(Number(content.json().sources[0].count), 2);
    const coverage = (await app.inject('/api/content/coverage')).json();
    assert.equal(Number(coverage.totals.posts), baseline.totals.posts + 2);
    const relations = await loadRelationCoverage(pool, blogId);
    assert.equal(relations.totalPosts, 2);
    assert.equal(relations.observedPosts, 2);
    assert.equal(relations.unknownDatePosts, 1);
    assert.equal(relations.unresolvedLinks, 2);
    // A stale/malformed source owner cannot be attributed to either site.
    await pool.execute('UPDATE relation_links SET source_blog_id=? WHERE source_post_id=?', [otherBlogId, posts[0]]);
    assert.equal((await loadRelationCoverage(pool, blogId)).unresolvedLinks, 1);
    assert.equal((await loadRelationCoverage(pool, otherBlogId)).unresolvedLinks, 0);
    await pool.execute('UPDATE relation_links SET source_blog_id=? WHERE source_post_id=?', [blogId, posts[0]]);
    // Becoming published is reflected immediately; no old aggregate is retained.
    await pool.execute('UPDATE posts SET published_at=? WHERE id=?', [past, posts[2]]);
    const visible = await loadOverview(pool);
    assert.equal(visible.totals.posts, baseline.totals.posts + 3);
    assert.ok(visible.tags.some((t: { slug: string }) => t.slug === slug));
    assert.equal((await loadRelationCoverage(pool, blogId)).unresolvedLinks, 3);
    return { futureExcluded: true, undatedIncluded: true, publishedImmediatelyVisible: true, originalFutureRowRetained: true };
  } finally {
    await app.close();
    if (posts.length)
      for (const table of ['post_tags', 'post_authors', 'content_post_bodies', 'relation_observations'])
        await pool.query(`DELETE FROM ${table} WHERE post_id IN (?)`, [posts]);
    if (posts.length) {
      await pool.query('DELETE FROM relation_links WHERE source_post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogId) {
      await pool.query('DELETE FROM blog_authors WHERE blog_id=?', [blogId]);
      await pool.query('DELETE FROM blog_tags WHERE blog_id=?', [blogId]);
    }
    if (authorId) await pool.query('DELETE FROM authors WHERE id=?', [authorId]);
    if (tagId) await pool.query('DELETE FROM tags WHERE id=?', [tagId]);
    if (blogId) await pool.query('DELETE FROM blogs WHERE id=?', [blogId]);
    if (otherBlogId) await pool.query('DELETE FROM blogs WHERE id=?', [otherBlogId]);
  }
}
