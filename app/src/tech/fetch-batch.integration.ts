import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import type { RecordTechObservationInput } from './contracts.ts';
import { createTechFetchBatch } from './fetch-batch.ts';
import { TechObservationQueue } from './observer.ts';

/** Synthetic responses only: real guarded lookup SQL, no HTTP or production writer. */
export async function runTechFetchBatchIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const slug = `tech-fetch-${randomUUID()}`;
  const home = `https://${slug}.example/`;
  const observedAt = new Date(Date.now() - 3600_000);
  const [created] = await pool.execute<ResultSetHeader>(
    "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)",
    [slug, slug, home, observedAt],
  );
  const blogId = created.insertId;
  let checks = 0;
  const check = (condition: unknown, message: string) => {
    assert.ok(condition, message);
    checks++;
  };
  const insert = async (guid: string, url: string, date = observedAt) => {
    const [row] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES(?,?,?,?,?,?)',
      [blogId, guid, url, 'synthetic fixture', date, observedAt],
    );
    return row.insertId;
  };
  const fixture = (url = home) => {
    const written: RecordTechObservationInput[] = [];
    const queue = new TechObservationQueue(async (_pool, input) => {
      written.push(input);
      return { written: true, reason: 'stored' };
    });
    const batch = createTechFetchBatch(pool, { blogId, blogUrl: url }, { enabled: true, queue })!;
    const observe = (source: string) =>
      batch.observer({
        requestedUrl: source,
        url: source,
        status: 200,
        headers: { 'content-type': 'text/html' },
        html: '<html><head><meta name="generator" content="WordPress 7.1.3"></head><body>PRIVATE_SYNTHETIC_HTML</body></html>',
        htmlTruncated: false,
        observedAt,
      });
    return { batch, queue, written, observe };
  };
  try {
    const url = `${home}duplicate`;
    const minimumId = await insert('duplicate-guid-a', url);
    await insert('duplicate-guid-b', url);
    const duplicate = fixture();
    duplicate.observe(url);
    check(duplicate.written.length === 0, 'no metadata enqueue before committed entry list');
    await duplicate.batch.commit([url, url]);
    await duplicate.queue.idle();
    check(
      duplicate.written.length === 1 && duplicate.written[0].sourcePostId === minimumId,
      'real GROUP/MIN lookup chooses one minimum public ID',
    );
    check(!JSON.stringify(duplicate.written).includes('PRIVATE_SYNTHETIC_HTML'), 'memory writer receives sanitized DTO only');

    const capped = fixture();
    const urls: string[] = [];
    for (let index = 0; index < 33; index++) {
      const source = `${home}cap-${index}`;
      await insert(`cap-guid-${index}`, source);
      urls.push(source);
      capped.observe(source);
    }
    await capped.batch.commit(urls);
    await capped.queue.idle();
    check(
      capped.written.length === 32 && capped.queue.stats().dropped === 1,
      '33 distinct real posts remain bounded to32 staged/enqueued observations',
    );
    check(new Set(capped.written.map((input) => input.sourcePostId)).size === 32, 'distinct sources retain distinct committed IDs');

    for (const status of ['seed', 'rejected', 'moved']) {
      const denied = fixture();
      denied.observe(url);
      await pool.execute('UPDATE blogs SET status=? WHERE id=?', [status, blogId]);
      await denied.batch.commit([url]);
      await denied.queue.idle();
      check(denied.written.length === 0, `current ${status} publication rejected after observation`);
    }
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [blogId]);
    const future = `${home}future`;
    await insert('future-guid', future, new Date('2099-01-01'));
    const excluded = fixture();
    excluded.observe(future);
    excluded.observe('https://foreign.example/post');
    await excluded.batch.commit([future, 'https://foreign.example/post']);
    await excluded.queue.idle();
    check(excluded.written.length === 0, 'future and foreign-owner sources do not enqueue');
    const changed = fixture();
    changed.observe(url);
    await pool.execute('UPDATE blogs SET url=? WHERE id=?', ['https://changed-owner.example/', blogId]);
    await changed.batch.commit([url]);
    await changed.queue.idle();
    check(changed.written.length === 0, 'current blog URL ownership mismatch rejects previously observed article');
    return { checks, realSql: true, syntheticInputs: true, realCapture: false, memoryWriterOnly: true, maximumStaged: 32 };
  } finally {
    await pool.execute('DELETE FROM posts WHERE blog_id=?', [blogId]);
    await pool.execute('DELETE FROM blogs WHERE id=?', [blogId]);
  }
}
