/** Actual SQL oracle, run only through the existing disposable 18169 integration runner. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { backgroundExcludedSql, nativeLabelCte, nativeLabelJoin, windowGateCtes } from './display-gate.ts';

export async function runDisplayGateIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const cases = [];
  // Same six article hits, 3/2/1 across blogs; one title/body overlap.
  // Corpus sizes straddle the exact 2% threshold, using production gate SQL.
  for (const denominator of [301, 300, 299]) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `WITH RECURSIVE scoped_posts AS (SELECT 1 id UNION ALL SELECT id+1 FROM scoped_posts WHERE id<?),
      raw_evidence AS (
        SELECT 1 post_id,1 blog_id,'term' topic_id,1 title_hit UNION ALL
        SELECT 1,1,'term',0 UNION ALL SELECT 2,1,'term',0 UNION ALL SELECT 3,1,'term',0 UNION ALL
        SELECT 4,2,'term',1 UNION ALL SELECT 5,2,'term',0 UNION ALL SELECT 6,3,'term',0
      ), evidence AS (
        SELECT post_id,blog_id,topic_id,MAX(title_hit) title_hit FROM raw_evidence GROUP BY post_id,blog_id,topic_id
      ), ${windowGateCtes()}
      SELECT (SELECT COUNT(*) FROM evidence) matched,COUNT(*) recent,SUM(title_hit) title_posts FROM recent`,
      [denominator],
    );
    assert.equal(Number(rows[0].matched), 6, 'overlap must count one article before document frequency');
    assert.equal(Number(rows[0].recent), denominator < 300 ? 2 : 6, 'only strictly above threshold drops body evidence');
    assert.equal(Number(rows[0].title_posts), 2, 'title evidence remains');
    cases.push({ denominator, matched: 6, recent: Number(rows[0].recent), titlePosts: 2 });
  }
  const key = randomUUID(),
    label = `background-${key}`;
  const blogs: number[] = [],
    posts: number[] = [];
  let tagId = 0;
  const now = new Date();
  const backgroundCases: boolean[] = [];
  try {
    for (let b = 0; b < 4; b++) {
      const [blog] = await pool.execute<ResultSetHeader>(
        "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)",
        [`background-${key}-${b}`, 'fixture', `https://background-${b}.example/`, now],
      );
      blogs.push(blog.insertId);
      for (let p = 0; p < (b < 3 ? 3 : 1); p++) {
        const [post] = await pool.execute<ResultSetHeader>(
          'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
          [blog.insertId, `${key}-${b}-${p}`, `https://background-${b}.example/${p}`, 'fixture', now, now],
        );
        posts.push(post.insertId);
      }
    }
    const [tag] = await pool.execute<ResultSetHeader>(
      "INSERT INTO tags(slug,label,normalized_label,status,source_type,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,'active','crawler',?,?,?,?)",
      [label, label, label, now, now, now, now],
    );
    tagId = tag.insertId;
    const checkBackground = async (expected: boolean) => {
      const [[row]] = await pool.query<RowDataPacket[]>(
        `WITH scoped_posts AS (SELECT p.id,p.blog_id FROM posts p JOIN blogs b ON b.id=p.blog_id
         WHERE b.status='verified' AND p.published_at<=? AND b.slug LIKE ?),
         ${nativeLabelCte}, counts AS (SELECT blog_id,COUNT(*) n FROM scoped_posts GROUP BY blog_id)
         SELECT ${backgroundExcludedSql} excluded FROM
         (SELECT COUNT(*) blogs,SUM(n>=2) twice_sources,MAX(n) peak_posts FROM counts) wf
         CROSS JOIN (SELECT 'fixture' snapshot_id) fr CROSS JOIN (SELECT 12 matched_posts,3 title_posts) f
         CROSS JOIN (SELECT ? normalized_label) display_term ${nativeLabelJoin}`,
        [now, `background-${key}-%`, label],
      );
      assert.equal(Boolean(Number(row.excluded)), expected);
      backgroundCases.push(expected);
    };
    await checkBackground(true);
    await pool.execute('INSERT INTO post_tags(post_id,tag_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?)', [
      posts[3],
      tagId,
      now,
      now,
      now,
      now,
    ]);
    await checkBackground(false); // One site's original topic label suffices; no word-name exemptions.
    await pool.execute("UPDATE post_tags SET source_type='community' WHERE tag_id=?", [tagId]);
    await checkBackground(true);
    await pool.execute("UPDATE post_tags SET source_type='crawler',role='identity' WHERE tag_id=?", [tagId]);
    await checkBackground(true);
    await pool.execute("UPDATE post_tags SET role='topic' WHERE tag_id=?", [tagId]);
    await pool.execute("UPDATE tags SET kind='identity' WHERE id=?", [tagId]);
    await checkBackground(true);
    await pool.execute("UPDATE tags SET kind='topic' WHERE id=?", [tagId]);
    await checkBackground(false);
    await pool.execute("UPDATE post_tags SET status='hidden' WHERE tag_id=?", [tagId]);
    await checkBackground(true);
    await pool.execute("UPDATE post_tags SET status='active' WHERE tag_id=?", [tagId]);
    await pool.execute("UPDATE blogs SET status='seed' WHERE id=?", [blogs[1]]);
    await checkBackground(true);
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [blogs[1]]);
    await pool.execute('UPDATE posts SET published_at=? WHERE id=?', [new Date(now.getTime() + 60_000), posts[3]]);
    await checkBackground(true);
    return { cases, backgroundCases, assertions: 9 + backgroundCases.length, actualSql: true, uiOrBuildClaim: false };
  } finally {
    if (tagId) {
      await pool.execute('DELETE FROM post_tags WHERE tag_id=?', [tagId]);
      await pool.execute('DELETE FROM tags WHERE id=?', [tagId]);
    }
    if (posts.length) await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
