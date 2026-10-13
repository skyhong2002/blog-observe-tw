import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { loadTextSimilarity } from './text-similarity-reader.ts';

/** Small synthetic bodies on the existing isolated DB. No HTTP, writer, crawler or new service. */
export async function runTextSimilarityIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const key = randomUUID();
  const ids: number[] = [],
    blogs: number[] = [];
  let drain: Promise<unknown> | undefined;
  let releasePending: (() => void) | undefined;
  const privateMarker = 'PRIVATE_SIMILARITY_PREFIX';
  const summary = 'SAFE_PUBLIC_SUMMARY 公開文章摘要';
  const body = privateMarker + '生活裡的日常觀察與旅行記憶，從書店走向海邊，重新記下沿途的樹木、街道和每一段對話。'.repeat(5);
  let checks = 0;
  const now = new Date(Date.now() - 3600000);
  const check = (condition: unknown) => {
    assert.ok(condition);
    checks++;
  };
  try {
    for (const side of ['a', 'b']) {
      const home = `https://similarity-${key}-${side}.example/`;
      const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)", [
        key + side,
        key + side,
        home,
        now,
      ]);
      blogs.push(b.insertId);
      const url = home + 'post';
      const [p] = await pool.execute<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,summary,published_at,created_at) VALUES(?,?,?,?,?,?,?)',
        [b.insertId, url, url, '公開合成文章', summary, now, now],
      );
      ids.push(p.insertId);
      await pool.execute(
        `INSERT INTO content_post_bodies(post_id,blog_id,body_text,content_hash,completeness,status,source_kind,source_url,article_url,
          adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,coverage)
         VALUES(?,?,?,?,'full','ok','rss-content',?,?,'fixture','v1',1,?,?,?,'syndicated-body-only')`,
        [p.insertId, b.insertId, body, 'a'.repeat(64), home + 'feed', url, now, now, now],
      );
    }
    const input = { pairs: [{ sourceArticleId: ids[0], targetArticleId: ids[1] }] };
    const read = () => loadTextSimilarity(pool, input, { enabled: true });
    const ready = await read();
    check(ready.status === 'ready' && ready.items[0].status === 'ready' && ready.items[0].lexicalSimilarity === 1);
    check(!JSON.stringify(ready).includes('contentHash') && !JSON.stringify(ready).includes('bodyTextHash'));
    check(JSON.stringify(ready).includes(summary) && !JSON.stringify(ready).includes(privateMarker));
    if (ready.status === 'ready' && 'source' in ready.items[0] && ready.items[0].source && ready.items[0].target) {
      check(ready.items[0].source.previewSource === 'post-summary' && ready.items[0].source.comparedContextSource === 'body-prefix');
      check(ready.items[0].target.previewSource === 'post-summary' && ready.items[0].target.comparedContextSource === 'body-prefix');
    } else {
      throw Error('fixture_public_summary_missing');
    }
    // Decoder BOM handling must not change the raw-byte digest checked by SQL.
    await pool.query('UPDATE content_post_bodies SET body_text=? WHERE post_id IN (?)', ['\uFEFF' + body, ids]);
    const bom = await read();
    check(bom.status === 'ready' && bom.items[0].status === 'ready' && bom.items[0].lexicalSimilarity === 1);
    check(JSON.stringify(bom).includes(summary) && !JSON.stringify(bom).includes(privateMarker));
    for (const status of ['seed', 'rejected', 'moved']) {
      await pool.execute('UPDATE blogs SET status=? WHERE id=?', [status, blogs[1]]);
      const result = await read();
      check(result.status === 'ready' && result.items[0].status === 'unavailable' && result.items[0].lexicalSimilarity === null);
    }
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [blogs[1]]);
    await pool.execute('UPDATE posts SET published_at=? WHERE id=?', [new Date('2099-01-01'), ids[1]]);
    const future = await read();
    check(future.status === 'ready' && future.items[0].status === 'unavailable');
    await pool.execute('UPDATE posts SET published_at=? WHERE id=?', [now, ids[1]]);

    // A obtains its evidence, then a separate transaction commits a withdrawal. B is a new read.
    let started!: () => void, release!: () => void;
    const atRead = new Promise<void>((resolve) => {
      started = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    releasePending = release;
    const events: string[] = [];
    let held = false;
    const wrapped: Pool = Object.create(pool);
    wrapped.getConnection = async () => {
      const connection = await pool.getConnection();
      let first = true;
      return new Proxy(connection, {
        get(target, property) {
          if (property === 'query')
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(target.query, target, args);
              if (first && !held) {
                first = false;
                held = true;
                events.push('A-read');
                started();
                await barrier;
              }
              return result;
            };
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const pending = loadTextSimilarity(wrapped, input, { enabled: true });
    drain = pending;
    void pending.catch(() => undefined);
    await Promise.race([
      atRead,
      pending.then(() => {
        throw Error('fixture_A_finished_before_barrier');
      }),
    ]);
    try {
      const writer = await pool.getConnection();
      try {
        await writer.beginTransaction();
        await writer.execute("UPDATE blogs SET status='seed' WHERE id=?", [blogs[1]]);
        await writer.commit();
        events.push('commit');
      } finally {
        writer.release();
      }
      const b = await loadTextSimilarity(wrapped, input, { enabled: true });
      events.push('B-complete');
      check(b.status === 'ready' && b.items[0].status === 'unavailable');
    } finally {
      events.push('A-release');
      release();
      await pending.catch(() => undefined);
      drain = undefined;
    }
    const a = await pending;
    events.push('A-complete');
    check(a.status === 'ready' && a.items[0].status === 'unavailable');
    check(events.join(',') === 'A-read,commit,B-complete,A-release,A-complete');
    return {
      checks,
      events,
      publicPreviewSource: 'post-summary',
      privateCalculationSource: 'body-prefix',
      bomBothBodies: true,
      syntheticInputs: true,
      realSql: true,
      productionCostMeasured: false,
      noSleepOrTTL: true,
    };
  } finally {
    releasePending?.();
    await drain?.catch(() => undefined);
    if (ids.length) {
      await pool.query('DELETE FROM content_post_bodies WHERE post_id IN (?)', [ids]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [ids]);
    }
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
  }
}
