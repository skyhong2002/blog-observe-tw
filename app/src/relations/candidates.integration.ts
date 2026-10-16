/** Run only against an isolated restored database; this suite deliberately writes fixture rows. */
import assert from 'node:assert/strict';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { PARSER_VERSION } from './parser.ts';
import { selectRelationCandidates } from './worker.ts';

/** The pre-split definition, kept verbatim as the oracle. */
const FULL = `SELECT p.id,p.blog_id,p.url,p.published_at,b.url blog_url,COALESCE(rp.depth,0) depth,o.etag,o.last_modified,o.status,o.parser_version
      FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN relation_observations o ON o.post_id=p.id
      LEFT JOIN relation_publications rp ON rp.blog_id=b.id LEFT JOIN content_post_bodies cb ON cb.post_id=p.id
      WHERE b.status='verified' AND (? IS NULL OR p.blog_id=?) AND (o.post_id IS NULL OR o.next_attempt_at<=? OR (o.parser_version<>? AND o.status IN ('ok','no-body') AND o.error_code IS NULL) OR (cb.status='ok' AND NOT(o.extraction<=>CONCAT('content:',cb.source_kind,':',LEFT(cb.content_hash,24)))))
      ORDER BY COALESCE(o.next_attempt_at,'1970-01-01'),p.published_at DESC,p.id DESC LIMIT ?`;

export async function runRelationCandidatesIntegration(pool: Pool) {
  const port = (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port;
  if (port !== 18169) throw Error('relation candidate integration requires the isolated test database on port 18169');
  const now = new Date('2031-05-01T00:00:00Z');
  const blogs: number[] = [];
  for (const [slug, status] of [
    ['cand-a', 'verified'],
    ['cand-b', 'verified'],
    ['cand-hidden', 'rejected'],
  ]) {
    const [b] = await pool.execute<ResultSetHeader>('INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,?,?)', [
      slug,
      slug,
      `https://${slug}.example/`,
      status,
      now,
    ]);
    blogs.push(b.insertId);
  }
  await pool.execute('INSERT INTO relation_publications(blog_id,depth,admitted_at) VALUES (?,2,?)', [blogs[0], now]);
  const posts: number[] = [];
  for (let i = 0; i < 150; i++) {
    const blog = blogs[i % 3];
    // Same-day ties and undated posts exercise the id and NULL ordering.
    const published = i % 10 === 0 ? null : new Date(now.getTime() - Math.floor(i / 3) * 86400_000);
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
      [blog, `g${i}`, `https://x.example/${i}`, `t${i}`, published, now],
    );
    posts.push(p.insertId);
  }
  const observe = async (id: number, nextAttempt: Date, extra: { parser?: string; status?: string } = {}) =>
    pool.execute(
      'INSERT INTO relation_observations(post_id,blog_id,status,parser_version,observed_at,next_attempt_at) SELECT id,blog_id,?,?,?,? FROM posts WHERE id=?',
      [extra.status ?? 'ok', extra.parser ?? PARSER_VERSION, now, nextAttempt, id],
    );
  const compare = async (label: string) => {
    for (const blogId of [null, blogs[0], blogs[1], blogs[2]])
      for (const limit of [1, 5, 50]) {
        const fast = await selectRelationCandidates(pool, blogId, now, limit);
        const [full] = await pool.query<RowDataPacket[]>(FULL, [blogId, blogId, now, PARSER_VERSION, limit]);
        assert.deepEqual(JSON.parse(JSON.stringify(fast)), JSON.parse(JSON.stringify(full)), `${label} blog ${blogId} limit ${limit}`);
      }
  };
  // Long unobserved backlog: the cheap branch is the answer.
  for (const id of posts.slice(0, 30)) await observe(id, new Date(now.getTime() - 3600_000));
  await compare('backlog');
  // Short backlog: due, future and parser-upgrade observations join the answer.
  for (const [i, id] of posts.slice(30, 140).entries())
    await observe(id, new Date(now.getTime() + (i % 3 === 0 ? -1 : 1) * 3600_000), i % 5 === 0 ? { parser: 'semantic-links-v2' } : {});
  await compare('short backlog');
  // An observation due before the epoch sorts ahead of the unobserved rows, so it must reach the full query.
  await pool.execute("UPDATE relation_observations SET next_attempt_at='1969-06-01' WHERE post_id=?", [posts[140 - 1]]);
  for (const id of posts.slice(140, 145)) await pool.execute('DELETE FROM relation_observations WHERE post_id=?', [id]);
  await pool.execute('DELETE FROM relation_observations WHERE post_id IN (?)', [posts.slice(0, 30)]);
  await compare('before epoch');
  return { posts: posts.length };
}
