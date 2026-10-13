/** Small real-SQL fixture on the pre-existing isolated DB server, never production. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../tests/integration/guard.mjs';
import { loadSearch } from './search.ts';
import { BODY_INDEX_VERSION } from './search-body-index.ts';
import { boundedSearchStatement } from './search-bounds.ts';
import { produceBodySearchIndex } from './search-index-producer.ts';

export async function runSearchIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const key = `search-${randomBytes(6).toString('hex')}`;
  const now = new Date();
  // Synthetic content/byline; a known original URL is not proof of a live fetch.
  const home = 'https://anise.tw/';
  const originalUrl = 'https://anise.tw/290726';
  const filters = { q: '蛤蜊絲瓜', page: 1, limit: 20, blog: key };
  let blogId = 0;
  let indexedPostId = 0;
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
    indexedPostId = id;
    const text = '前文'.repeat(60) + '這道蛤蜊絲瓜和10%_=很好吃。' + '後文'.repeat(400) + 'PRIVATE_BODY_TAIL';
    await pool.query(
      `INSERT INTO content_post_bodies(post_id,blog_id,body_text,body_html,content_hash,completeness,status,source_kind,source_url,article_url,
        adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage)
       VALUES (?,?,?,?,?,'full','ok','rss-content',?,?,'fixture','fixture-v1',1,?,?,?,'syndicated-body-only')`,
      [id, blogId, text, `<p>${text}</p>`, 'c'.repeat(64), home + 'feed', originalUrl, now, now, now],
    );
    check((await produceBodySearchIndex(pool, [id], false)).items[0].status === 'dry-run');
    check((await produceBodySearchIndex(pool, [id], true)).items[0].status === 'stored');
    // Just over the former 1,000-row cutoff; small metadata only, no copied publisher data.
    const rows = Array.from({ length: 1001 }, (_, index) => [blogId, home + index, home + index, '其他文章', now]);
    await pool.query('INSERT INTO posts(blog_id,guid,url,title,created_at) VALUES ?', [rows]);
    check((await loadSearch(pool, filters, { historicalBody: false })).items.length === 0);
    const result = await loadSearch(pool, filters, { historicalBody: true });
    check(result.items.length === 1 && result.items[0].articleId === id);
    check(result.items[0].snippet.includes('蛤蜊絲瓜') && result.items[0].contextSource === 'body');
    check(result.items[0].matchVersion === BODY_INDEX_VERSION);
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
    // Explicit selected apply retires stale postings even when new evidence cannot be indexed.
    const postingCount = async () => {
      const [[count]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM post_body_search_terms WHERE post_id=?', [id]);
      return Number(count.n);
    };
    check((await postingCount()) > 0);
    await pool.query('UPDATE content_post_bodies SET body_text=? WHERE post_id=?', ['x'.repeat(65537), id]);
    check((await produceBodySearchIndex(pool, [id], true)).items[0].status === 'overcap');
    check((await postingCount()) === 0);
    await pool.query('UPDATE content_post_bodies SET body_text=? WHERE post_id=?', [text, id]);
    check((await produceBodySearchIndex(pool, [id], true)).items[0].status === 'stored');
    await pool.query("UPDATE content_post_bodies SET status='partial' WHERE post_id=?", [id]);
    check((await produceBodySearchIndex(pool, [id], true)).items[0].status === 'unindexed');
    check((await postingCount()) === 0);
    await pool.query("UPDATE content_post_bodies SET status='ok' WHERE post_id=?", [id]);
    check((await produceBodySearchIndex(pool, [id], true)).items[0].status === 'stored');

    for (const status of ['seed', 'rejected', 'moved']) {
      await pool.query('UPDATE blogs SET status=? WHERE id=?', [status, blogId]);
      check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    }
    await pool.query("UPDATE blogs SET status='verified' WHERE id=?", [blogId]);
    await pool.query('UPDATE posts SET published_at=? WHERE id=?', [new Date('2099-01-01'), id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE posts SET published_at=NULL WHERE id=?', [id]);
    for (const state of ['missing', 'partial']) {
      await pool.query('UPDATE content_post_bodies SET status=? WHERE post_id=?', [state, id]);
      check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    }
    await pool.query("UPDATE content_post_bodies SET status='ok',source_url=? WHERE post_id=?", ['https://other.example/private', id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE content_post_bodies SET source_url=? WHERE post_id=?', [home + 'feed', id]);
    await pool.query('UPDATE content_post_bodies SET blog_id=? WHERE post_id=?', [blogId + 9999, id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE content_post_bodies SET blog_id=?,body_text=? WHERE post_id=?', [
      blogId,
      '蛤蜊絲瓜內容已改但revision未改',
      id,
    ]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE content_post_bodies SET body_text=?,content_hash=? WHERE post_id=?', ['正文已修訂', 'd'.repeat(64), id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE posts SET title=? WHERE id=?', ['標題有蛤蜊絲瓜', id]);
    // Explicitly scoped old body query is not an all-history metadata index: test metadata on a recent row.
    const [[newest]] = await pool.query<RowDataPacket[]>('SELECT MAX(id) id FROM posts WHERE blog_id=?', [blogId]);
    await pool.query('UPDATE posts SET title=? WHERE id=?', ['標題有蛤蜊絲瓜', newest.id]);
    const metadata = await loadSearch(pool, filters, { historicalBody: true });
    check(metadata.items.length === 1 && metadata.items[0].contextSource === 'title');
    await pool.query('DELETE FROM posts WHERE id=?', [newest.id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    await pool.query('UPDATE content_post_bodies SET body_text=?,content_hash=? WHERE post_id=?', [text, 'e'.repeat(64), id]);
    check((await produceBodySearchIndex(pool, [id], true)).items[0].status === 'stored');
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 1);
    await pool.query('DELETE FROM posts WHERE id=?', [id]);
    check((await loadSearch(pool, filters, { historicalBody: true })).items.length === 0);
    return {
      assertions,
      fixturePosts: 1002,
      elapsedMs: Math.round(performance.now() - started),
      deadlineSeconds: 0.25,
      realSql: true,
      productionCostMeasured: false,
      fullTextIndex: false,
      boundedPrefixPostingIndex: true,
      indexVersion: BODY_INDEX_VERSION,
      syntheticInputs: true,
      realCapture: false,
      originalUrl,
      byline: 'luckbear',
      publicationName: '愛吃鬼芸芸',
    };
  } finally {
    if (indexedPostId) await pool.query('DELETE FROM post_body_search_terms WHERE post_id=?', [indexedPostId]);
    if (blogId) {
      await pool.query('DELETE c FROM content_post_bodies c JOIN posts p ON p.id=c.post_id WHERE p.blog_id=?', [blogId]);
      await pool.query('DELETE FROM posts WHERE blog_id=?', [blogId]);
      await pool.query('DELETE FROM blogs WHERE id=?', [blogId]);
    }
  }
}
