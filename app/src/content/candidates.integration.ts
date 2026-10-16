/** Run only against an isolated restored database; this suite deliberately writes fixture rows. */
import assert from 'node:assert/strict';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { CONTENT_VERSION } from './contracts.ts';
import { selectContentCandidates } from './worker.ts';

/** The pre-split definition, kept verbatim as the oracle. */
const FULL = `SELECT p.id,p.blog_id,p.url,b.url blog_url,c.etag,c.last_modified,c.status,c.content_hash,c.source_kind,c.source_url
   FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN content_post_bodies c ON c.post_id=p.id
   WHERE b.status='verified' AND (? IS NULL OR p.blog_id=?) AND b.url IS NOT NULL AND (c.post_id IS NULL OR c.next_attempt_at<=? OR (c.adapter_version<>? AND c.source_kind='article-html' AND c.status<>'ok'))
   ORDER BY CASE WHEN c.adapter_version<>? AND c.source_kind='article-html' AND c.status<>'ok' AND c.last_error='content-limit' THEN 0 ELSE 1 END,COALESCE(c.next_attempt_at,'1970-01-01'),p.published_at DESC,p.id DESC LIMIT ?`;

export async function runContentCandidatesIntegration(pool: Pool) {
  const port = (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port;
  if (port !== 18169) throw Error('content candidate integration requires the isolated test database on port 18169');
  const now = new Date('2032-02-01T00:00:00Z'),
    hours = (n: number) => new Date(now.getTime() + n * 3600_000);
  const blogs: number[] = [];
  for (const [slug, status, url] of [
    ['body-a', 'verified', 'https://body-a.example/'],
    ['body-b', 'verified', 'https://body-b.example/'],
    ['body-nourl', 'verified', null],
    ['body-hidden', 'rejected', 'https://body-hidden.example/'],
  ] as const) {
    const [b] = await pool.execute<ResultSetHeader>('INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,?,?)', [
      slug,
      slug,
      url,
      status,
      now,
    ]);
    blogs.push(b.insertId);
  }
  const posts: number[] = [];
  for (let i = 0; i < 400; i++) {
    const published = i % 9 === 0 ? null : new Date(now.getTime() - Math.floor(i / 4) * 86400_000);
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
      [blogs[i % 4], `g${i}`, `https://body.example/${i}`, `t${i}`, published, now],
    );
    posts.push(p.insertId);
  }
  const body = (id: number, f: { version?: string; kind?: string; status?: string; next: Date; error?: string | null }) =>
    pool.execute(
      `INSERT INTO content_post_bodies(post_id,blog_id,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,last_error,coverage)
       SELECT id,blog_id,'unknown',?,?,url,url,'fixture',?,1,?,?,?,?,'html-page' FROM posts WHERE id=?`,
      [f.status ?? 'ok', f.kind ?? 'article-html', f.version ?? CONTENT_VERSION, now, f.next, now, f.error ?? null, id],
    );
  const compare = async (label: string) => {
    for (const blogId of [null, ...blogs])
      for (const limit of [1, 7, 50, 120]) {
        const fast = await selectContentCandidates(pool, blogId, now, limit);
        const [full] = await pool.query<RowDataPacket[]>(FULL, [blogId, blogId, now, CONTENT_VERSION, CONTENT_VERSION, limit]);
        assert.deepEqual(JSON.parse(JSON.stringify(fast)), JSON.parse(JSON.stringify(full)), `${label} blog ${blogId} limit ${limit}`);
      }
  };
  // Mixed state: due/future bodies (some tied), older-adapter failures with and without content-limit,
  // older-adapter successes and feed bodies (not upgrades), and posts without a body.
  for (const [i, id] of posts.entries()) {
    if (i % 5 === 4) continue;
    const next = hours(((i * 7) % 13) - 6);
    if (i % 23 === 0) await body(id, { version: 'blog-content-v1', status: 'partial', next: hours(48), error: 'content-limit' });
    else if (i % 17 === 0) await body(id, { version: 'blog-content-v1', status: 'missing', next: hours(24) });
    else if (i % 19 === 0) await body(id, { version: 'blog-content-v1', next: hours(24) });
    else if (i % 11 === 0)
      await body(id, { version: 'blog-content-v1', kind: 'rss-content', status: 'partial', next: hours(24), error: 'content-limit' });
    else await body(id, { status: i % 3 ? 'ok' : 'partial', next, error: i % 7 ? null : 'content-limit' });
  }
  await compare('mixed');
  // Every post has a body: only due and upgrade rows remain.
  for (const [i, id] of posts.entries()) if (i % 5 === 4) await body(id, { next: hours(i % 2 ? 3 : -3) });
  await compare('no missing bodies');
  // A body due before the epoch sorts ahead of posts without one.
  await pool.execute('DELETE FROM content_post_bodies WHERE post_id IN (?)', [posts.filter((_, i) => i % 3 === 1)]);
  await pool.execute("UPDATE content_post_bodies SET next_attempt_at='1969-06-01' WHERE post_id=?", [posts[6]]);
  await compare('before epoch');
  return { posts: posts.length };
}
