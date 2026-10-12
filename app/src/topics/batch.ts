import type { Pool, RowDataPacket } from 'mysql2/promise';
import { reserveBudget } from '../jobs/budget.ts';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { topicBodyHash, topicBodyHtml, topicBodyJoins, topicBodyObtainedAt, topicBodyText } from './body.ts';
import { digest, TopicMatcher } from './matcher.ts';
import { CLEANUP_VERSION, cleanTopicBody } from './matching-body.ts';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { ensureTopicPolicy } from './policy-store.ts';
import { SOURCE } from './snapshot-client.ts';

export async function runTopicsBatch(pool: Pool, options: BatchOptions & { since?: Date } = {}): Promise<BatchResult> {
  const result: BatchResult = { processed: 0, skipped: 0, truncated: false, reservedUnused: 0 };
  return (
    (await withJobLease(pool, 'topics', async (assertLease) => {
      const [[current]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
      if (!current) return result;
      await ensureTopicPolicy(pool, current.snapshot_id);
      const [terms] = await pool.query<RowDataPacket[]>(
        'SELECT id,label FROM topic_canonical_terms WHERE snapshot_id=? AND exclusion_reason IS NULL AND policy_version=?',
        [current.snapshot_id, POLICY_VERSION],
      );
      const matcher = new TopicMatcher(terms.map((t) => ({ id: t.id, label: t.label })));
      const limit = Math.min(200, Math.max(1, options.limit ?? 50));
      const started = Date.now();
      const [posts] = await pool.query<RowDataPacket[]>(
        `SELECT p.id,p.title,p.summary,p.content_hash,
      ${topicBodyText} body_text, ${topicBodyHash} body_hash, ${topicBodyHtml} body_html, ${topicBodyObtainedAt} body_obtained_at
      FROM posts p JOIN blogs b ON b.id=p.blog_id ${topicBodyJoins}
      LEFT JOIN topic_post_indexes_v2 i ON i.post_id=p.id
      WHERE b.status<>'moved' AND (i.post_id IS NULL OR i.snapshot_id<>? OR i.matcher_version<>? OR NOT(i.post_hash<=>p.content_hash)
      OR NOT(i.body_hash<=>(${topicBodyHash}))) ${options.since ? 'AND p.published_at>=?' : ''} ORDER BY p.published_at DESC,p.id DESC LIMIT ?`,
        [current.snapshot_id, MATCHER_VERSION, ...(options.since ? [options.since] : []), limit],
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
        const body = cleanTopicBody({ html: p.body_html, text: p.body_text });
        const sources: { source: string; text: string }[] = [
          { source: 'title', text: p.title },
          { source: 'body', text: body.text },
        ];
        const hits = sources.map((s) => ({ ...s, ...matcher.match(s.text) }));
        const capped = hits.some((h) => h.truncated);
        if (capped) result.truncated = true;
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          const [[fresh]] = await c.query<RowDataPacket[]>(
            `SELECT p.content_hash,${topicBodyHash} body_hash FROM posts p ${topicBodyJoins} WHERE p.id=? FOR UPDATE`,
            [p.id],
          );
          if (!fresh || fresh.content_hash !== p.content_hash || fresh.body_hash !== p.body_hash) {
            await c.rollback();
            result.skipped++;
            continue;
          }
          await c.execute('DELETE FROM topic_matches_v2 WHERE post_id=?', [p.id]);
          const records = (capped ? [] : hits).flatMap((h) => h.ids.map((id) => [p.id, id, current.snapshot_id, h.source]));
          if (records.length) await c.query('INSERT INTO topic_matches_v2(post_id,term_id,snapshot_id,source) VALUES ?', [records]);
          await c.execute(
            'INSERT INTO topic_post_indexes_v2(post_id,snapshot_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind,body_obtained_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id),input_hash=VALUES(input_hash),post_hash=VALUES(post_hash),body_hash=VALUES(body_hash),matched_at=VALUES(matched_at),status=VALUES(status),matcher_version=VALUES(matcher_version),cleanup_version=VALUES(cleanup_version),body_kind=VALUES(body_kind),body_obtained_at=VALUES(body_obtained_at)',
            [
              p.id,
              current.snapshot_id,
              digest(JSON.stringify(sources)),
              p.content_hash,
              p.body_hash,
              now,
              capped ? 'capped' : 'ok',
              MATCHER_VERSION,
              CLEANUP_VERSION,
              body.kind,
              p.body_obtained_at,
            ],
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
