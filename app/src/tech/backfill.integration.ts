import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { backfillBlogTechnology } from './backfill.ts';
import { TECH_LIMITS } from './contracts.ts';

/** Explicit disposable database guard; never invoke against production or a persistent clone database. */
export async function runTechBackfillIntegration(pool: Pool) {
  const config = (pool as unknown as { pool: { config: { connectionConfig: { host: string; port: number; database: string } } } }).pool
    .config.connectionConfig;
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 18169);
  assert.match(config.database, /^blog_observe_integration_[a-f0-9]{24}$/);
  const slug = `tech-backfill-${randomUUID()}`;
  const url = `https://${slug}.example/`;
  const observedAt = new Date(Math.floor((Date.now() - 3600_000) / 1000) * 1000);
  const [created] = await pool.execute<ResultSetHeader>(
    "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)",
    [slug, slug, url, observedAt],
  );
  const id = created.insertId;
  let checks = 0;
  const check = (value: unknown, message: string) => {
    assert.ok(value, message);
    checks++;
  };
  const preview = () => backfillBlogTechnology(pool, { afterId: id - 1, limit: 1 });
  try {
    const empty = await preview();
    check(empty.items[0].reason === 'no-public-html' && empty.counts.failed === 0, 'no body is not an invented failure');
    const [post] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES(?,?,?,?,?,?)',
      [id, slug, `${url}post`, slug, observedAt, observedAt],
    );
    await pool.execute(
      `INSERT INTO content_post_bodies(post_id,blog_id,body_html,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage)
      VALUES(?,?,?,'full','ok','html',?,?,'fixture','1',1,?,?,?,'article')`,
      [
        post.insertId,
        id,
        '<meta name="generator" content="WordPress 7.1.3">' + 'x'.repeat(TECH_LIMITS.htmlBytes),
        `${url}post`,
        `${url}post`,
        observedAt,
        observedAt,
        observedAt,
      ],
    );
    const dry = await preview();
    check(dry.counts.detected === 1 && dry.counts.truncated === 1, 'SQL byte cap retains bounded evidence and reports truncation');
    const [[before]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM blog_tech_scans WHERE blog_id=?', [id]);
    check(Number(before.n) === 0, 'dry run cannot create a scan');
    for (const status of ['seed', 'rejected', 'moved']) {
      await pool.execute('UPDATE blogs SET status=? WHERE id=?', [status, id]);
      check(!(await preview()).items.some((item) => item.blogId === id), `skip ${status}`);
    }
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [id]);
    await pool.execute('UPDATE posts SET published_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY) WHERE id=?', [post.insertId]);
    check((await preview()).items[0].reason === 'no-public-html', 'future post cannot provide evidence');
    await pool.execute('UPDATE posts SET published_at=? WHERE id=?', [observedAt, post.insertId]);
    const written = await backfillBlogTechnology(pool, { afterId: id - 1, limit: 1, apply: true });
    check(written.counts.written === 1, 'explicit apply stores valid evidence');
    const [[scan]] = await pool.query<RowDataPacket[]>(
      'SELECT source_post_id,source_type,observed_at,last_attempt_at FROM blog_tech_scans WHERE blog_id=?',
      [id],
    );
    check(Number(scan.source_post_id) === post.insertId && scan.source_type === 'body-fragment', 'source post provenance retained');
    check(
      new Date(scan.observed_at).getTime() === observedAt.getTime() && new Date(scan.last_attempt_at).getTime() === observedAt.getTime(),
      'both timestamps describe original acquisition',
    );
    await pool.execute('UPDATE blog_tech_scans SET last_attempt_at=UTC_TIMESTAMP() WHERE blog_id=?', [id]);
    check((await preview()).items[0].reason === 'stale', 'newer attempt is never replaced by historical HTML');
    await pool.execute('DELETE FROM posts WHERE id=?', [post.insertId]);
    check((await preview()).items[0].reason === 'no-public-html', 'orphaned stored HTML from deleted post cannot provide evidence');
    return { checks, source: 'existing-html-only', formalWrites: false };
  } finally {
    await pool.execute('DELETE FROM blog_tech_scans WHERE blog_id=?', [id]);
    await pool.execute('DELETE FROM content_post_bodies WHERE blog_id=?', [id]);
    await pool.execute('DELETE FROM posts WHERE blog_id=?', [id]);
    await pool.execute('DELETE FROM blogs WHERE id=?', [id]);
  }
}
