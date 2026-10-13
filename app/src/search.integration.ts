/** Small real-SQL fixture on the pre-existing isolated DB server, never production. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../tests/integration/guard.mjs';
import { loadSearch } from './search.ts';
import { boundedSearchStatement, SEARCH_MATCH_VERSION } from './search-bounds.ts';

export async function runSearchIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const key = `search-${randomBytes(6).toString('hex')}`;
  const now = new Date();
  // Synthetic content/byline; a known original URL is not proof of a live fetch.
  const home = 'https://anise.tw/';
  const originalUrl = 'https://anise.tw/290726';
  const filters = { q: '蛤蜊絲瓜', page: 1, limit: 20, blog: key };
  let blogId = 0;
  let assertions = 0;
  const check = (value: unknown) => {
    assert.ok(value);
    assertions++;
  };
  const started = performance.now();
  try {
    const [[deadline]] = await pool.query<RowDataPacket[]>(boundedSearchStatement('SELECT @@max_statement_time AS seconds', true));
    check(Number(deadline.seconds) === 0.25);
    const [blog] = await pool.query<ResultSetHeader>(
      "INSERT INTO blogs(slug,name,url,status,status_label,discovered_at) VALUES (?,?,?,'verified','fixture',?)",
      [key, '愛吃鬼芸芸', home, now],
    );
    blogId = blog.insertId;
    const [post] = await pool.query<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,summary,author,published_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [blogId, originalUrl, originalUrl, '一般標題', '一般摘要', 'luckbear', new Date('2025-01-01'), now],
    );
    const id = post.insertId;
    const text = '前文'.repeat(60) + '這道蛤蜊絲瓜和10%_=很好吃。' + '後文'.repeat(400) + 'PRIVATE_BODY_TAIL';
    await pool.query(
      `INSERT INTO content_post_bodies(post_id,blog_id,body_text,body_html,completeness,status,source_kind,source_url,article_url,
        adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage)
       VALUES (?,?,?,?,'full','ok','rss-content',?,?,'fixture','fixture-v1',1,?,?,?,'syndicated-body-only')`,
      [id, blogId, text, `<p>${text}</p>`, home + 'feed', originalUrl, now, now, now],
    );
    // Just over the former 1,000-row cutoff; small metadata only, no copied publisher data.
    const rows = Array.from({ length: 1001 }, (_, index) => [blogId, home + index, home + index, '其他文章', now]);
    await pool.query('INSERT INTO posts(blog_id,guid,url,title,created_at) VALUES ?', [rows]);
    check((await loadSearch(pool, filters, { historicalBody: false })).items.length === 0);
    const result = await loadSearch(pool, filters, { historicalBody: true });
    check(result.items.length === 1 && result.items[0].articleId === id);
    check(result.items[0].snippet.includes('蛤蜊絲瓜') && result.items[0].contextSource === 'body');
    check(result.items[0].matchVersion === SEARCH_MATCH_VERSION);
    // publicPost copies these allowlisted runtime fields dynamically. Assert the
    // returned DTO itself, without a type cast or reconstructing fields from SQL.
    assert.partialDeepStrictEqual(result.items[0], {
      url: originalUrl,
      blogSlug: key,
      author: 'luckbear',
      blogName: '愛吃鬼芸芸',
    });
    assertions++;
    check(result.items[0].snippet.includes('這道蛤蜊絲瓜和10%_=很好吃。'));
    check(!JSON.stringify(result).includes('PRIVATE_BODY_TAIL') && Array.from(result.items[0].snippet).length <= 240);
    check((await loadSearch(pool, { ...filters, q: '10%_=' }, { historicalBody: true })).items.length === 1);
    for (const status of ['seed', 'rejected', 'moved']) {
      await pool.query('UPDATE blogs SET status=? WHERE id=?', [status, blogId]);
      check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    }
    await pool.query("UPDATE blogs SET status='verified' WHERE id=?", [blogId]);
    await pool.query('UPDATE posts SET published_at=? WHERE id=?', [new Date('2099-01-01'), id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE posts SET published_at=NULL WHERE id=?', [id]);
    await pool.query('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [blogId + 9999, id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE content_post_bodies SET blog_id=?,body_text=? WHERE post_id=?', [blogId, '正文已修訂', id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE posts SET title=? WHERE id=?', ['標題有蛤蜊絲瓜', id]);
    // Explicitly scoped old body query is not an all-history metadata index: test metadata on a recent row.
    const [[newest]] = await pool.query<RowDataPacket[]>('SELECT MAX(id) id FROM posts WHERE blog_id=?', [blogId]);
    await pool.query('UPDATE posts SET title=? WHERE id=?', ['標題有蛤蜊絲瓜', newest.id]);
    const metadata = await loadSearch(pool, filters, { historicalBody: true });
    check(metadata.items.length === 1 && metadata.items[0].contextSource === 'title');
    await pool.query('DELETE FROM posts WHERE id=?', [newest.id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    return {
      assertions,
      fixturePosts: 1002,
      elapsedMs: Math.round(performance.now() - started),
      deadlineSeconds: 0.25,
      realSql: true,
      productionCostMeasured: false,
      fullTextIndex: false,
      syntheticInputs: true,
      realCapture: false,
      originalUrl,
      byline: 'luckbear',
      publicationName: '愛吃鬼芸芸',
    };
  } finally {
    if (blogId) {
      await pool.query('DELETE c FROM content_post_bodies c JOIN posts p ON p.id=c.post_id WHERE p.blog_id=?', [blogId]);
      await pool.query('DELETE FROM posts WHERE blog_id=?', [blogId]);
      await pool.query('DELETE FROM blogs WHERE id=?', [blogId]);
    }
  }
}
