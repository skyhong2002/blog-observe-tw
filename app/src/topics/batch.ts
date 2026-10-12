import { load } from 'cheerio';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { reserveBudget } from '../jobs/budget.ts';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { digest, TopicMatcher } from './matcher.ts';
import { SOURCE } from './snapshot-client.ts';

const plain = (value: string | null) =>
  load((value ?? '').slice(0, 60_000))
    .text()
    .replace(/\s+/gu, ' ')
    .trim();
export async function runTopicsBatch(pool: Pool, options: BatchOptions = {}): Promise<BatchResult> {
  const result: BatchResult = { processed: 0, skipped: 0, truncated: false, reservedUnused: 0 };
  return (
    (await withJobLease(pool, 'topics', async (assertLease) => {
      const [[current]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
      if (!current) return result;
      const [terms] = await pool.query<RowDataPacket[]>('SELECT id,label FROM topic_terms WHERE snapshot_id=?', [current.snapshot_id]);
      const matcher = new TopicMatcher(terms.map((t) => ({ id: t.id, label: t.label })));
      const limit = Math.min(200, Math.max(1, options.limit ?? 50));
      const started = Date.now();
      const [posts] = await pool.query<RowDataPacket[]>(
        `SELECT p.id,p.title,p.summary,p.content_hash,
      CASE WHEN o.status='ok' THEN o.body_text END body_text, CASE WHEN o.status='ok' THEN o.content_hash END body_hash
      FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN relation_observations o ON o.post_id=p.id
      LEFT JOIN topic_post_indexes i ON i.post_id=p.id
      WHERE b.status<>'moved' AND (i.post_id IS NULL OR i.snapshot_id<>? OR NOT(i.post_hash<=>p.content_hash)
      OR NOT(i.body_hash<=>(CASE WHEN o.status='ok' THEN o.content_hash END))) ORDER BY p.published_at DESC,p.id DESC LIMIT ?`,
        [current.snapshot_id, limit],
      );
      result.truncated = posts.length === limit;
      for (const p of posts) {
        if (options.signal?.aborted || Date.now() - started > (options.maxDurationMs ?? 120_000)) {
          result.truncated = true;
          break;
        }
        await assertLease();
        const now = options.now?.() ?? new Date();
        if (!(await reserveBudget(pool, [{ scope: 'topics:post-match', amount: 1, limit: 10_000 }], now))) {
          result.truncated = true;
          break;
        }
        const sources: { source: string; text: string }[] = [
          { source: 'title', text: p.title },
          { source: 'feed-summary', text: plain(p.summary) },
          { source: 'body', text: p.body_text ?? '' },
        ];
        const hits = sources.map((s) => ({ ...s, ...matcher.match(s.text) }));
        const capped = hits.some((h) => h.truncated);
        if (capped) result.truncated = true;
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          const [[fresh]] = await c.query<RowDataPacket[]>(
            `SELECT p.content_hash,CASE WHEN o.status='ok' THEN o.content_hash END body_hash FROM posts p LEFT JOIN relation_observations o ON o.post_id=p.id WHERE p.id=? FOR UPDATE`,
            [p.id],
          );
          if (!fresh || fresh.content_hash !== p.content_hash || fresh.body_hash !== p.body_hash) {
            await c.rollback();
            result.skipped++;
            continue;
          }
          await c.execute('DELETE FROM topic_matches WHERE post_id=?', [p.id]);
          const records = (capped ? [] : hits).flatMap((h) => h.ids.map((id) => [p.id, id, current.snapshot_id, h.source]));
          if (records.length) await c.query('INSERT INTO topic_matches(post_id,term_id,snapshot_id,source) VALUES ?', [records]);
          await c.execute(
            'INSERT INTO topic_post_indexes(post_id,snapshot_id,input_hash,post_hash,body_hash,matched_at,status) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id),input_hash=VALUES(input_hash),post_hash=VALUES(post_hash),body_hash=VALUES(body_hash),matched_at=VALUES(matched_at),status=VALUES(status)',
            [p.id, current.snapshot_id, digest(JSON.stringify(sources)), p.content_hash, p.body_hash, now, capped ? 'capped' : 'ok'],
          );
          await c.commit();
          result.processed++;
        } catch (e) {
          await c.rollback();
          throw e;
        } finally {
          c.release();
        }
      }
      return result;
    })) ?? result
  );
}
