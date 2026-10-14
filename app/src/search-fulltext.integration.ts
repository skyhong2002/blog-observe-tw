import assert from 'node:assert/strict';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../tests/integration/guard.mjs';
import { loadFulltextSearch, indexFulltextPosts, runFulltextBatch, indexMissingFulltextPosts } from './search-fulltext.ts';
export async function runFulltextIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  let checks = 0;
  const check = (v: unknown) => {
    assert.ok(v);
    checks++;
  };
  const [b] = await pool.query<ResultSetHeader>(
    "INSERT INTO blogs(slug,name,url,status,status_label,discovered_at) VALUES('fulltext-fixture','網站','https://anise.tw/','verified','fixture',UTC_TIMESTAMP())",
  );
  const [p] = await pool.query<ResultSetHeader>(
    "INSERT INTO posts(blog_id,guid,url,title,summary,published_at,created_at) VALUES(?,?,'https://anise.tw/290726','一般標題','摘要','2025-01-01',UTC_TIMESTAMP())",
    [b.insertId, 'fulltext-fixture'],
  );
  const id = p.insertId;
  const body = '正文'.repeat(3000) + '後段蛤蜊絲瓜和10%_=很好吃。😀圖片文';
  await pool.query(
    `INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage)
 VALUES(?,?,?,?,'full','ok','rss-content','https://anise.tw/feed','https://anise.tw/290726','fixture','v1',1,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP(),'fixture')`,
    [id, b.insertId, body, 'a'.repeat(64)],
  );
  await indexFulltextPosts(pool, [id]);
  await pool.query('INSERT INTO posts(blog_id,guid,url,title,created_at) VALUES ?', [
    Array.from({ length: 1001 }, (_, n) => [b.insertId, `filler-${n}`, `https://anise.tw/filler-${n}`, '無關文章', new Date()]),
  ]);
  check((await indexFulltextPosts(pool, [id]))[0].unchanged === true);
  check((await indexMissingFulltextPosts(pool, id + 1001, 10)).items.length === 0);
  const f = { q: '蛤蜊絲瓜', blog: 'fulltext-fixture', page: 1, limit: 20 };
  const read = () => loadFulltextSearch(pool, f);
  let r = await read();
  check(r.items.length === 1);
  check(r.items[0].snippet.includes(f.q));
  check(r.items[0].contextSource === 'body');
  check(r.items[0].articleId === id);
  check(r.items[0].matchVersion === 'nfkc-bigram-whole-body-v1');
  check(r.items[0].snippet.length <= 241);
  for (const q of ['絲瓜', '10%_=', '😀圖片']) check((await loadFulltextSearch(pool, { ...f, q })).items.length === 1);
  // Hold A's final actual SQL result at a barrier; B starts only after withdrawal commits.
  const events: { state: string; event: string; utc: string }[] = [];
  for (const state of ['seed', 'rejected', 'moved', 'future']) {
    let reached!: () => void, release!: () => void;
    const oldRead = new Promise<void>((resolve) => {
        reached = resolve;
      }),
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    const held = {
      query: async (...args: Parameters<Pool['query']>) => {
        const result = await (pool.query as Function)(...args);
        if (String(args[0]).includes('i.metadata_hash metadataHash')) {
          events.push({ state, event: 'oldRead', utc: new Date().toISOString() });
          reached();
          await gate;
        }
        return result;
      },
    } as Pool;
    const a = loadFulltextSearch(held, f);
    await oldRead;
    if (state === 'future') await pool.query("UPDATE posts SET published_at='2099-01-01' WHERE id=?", [id]);
    else await pool.query('UPDATE blogs SET status=? WHERE id=?', [state, b.insertId]);
    events.push({ state, event: 'commit', utc: new Date().toISOString() });
    const fresh = await read();
    events.push({ state, event: 'B complete', utc: new Date().toISOString() });
    check(fresh.items.length === 0);
    release();
    check((await a).items.length === 1);
    events.push({ state, event: 'A complete', utc: new Date().toISOString() });
    await pool.query("UPDATE blogs SET status='verified' WHERE id=?", [b.insertId]);
    await pool.query("UPDATE posts SET published_at='2025-01-01' WHERE id=?", [id]);
  }
  // Stale body hash and stale metadata fail closed, even when a content revision was not bumped.
  await pool.query('UPDATE content_post_bodies SET body_text=? WHERE post_id=?', ['蛤蜊絲瓜已改', id]);
  const stale = await read();
  check(stale.items.length === 0);
  const absent = await loadFulltextSearch(pool, { ...f, q: '永不匹配的字串' });
  check(JSON.stringify(stale.coverage) === JSON.stringify(absent.coverage));
  await indexFulltextPosts(pool, [id]);
  check((await read()).items.length === 1);
  await pool.query("UPDATE content_post_bodies SET article_url='https://anise.tw/other' WHERE post_id=?", [id]);
  check((await read()).items.length === 0);
  await pool.query("UPDATE posts SET title='標題有蛤蜊絲瓜' WHERE id=?", [id]);
  await indexFulltextPosts(pool, [id]);
  check((await read()).items[0].contextSource === 'title');
  await pool.query("UPDATE posts SET title='已撤下詞' WHERE id=?", [id]);
  check((await read()).items.length === 0);
  await pool.query('UPDATE content_post_bodies SET article_url=?,body_text=? WHERE post_id=?', [
    'https://anise.tw/290726',
    '換行 蛤蜊\n\t絲瓜',
    id,
  ]);
  await indexFulltextPosts(pool, [id]);
  check((await loadFulltextSearch(pool, { ...f, q: '蛤蜊 絲瓜' })).items.length === 1);
  await pool.query('DELETE FROM posts WHERE id=?', [id]);
  const [remaining] = await pool.query('SELECT post_id FROM post_search_documents WHERE post_id=?', [id]);
  check((remaining as unknown[]).length === 0);
  check((await read()).items.length === 0);
  check((await runFulltextBatch(pool, { after: id + 1001, limit: 10 })).done);
  return { checks, wholeBody: true, beyond4096: true, shortChineseQuery: true, currentPrivacy: true, events };
}
