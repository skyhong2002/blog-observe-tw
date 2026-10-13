import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { detectTechnology } from './detector.ts';
import { publicTechSourceSql, recordTechObservation } from './store.ts';

/** Real transactions and visibility races; never usable against the production database. */
export async function runTechStoreIntegration(pool: Pool) {
  const config = (pool as unknown as { pool: { config: { connectionConfig: { host: string; port: number; database: string } } } }).pool
    .config.connectionConfig;
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 18169);
  assert.match(config.database, /^blog_observe_integration_[a-f0-9]{24}$/);
  const marker = `tech-${randomUUID()}`;
  const now = new Date(),
    base = now.getTime() - 60_000;
  const blogIds: number[] = [],
    postIds: number[] = [];
  const url = `https://${marker}.example/`;
  let checks = 0;
  const check = (value: unknown, message: string) => {
    assert.ok(value, message);
    checks++;
  };
  try {
    for (const home of [url, 'https://medium.com/@techfixture']) {
      const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)", [
        `${marker}-${blogIds.length}`,
        marker,
        home,
        now,
      ]);
      blogIds.push(b.insertId);
    }
    const blogId = blogIds[0];
    const observe = (offset: number, extra = {}, sourceUrl = url) => ({
      blogId,
      sourceUrl,
      observation: detectTechnology({
        url: sourceUrl,
        html: '<meta name="generator" content="WordPress 7.1.3"><script src="https://www.googletagmanager.com/gtag/js?id=G-SECRET"></script>',
        observedAt: new Date(base + offset),
        ...extra,
      }),
    });
    const read = async () => (await pool.query<RowDataPacket[]>('SELECT * FROM blog_tech_scans WHERE blog_id=?', [blogId]))[0][0];
    const readPublic = async () =>
      (
        await pool.query<RowDataPacket[]>(
          `SELECT s.* FROM blog_tech_scans s JOIN blogs b ON b.id=s.blog_id WHERE b.id=? AND ${publicTechSourceSql()}`,
          [blogId],
        )
      )[0];
    check((await recordTechObservation(pool, observe(1))).written, 'initial success stored');
    const initial = await read();
    check(initial.status === 'detected' && new Date(initial.observed_at).getTime() === base + 1, 'actual observation timestamp preserved');
    const successJson = typeof initial.detections === 'string' ? initial.detections : JSON.stringify(initial.detections);
    check(!successJson.includes('SECRET'), 'no analytics IDs persisted');
    check((await recordTechObservation(pool, observe(2, { failureReason: 'timeout' }))).written, 'failure stored independently');
    const failed = await read();
    check(failed.status === 'failed' && failed.last_error_code === 'timeout', 'latest failure status visible');
    check(
      new Date(failed.observed_at).getTime() === base + 1 && new Date(failed.last_attempt_at).getTime() === base + 2,
      'failed attempt does not replace success time',
    );
    check(
      (typeof failed.detections === 'string' ? failed.detections : JSON.stringify(failed.detections)) === successJson,
      'failure retains successful metadata',
    );
    check((await recordTechObservation(pool, observe(3, { httpStatus: 403 }))).written, 'blocked attempt stored');
    check((await read()).status === 'blocked' && (await read()).source_url === url, 'blocked retains source and current status');
    check((await recordTechObservation(pool, observe(2))).reason === 'stale', 'out-of-order result ignored');
    check((await read()).status === 'blocked', 'older success cannot overwrite latest failure');
    check(
      (await recordTechObservation(pool, observe(4, { html: '<h1>Public homepage without signals</h1>' }))).written,
      'observed unknown is recorded',
    );
    check((await read()).status === 'unknown', 'unknown distinct from no stored row');
    const [[missing]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM blog_tech_scans WHERE blog_id=?', [blogIds[1]]);
    check(Number(missing.count) === 0, 'not-observed is represented by no row');

    for (const status of ['seed', 'rejected', 'moved']) {
      await pool.execute('UPDATE blogs SET status=? WHERE id=?', [status, blogId]);
      check((await recordTechObservation(pool, observe(5))).reason === 'not-public', `reject ${status} write`);
      check((await readPublic()).length === 0, `exclude ${status} public read immediately`);
    }
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [blogId]);
    check((await readPublic()).length === 1, 'restore read immediately without rewriting');
    check(
      (await recordTechObservation(pool, observe(6, {}, 'https://other.example/'))).reason === 'ownership-mismatch',
      'cross-host redirect rejected',
    );
    check(
      (await recordTechObservation(pool, { ...observe(6, {}, 'https://medium.com/@other/post'), blogId: blogIds[1] })).reason ===
        'ownership-mismatch',
      'shared platform different owner rejected',
    );
    check(
      (await recordTechObservation(pool, observe(6, {}, `${url}unattributed-article`))).reason === 'ownership-mismatch',
      'article without provenance rejected',
    );
    const lock = await pool.getConnection();
    try {
      await lock.beginTransaction();
      await lock.query('SELECT id FROM blogs WHERE id=? FOR UPDATE', [blogId]);
      const writing = recordTechObservation(pool, observe(7));
      await delay(25);
      await lock.execute("UPDATE blogs SET status='rejected' WHERE id=?", [blogId]);
      await lock.commit();
      check((await writing).reason === 'not-public', 'locked hide/write race rechecks committed visibility');
    } finally {
      await lock.rollback();
      lock.release();
    }
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [blogId]);
    const pair = await Promise.all([recordTechObservation(pool, observe(10)), recordTechObservation(pool, observe(9))]);
    check(
      pair.some((r) => r.written),
      'concurrent observations complete',
    );
    check(new Date((await read()).last_attempt_at).getTime() === base + 10, 'newest wins independent of transaction ordering');
    for (const future of [false, true]) {
      const [p] = await pool.execute<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES(?,?,?,?,?,?)',
        [blogId, `${marker}-${future}`, `${url}post-${future}`, 'fixture', new Date(now.getTime() + (future ? 3600_000 : -3600_000)), now],
      );
      postIds.push(p.insertId);
    }
    check(
      (await recordTechObservation(pool, { ...observe(11, {}, `${url}post-true`), sourcePostId: postIds[1] })).reason === 'not-public',
      'future source post rejected',
    );
    check(
      (await recordTechObservation(pool, { ...observe(12, {}, `${url}post-false`), sourcePostId: postIds[0] })).written,
      'public article evidence stored with provenance',
    );
    check((await readPublic()).length === 1, 'article snapshot initially public');
    await pool.execute('DELETE FROM posts WHERE id=?', [postIds[0]]);
    check((await readPublic()).length === 0, 'deleted evidence source excluded on immediate read');
    check(
      (await recordTechObservation(pool, { ...observe(13, {}, `${url}post-false`), sourcePostId: postIds[0] })).reason === 'not-public',
      'deleted article cannot write delayed observation',
    );
    check((await recordTechObservation(pool, observe(14))).written, 'new homepage evidence can replace deleted article provenance');
    check(
      (await readPublic()).length === 1 && (await read()).source_post_id === null,
      'new independently public evidence restores visibility',
    );
    return {
      checks,
      isolatedPort: 18169,
      visibilityStates: ['seed', 'rejected', 'moved'],
      retainedOnFailure: true,
      race: 'locked-status-recheck',
      newestWins: true,
      deletedSourceImmediatelyMasked: true,
    };
  } finally {
    if (blogIds.length) await pool.query('DELETE FROM blog_tech_scans WHERE blog_id IN (?)', [blogIds]);
    if (postIds.length) await pool.query('DELETE FROM posts WHERE id IN (?)', [postIds]);
    if (blogIds.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogIds]);
  }
}
