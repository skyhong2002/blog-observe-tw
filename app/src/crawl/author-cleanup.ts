// One-off repair for author rows written before author-name.ts: addresses (`noreply@blogger.com (Name)`), escaped
// entities and placeholders (Unknown, admin). Manual and community rows are never touched.
import type { Pool } from 'mysql2/promise';
import { cleanAuthorName, normalizedAuthorName } from './author-name.ts';

type AuthorRow = { id: number; displayName: string; blogIds: string | null };
export type AuthorCleanupPlan = {
  renamed: { id: number; to: string }[];
  merged: { id: number; into: number }[];
  rejected: { id: number }[];
  posts: { ids: number[]; to: string | null }[];
};

/** Rows a cleanup would change; the SQL filter is wider than needed, cleanAuthorName decides. */
const SUSPECT = `(a.display_name LIKE '%@%' OR a.display_name LIKE '%&%;%' OR a.display_name LIKE 'http%'
  OR LOWER(TRIM(a.display_name)) IN ('unknown','anonymous','admin','administrator','author','editor','webmaster','root',
  'guest','user','null','undefined','none','n/a','匿名','管理員','管理员','未知'))`;

export async function planAuthorCleanup(pool: Pick<Pool, 'query'>): Promise<AuthorCleanupPlan> {
  const [rows] = await pool.query(
    `SELECT a.id,a.display_name AS displayName,GROUP_CONCAT(ba.blog_id) AS blogIds FROM authors a
       LEFT JOIN blog_authors ba ON ba.author_id=a.id
       WHERE a.source_type NOT IN ('manual','community') AND ${SUSPECT} GROUP BY a.id ORDER BY a.id`,
  );
  const plan: AuthorCleanupPlan = { renamed: [], merged: [], rejected: [], posts: [] };
  // Two address rows can clean to one name on one blog: the later one merges into the first.
  const planned = new Map<string, number>();
  for (const row of rows as AuthorRow[]) {
    const name = cleanAuthorName(row.displayName);
    if (name === row.displayName) continue;
    if (!name) {
      plan.rejected.push({ id: row.id });
      continue;
    }
    // The same person may already have a clean row on the blog (e.g. `carol` from another feed).
    const blogIds = (row.blogIds ?? '').split(',').filter(Boolean).map(Number);
    const [twins] = blogIds.length
      ? await pool.query(
          `SELECT a.id FROM authors a JOIN blog_authors ba ON ba.author_id=a.id
             WHERE ba.blog_id IN (?) AND a.normalized_name=? AND a.id<>? AND a.status<>'rejected' ORDER BY a.id LIMIT 1`,
          [blogIds, normalizedAuthorName(name), row.id],
        )
      : [[]];
    const keys = blogIds.map((blogId) => `${blogId}\n${normalizedAuthorName(name)}`);
    const into = (twins as { id: number }[])[0]?.id ?? keys.map((key) => planned.get(key)).find(Boolean);
    if (into) plan.merged.push({ id: row.id, into });
    else {
      plan.renamed.push({ id: row.id, to: name });
      for (const key of keys) planned.set(key, row.id);
    }
  }
  const [posts] = await pool.query(
    `SELECT id,author FROM posts WHERE author LIKE '%@%' OR author LIKE '%&%;%' OR author LIKE 'http%'
       OR LOWER(TRIM(author)) IN ('unknown','anonymous','admin','administrator','author','editor','webmaster','root','guest',
       'user','null','undefined','none','n/a','匿名','管理員','管理员','未知')`,
  );
  const byName = new Map<string | null, number[]>();
  for (const post of posts as { id: number; author: string }[]) {
    const name = cleanAuthorName(post.author);
    if (name === post.author) continue;
    byName.set(name, [...(byName.get(name) ?? []), post.id]);
  }
  plan.posts = [...byName].map(([to, ids]) => ({ to, ids }));
  return plan;
}

const CHUNK = 500;
/** Each author is repaired in its own short transaction, so the shared database is never locked for long. */
export async function applyAuthorCleanup(pool: Pool, plan: AuthorCleanupPlan, now = new Date()) {
  const inTransaction = async (work: (connection: Awaited<ReturnType<Pool['getConnection']>>) => Promise<void>) => {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await work(connection);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
  for (const { id, to } of plan.renamed)
    await pool.execute('UPDATE authors SET display_name=?,normalized_name=?,updated_at=? WHERE id=?', [
      to,
      normalizedAuthorName(to),
      now,
      id,
    ]);
  for (const { id, into } of plan.merged)
    await inTransaction(async (connection) => {
      await connection.execute(
        `INSERT IGNORE INTO post_authors (post_id,author_id,role,position,status,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,updated_at)
           SELECT post_id,?,role,position,status,source_type,source_url,source_evidence,first_seen_at,last_seen_at,created_at,? FROM post_authors WHERE author_id=?`,
        [into, now, id],
      );
      await connection.execute('DELETE FROM post_authors WHERE author_id=?', [id]);
      await connection.execute("UPDATE blog_authors SET status='rejected',updated_at=? WHERE author_id=?", [now, id]);
      // The address goes too: a merged row keeps only the name it was merged under.
      await connection.execute(
        "UPDATE authors a JOIN authors i ON i.id=? SET a.display_name=i.display_name,a.normalized_name=i.normalized_name,a.status='rejected',a.merge_status='merged',a.merged_into_id=i.id,a.updated_at=? WHERE a.id=?",
        [into, now, id],
      );
    });
  for (const { id } of plan.rejected)
    await inTransaction(async (connection) => {
      await connection.execute("UPDATE post_authors SET status='rejected',updated_at=? WHERE author_id=?", [now, id]);
      await connection.execute("UPDATE blog_authors SET status='rejected',updated_at=? WHERE author_id=?", [now, id]);
      await connection.execute("UPDATE authors SET display_name='',normalized_name='',status='rejected',updated_at=? WHERE id=?", [
        now,
        id,
      ]);
    });
  for (const { ids, to } of plan.posts)
    for (let index = 0; index < ids.length; index += CHUNK)
      await pool.query('UPDATE posts SET author=? WHERE id IN (?)', [to, ids.slice(index, index + CHUNK)]);
}
