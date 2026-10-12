import assert from 'node:assert/strict';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { parseFeed, parseSitemap, parseSitemapArticle, writeFeedEntries } from './feed.ts';
import { parseHistoryWordpress, restoreEntry } from './history-parse.ts';
import type { HistoryTask } from './history-types.ts';

/** Synthetic evidence only; the common runner creates and drops a fresh database on this isolated server. */
export async function runFeedContentIntegration(pool: Pool) {
  const config = (pool as unknown as { pool: { config: { connectionConfig: { host: string; port: number } } } }).pool.config
    .connectionConfig;
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 18169);
  for (const table of ['content_attempts', 'content_post_bodies', 'content_blog_rules'])
    await pool.execute(`SELECT 1 FROM ${table} LIMIT 0`);
  const suffix = Date.now().toString(36),
    home = `https://feed-content-${suffix}.example/`,
    now = new Date();
  const [created] = await pool.execute<ResultSetHeader>(
    "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?, 'Feed content fixture', ?, 'verified', ?)",
    [`feed-content-${suffix}`, home, now],
  );
  const blog = { id: created.insertId, slug: `feed-content-${suffix}`, url: home };
  const source = { url: home + 'feed', type: 'rss' as const };
  let assertions = 0;
  const check = (value: unknown, reason: string) => {
    assert.ok(value, reason);
    assertions++;
  };
  const fullBody = '<p>' + 'Complete article. '.repeat(100) + '</p><a href="https://other.example/post">Later linked blog</a>';
  const xml = (content: string, guid = 'p1', url = home + 'post') =>
    `<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><guid>${guid}</guid><link>${url}</link><title>Body</title><description>Preview</description><content:encoded><![CDATA[${content}]]></content:encoded></item></channel></rss>`;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.execute('SELECT id FROM blogs WHERE id=? FOR UPDATE', [blog.id]);
    await writeFeedEntries(c, blog, source, parseFeed(xml(fullBody), source.url), now);
    await c.rollback();
    const [[rollbackPosts]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM posts WHERE blog_id=?', [blog.id]);
    const [[rollbackBodies]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM content_post_bodies WHERE blog_id=?', [blog.id]);
    check(rollbackPosts.n === 0 && rollbackBodies.n === 0, 'post and private body roll back together');
    const save = async (entries: Parameters<typeof writeFeedEntries>[3], at = new Date()) => {
      await c.beginTransaction();
      try {
        await c.execute('SELECT id FROM blogs WHERE id=? FOR UPDATE', [blog.id]);
        await writeFeedEntries(c, blog, source, entries, at);
        await c.commit();
      } catch (error) {
        await c.rollback();
        throw error;
      }
    };
    await save(parseFeed(xml(fullBody), source.url));
    const [[first]] = await pool.query<RowDataPacket[]>(
      'SELECT p.id,p.summary,p.guid,c.body_text,c.body_html,c.completeness,c.source_kind,c.revision FROM posts p JOIN content_post_bodies c ON c.post_id=p.id WHERE p.blog_id=?',
      [blog.id],
    );
    check(first.summary === 'Preview' && !first.summary.includes('Complete article'), 'public summary never receives full body');
    check(
      first.body_text.includes('Later linked blog') && first.body_html.includes('https://other.example/post'),
      'private evidence preserves distant prose and links',
    );
    check(first.completeness === 'full' && first.source_kind === 'rss-content', 'publisher full content is marked accurately');
    await save(
      parseFeed(xml('<p>Updated full body</p>', 'changed-guid', home + 'post?utm_source=test'), source.url),
      new Date(now.getTime() + 1000),
    );
    const [[updated]] = await pool.query<RowDataPacket[]>(
      'SELECT p.id,p.guid,c.body_text,c.revision FROM posts p JOIN content_post_bodies c ON c.post_id=p.id WHERE p.blog_id=?',
      [blog.id],
    );
    check(updated.id === first.id && updated.guid === first.guid, 'URL identity reuses post despite changed feed GUID');
    check(
      updated.body_text.includes('Updated full body') && updated.revision > first.revision,
      'same post body refreshes independently from preview',
    );
    const [partial] = parseFeed(
      `<rss><channel><item><guid>p1</guid><link>${home}post</link><title>Body</title><description>Short excerpt</description></item></channel></rss>`,
      source.url,
    );
    await save([partial], new Date(now.getTime() + 2000));
    const [[retained]] = await pool.query<RowDataPacket[]>('SELECT body_text,completeness FROM content_post_bodies WHERE post_id=?', [
      first.id,
    ]);
    check(
      retained.completeness === 'full' && retained.body_text.includes('Updated full body'),
      'an excerpt never replaces verified full body',
    );
    const task: HistoryTask = {
      id: 'wp',
      blogId: blog.id,
      kind: 'wordpress',
      url: home + 'wp-json/wp/v2/posts?page=1',
      sourceUrl: home,
      sourceType: 'wordpress',
      depth: 0,
      status: 'pending',
    };
    const wp = parseHistoryWordpress(
      JSON.stringify([
        {
          type: 'post',
          status: 'publish',
          link: home + 'wp',
          title: { rendered: 'WP' },
          excerpt: { rendered: 'WP preview' },
          content: { rendered: '<p>WordPress complete</p>', protected: false },
        },
      ]),
      task,
      blog,
      task.url,
      new Headers({ 'x-wp-totalpages': '1' }),
    );
    await save(wp.tasks.filter((t) => t.kind === 'entry').map((t) => restoreEntry(JSON.parse(JSON.stringify(t.payload!.entry!)))));
    const [[wpBody]] = await pool.query<RowDataPacket[]>(
      'SELECT c.source_kind,c.completeness,c.body_text,p.summary FROM content_post_bodies c JOIN posts p ON p.id=c.post_id WHERE p.blog_id=? AND p.url=?',
      [blog.id, home + 'wp'],
    );
    check(
      wpBody.source_kind === 'wordpress-api' &&
        wpBody.completeness === 'full' &&
        wpBody.body_text === 'WordPress complete' &&
        wpBody.summary === 'WP preview',
      'durable WordPress payload supplies full content with no article fetch',
    );
    await save(parseFeed(xml('<img src="https://images.example/photo.png">', 'image', home + 'image'), source.url));
    const [[image]] = await pool.query<RowDataPacket[]>(
      'SELECT c.image_only,c.completeness,c.body_html FROM content_post_bodies c JOIN posts p ON p.id=c.post_id WHERE p.blog_id=? AND p.url=?',
      [blog.id, home + 'image'],
    );
    check(
      image.image_only && image.completeness === 'full' && image.body_html.includes('images.example'),
      'image-only full entry remains valid',
    );
    const sitemapA = home + 'sitemap-a',
      sitemapB = home + 'sitemap-b';
    const candidate = parseSitemap(`<urlset><url><loc>${sitemapA}</loc></url></urlset>`, home)[0];
    const correct = parseSitemapArticle(
      `<link rel="canonical" href="${sitemapA}"><meta property="og:type" content="article"><title>Original A</title><article><p>Correct body A</p></article>`,
      candidate,
      sitemapA,
    );
    check(Boolean(correct), 'initial sitemap article A verified');
    await save([correct!]);
    const [[beforeRedirect]] = await pool.query<RowDataPacket[]>(
      'SELECT p.id,p.guid,p.url,c.body_text,c.revision FROM posts p JOIN content_post_bodies c ON c.post_id=p.id WHERE p.blog_id=? AND p.url=?',
      [blog.id, sitemapA],
    );
    const redirected = parseSitemapArticle(
      `<link rel="canonical" href="${sitemapB}"><meta property="og:type" content="article"><title>Unrelated B</title><article><p>Wrong body B</p></article>`,
      candidate,
      sitemapB,
    );
    check(redirected === null, 'A to B redirect cannot retain the A GUID');
    await save(redirected ? [redirected] : []);
    const [[afterRedirect]] = await pool.query<RowDataPacket[]>(
      'SELECT p.id,p.guid,p.url,c.body_text,c.revision FROM posts p JOIN content_post_bodies c ON c.post_id=p.id WHERE p.id=?',
      [beforeRedirect.id],
    );
    check(
      afterRedirect.url === sitemapA &&
        afterRedirect.guid === sitemapA &&
        afterRedirect.body_text === 'Correct body A' &&
        afterRedirect.revision === beforeRedirect.revision,
      'existing A metadata and body remain unchanged after cross-article redirect',
    );
    const [[wrongPost]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM posts WHERE blog_id=? AND url=?', [blog.id, sitemapB]);
    check(wrongPost.n === 0, 'redirect destination not silently imported');
    return {
      assertions,
      transactional: true,
      summarySeparate: true,
      feedUpdate: true,
      partialNoDowngrade: true,
      wordpressNoExtraFetch: true,
      imageOnly: true,
    };
  } finally {
    await c.rollback();
    c.release();
    for (const table of ['content_attempts', 'content_post_bodies', 'content_blog_rules'])
      await pool.execute(`DELETE FROM ${table} WHERE blog_id=?`, [blog.id]);
    await pool.execute('DELETE FROM posts WHERE blog_id=?', [blog.id]);
    await pool.execute('DELETE FROM blogs WHERE id=?', [blog.id]);
  }
}
