import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { topicFingerprintSql } from './provenance-fingerprint-sql.ts';
/** Tiny UTC/JSON/SHA oracle, synthetic owned rows only. No reader adoption or authorization. */
export async function runProvenanceFingerprintSqlIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const ids: number[] = [];
  let post: number | undefined,
    checks = 0;
  const when = new Date('2026-10-13T00:01:02.000Z');
  const check = (v: unknown, m: string) => {
    try {
      assert.ok(v, m);
    } catch (e) {
      if (e && typeof e === 'object') Object.defineProperty(e, 'testOrdinal', { value: checks + 1 });
      throw e;
    }
    checks++;
  };
  const sql = topicFingerprintSql();
  const jsonSql = (s: string) => {
    const m = /^SHA2\(CONVERT\((JSON_ARRAY\([\s\S]*\)) USING utf8mb4\),256\)$/.exec(s);
    assert.ok(m, 'fixed fingerprint SQL shape');
    return `CONVERT(${m[1]} USING utf8mb4)`;
  };
  const read = async () => {
    const [[r]] = await pool.query<RowDataPacket[]>(
      `SELECT ${sql.metadataSql} metadata_fp,${sql.bodySql} body_fp,cb.post_id body_row_exists,${jsonSql(sql.metadataSql)} metadata_json,${jsonSql(sql.bodySql)} body_json FROM (SELECT id FROM posts WHERE id=? ORDER BY id LIMIT 1) scoped JOIN posts p ON p.id=scoped.id JOIN blogs b ON b.id=p.blog_id LEFT JOIN content_post_bodies cb ON cb.post_id=p.id`,
      [post],
    );
    return r;
  };
  const update = async (table: 'posts' | 'blogs' | 'content_post_bodies', column: string, value: unknown, id: number) =>
    pool.execute(`UPDATE ${table} SET ${column}=? WHERE ${table === 'content_post_bodies' ? 'post_id' : 'id'}=?`, [value, id] as never);
  try {
    for (let n = 0; n < 2; n++) {
      const slug = `fp-${randomUUID()}`;
      const [b] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)", [
        slug,
        slug,
        `https://${slug}.example/`,
        when,
      ]);
      ids.push(b.insertId);
    }
    const url = 'https://fingerprint.example/post?id=1',
      hash = 'a'.repeat(64),
      bodyHash = 'b'.repeat(64);
    const [p] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,summary,content_hash,published_at,created_at) VALUES(?,?,?,?,?,?,?,?)',
      [ids[0], randomUUID(), url, '蛤蜊絲瓜😀\\"', null, hash, when, when],
    );
    post = p.insertId;
    await pool.execute(
      `INSERT INTO content_post_bodies(post_id,blog_id,body_text,body_html,content_hash,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,source_updated_at,next_attempt_at,last_attempt_at,coverage) VALUES (?,?,?,?,?,'full','ok','rss-content','https://fingerprint.example/feed',?,'generic-public','blog-content-v2',1,?,NULL,?,?,'full')`,
      [post, ids[0], '正文😀', '<p>正文😀</p>', bodyHash, url, when, when, when],
    );
    const base = await read();
    check(base.metadata_fp !== base.body_fp, 'domains distinct not compared for identity');
    check((await read()).metadata_fp === base.metadata_fp && (await read()).body_fp === base.body_fp, 'repeat stable');
    for (const domain of ['metadata', 'body'])
      check(
        createHash('sha256')
          .update(Buffer.from(base[`${domain}_json`], 'utf8'))
          .digest('hex') === base[`${domain}_fp`],
        `${domain} actual MariaDB JSON UTF8 SHA matches node oracle`,
      );
    const meta = JSON.parse(base.metadata_json),
      body = JSON.parse(base.body_json);
    check(
      meta.at(-1) === '2026-10-13T00:01:02.000000Z' && body[12] === '2026-10-13T00:01:02.000000Z' && body[13] === null,
      'UTC DATETIME6 format and NULL source date oracle',
    );
    const metadataMutations: ['posts' | 'blogs', string, unknown, unknown, number][] = [
      ['posts', 'blog_id', ids[1], ids[0], post],
      [
        'blogs',
        'url',
        'https://changed.example/',
        `https://${(await pool.query<RowDataPacket[]>('SELECT slug FROM blogs WHERE id=?', [ids[0]]))[0][0].slug}.example/`,
        ids[0],
      ],
      ['posts', 'url', url + '&id2=2', url, post],
      ['posts', 'title', '同hash改標題', '蛤蜊絲瓜😀\\"', post],
      ['posts', 'summary', '', null, post],
      ['posts', 'content_hash', 'c'.repeat(64), hash, post],
      ['posts', 'published_at', null, when, post],
    ];
    for (const [table, column, changed, original, id] of metadataMutations) {
      await update(table, column, changed, id);
      const r = await read();
      check(r.metadata_fp !== base.metadata_fp, `metadata scalar ${column} mutation detected`);
      await update(table, column, original, id);
      check((await read()).metadata_fp === base.metadata_fp, `metadata ${column} exactrestore`);
    }
    const bodyMutations: [string, unknown, unknown][] = [
      ['blog_id', ids[1], ids[0]],
      ['status', 'missing', 'ok'],
      ['content_hash', 'c'.repeat(64), bodyHash],
      ['revision', 2, 1],
      ['source_kind', 'atom-content', 'rss-content'],
      ['source_url', 'https://changed.example/feed', 'https://fingerprint.example/feed'],
      ['article_url', url + '&meaningful=2', url],
      ['adapter_id', 'other-public', 'generic-public'],
      ['adapter_version', 'changed-v1', 'blog-content-v2'],
      ['rule_revision', 2, 1],
      ['obtained_at', new Date(when.getTime() + 1000), when],
      ['source_updated_at', when, null],
      ['completeness', 'partial', 'full'],
      ['truncated', 1, 0],
      ['image_only', 1, 0],
      ['body_text', '正文😀x', '正文😀'],
      ['body_html', '<p>正文😀x</p>', '<p>正文😀</p>'],
    ];
    for (const [column, changed, original] of bodyMutations) {
      await update('content_post_bodies', column, changed, post);
      const r = await read();
      check(r.body_fp !== base.body_fp && r.metadata_fp === base.metadata_fp, `body scalar ${column} mutation independent metadata`);
      await update('content_post_bodies', column, original, post);
      check((await read()).body_fp === base.body_fp, `body ${column} restore`);
    }
    await update('content_post_bodies', 'body_text', '換文😀', post);
    check(
      (await read()).body_fp === base.body_fp,
      'equalbyte body change with unchanged contenthash deliberately not authenticated by metadata fingerprint',
    );
    await update('posts', 'summary', '😀', post);
    const emoji = await read();
    await update('posts', 'summary', '漢字', post);
    check((await read()).metadata_fp !== emoji.metadata_fp, 'Unicode actualdigest changes even with fixed metadatahash');
    const beforeStatus = await read();
    await update('blogs', 'status', 'seed', ids[0]);
    check(
      (await read()).metadata_fp === beforeStatus.metadata_fp,
      'blog status not fingerprinted, separate verified/public gate mandatory',
    );
    await update('blogs', 'status', 'verified', ids[0]);
    check(beforeStatus.body_row_exists === post, 'positive body existence must be separately checked');
    await pool.execute('DELETE FROM content_post_bodies WHERE post_id=?', [post]);
    const absent = await read();
    check(
      absent.body_row_exists === null &&
        typeof absent.body_fp === 'string' &&
        /^[a-f0-9]{64}$/.test(absent.body_fp) &&
        JSON.parse(absent.body_json)
          .slice(1)
          .every((value: unknown) => value === null),
      'missing body row has nonNULL allNULLtuple fingerprint, existence gate mandatory',
    );
    return {
      checks,
      version: sql.version,
      synthetic: true,
      utcDatetimeAssumedByWriterContract: true,
      datePrecisionEvidence: 'existing second-precision columns; six-digit format only, not microsecond retention',
      readerAdopted: false,
      performanceClaim: false,
    };
  } finally {
    if (post !== undefined) {
      await pool.execute('DELETE FROM content_post_bodies WHERE post_id=?', [post]);
      await pool.execute('DELETE FROM posts WHERE id=?', [post]);
    }
    if (ids.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [ids]);
  }
}
