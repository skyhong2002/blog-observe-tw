/** Optional real SQL entry; runner must supply its guarded disposable database. Not run by implementation task. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { loadSharedTags } from './shared-tags.ts';
export async function runSharedTagsIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const key = `shared-${randomBytes(6).toString('hex')}`,
    now = new Date(),
    blogs: number[] = [],
    posts: number[] = [],
    tags: number[] = [];
  let assertions = 0;
  const check = (v: unknown) => {
    assert.ok(v);
    assertions++;
  };
  try {
    for (let i = 0; i < 2; i++) {
      const [b] = await pool.query<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)", [
        `${key}-${i}`,
        key,
        `https://${key}-${i}.example/`,
        now,
      ]);
      blogs.push(b.insertId);
      const [p] = await pool.query<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
        [b.insertId, key, `https://${key}-${i}.example/post`, key, new Date(now.getTime() - 3600000), now],
      );
      posts.push(p.insertId);
    }
    const [t] = await pool.query<ResultSetHeader>(
      "INSERT INTO tags(slug,label,visibility,status,source_type,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,'public','active','crawler',?,?,?,?)",
      [key, '共同原始標籤', now, now, now, now],
    );
    tags.push(t.insertId);
    for (const p of posts)
      await pool.query(
        "INSERT INTO post_tags(post_id,tag_id,status,source_type,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,'active','feed',?,?,?,?)",
        [p, t.insertId, now, now, now, now],
      );
    const read = () => loadSharedTags(pool, { sourceBlogId: blogs[0], days: 7 });
    const count = async () => {
      const r = await read();
      assert.equal(r.status, 'ready');
      return r.status === 'ready' ? r.items.length : -1;
    };
    check((await count()) === 1);
    for (const b of blogs) {
      for (const status of ['seed', 'rejected', 'moved']) {
        await pool.query('UPDATE blogs SET status=? WHERE id=?', [status, b]);
        check((await count()) === 0);
      }
      await pool.query("UPDATE blogs SET status='verified' WHERE id=?", [b]);
    }
    await pool.query("UPDATE tags SET visibility='private' WHERE id=?", tags);
    check((await count()) === 0);
    await pool.query("UPDATE tags SET visibility='public',status='candidate' WHERE id=?", tags);
    check((await count()) === 0);
    await pool.query("UPDATE tags SET status='active' WHERE id=?", tags);
    for (const p of posts) {
      await pool.query('UPDATE posts SET published_at=? WHERE id=?', [new Date('2099-01-01'), p]);
      check((await count()) === 0);
      await pool.query('UPDATE posts SET published_at=? WHERE id=?', [new Date(now.getTime() - 3600000), p]);
      await pool.query("UPDATE post_tags SET status='candidate' WHERE post_id=?", [p]);
      check((await count()) === 0);
      await pool.query("UPDATE post_tags SET status='active' WHERE post_id=?", [p]);
    }
    await pool.query('DELETE FROM posts WHERE id=?', [posts[1]]);
    check((await count()) === 0);
    return { assertions, matchVersion: 'native-post-tags-v1', realSql: true, productionCostMeasured: false };
  } finally {
    if (posts.length) await pool.query('DELETE FROM post_tags WHERE post_id IN (?)', [posts]);
    if (tags.length) await pool.query('DELETE FROM tags WHERE id IN (?)', [tags]);
    if (posts.length) await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
