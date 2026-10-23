/**
 * Read-only timing of the topic page metadata reads for a few keys, one connection, sequential.
 * Each statement runs twice (first read, repeat read) with session Handler deltas. Never logs credentials.
 *   node --env-file=~/.config/blog-observe.env tools/seo/measure-topic-metadata.ts 火車站 美術館 條件
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { createDb } from '../../app/src/db/client.ts';
import { historyEvidenceSql, historyPublicEvidenceSql, historyPublicTopicSql } from '../../app/src/topics/history-read.ts';

const store = createDb(undefined, { poolSize: 1 });
const handlers = async (c: PoolConnection) => {
  const [rows] = await c.query<RowDataPacket[]>(
    "SHOW SESSION STATUS WHERE Variable_name IN ('Handler_read_key','Handler_read_next','Handler_read_rnd_next')",
  );
  return Object.fromEntries(rows.map((r) => [r.Variable_name, Number(r.Value)])) as Record<string, number>;
};
async function timed(c: PoolConnection, label: string, sql: string, params: unknown[]) {
  for (const pass of ['first', 'repeat']) {
    const before = await handlers(c),
      started = performance.now();
    let note = '';
    try {
      const [rows] = await c.query<RowDataPacket[]>(sql, params);
      note = JSON.stringify(rows.slice(0, 1)[0] ?? null).slice(0, 160);
    } catch (error) {
      note = `ERROR ${(error as { code?: string }).code ?? (error as Error).message}`;
    }
    const ms = Math.round(performance.now() - started),
      after = await handlers(c);
    const delta = Object.entries(after)
      .map(([k, v]) => `${k.replace('Handler_read_', '')}=${v - (before[k] ?? 0)}`)
      .join(' ');
    console.log(`${new Date().toISOString()} ${label} ${pass} ${ms}ms ${delta} ${note}`);
  }
}
const c = await store.pool.getConnection();
try {
  for (const key of process.argv.slice(2)) {
    const [[route]] = await c.query<RowDataPacket[]>("SELECT entity_id FROM public_route_keys WHERE kind='topic' AND route_key=?", [key]);
    if (!route) {
      console.log(key, 'no route');
      continue;
    }
    const id = String(route.entity_id);
    const [[size]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_article_evidence WHERE canonical_id=?', [id]);
    console.log(`# ${key} ${id.slice(0, 12)} evidence=${size.n}`);
    await timed(
      c,
      'disposition.counts',
      `SELECT COUNT(*) total,SUM(e.state<>'revoked' AND p.id IS NOT NULL) retained,
 SUM(e.state<>'revoked' AND p.id IS NOT NULL AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) public_count
 FROM topic_article_evidence e LEFT JOIN posts p ON p.id=e.post_id LEFT JOIN blogs b ON b.id=p.blog_id WHERE e.canonical_id=?`,
      [id],
    );
    await timed(
      c,
      'cumulativeTopics(old)',
      `WITH ${historyEvidenceSql('many')}
 SELECT h.canonical_id entity_id,t.label,COUNT(*) posts,COUNT(DISTINCT h.blog_id) blogs,MAX(h.published_at) lastmod
 FROM historical h JOIN topic_pages t ON t.canonical_id=h.canonical_id
 WHERE t.state IN ('active','pending') AND ${historyPublicTopicSql('t')}
 GROUP BY h.canonical_id,t.label`,
      [[id]],
    );
    await timed(
      c,
      'lean.counts',
      `SELECT e.canonical_id entity_id,t.label,COUNT(DISTINCT p.id) posts,COUNT(DISTINCT p.blog_id) blogs,MAX(p.published_at) lastmod
 FROM topic_article_evidence e JOIN posts p ON p.id=e.post_id JOIN blogs b ON b.id=p.blog_id JOIN topic_pages t ON t.canonical_id=e.canonical_id
 WHERE e.canonical_id IN (?) AND ${historyPublicEvidenceSql} AND t.state IN ('active','pending') AND ${historyPublicTopicSql('t')}
 GROUP BY e.canonical_id,t.label`,
      [[id]],
    );
    await timed(c, 'history.counts (HTML)', `WITH ${historyEvidenceSql()} SELECT COUNT(*) total,SUM(fresh=1) confirmed FROM historical`, [
      id,
    ]);
  }
} finally {
  c.release();
  await store.close();
}
