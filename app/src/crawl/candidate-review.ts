import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { recordCandidateCheck } from './candidate-promotion.ts';
import { CANDIDATE_POLICY, type DiscoveryCandidate, validateCandidate } from './candidate-validation.ts';
import type { FeedCrawlerOptions } from './feed.ts';

const LOCK = 'blog_observe:candidate-review';
async function assertLease(c: PoolConnection) {
  const [[r]] = await c.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?)=CONNECTION_ID() held', [LOCK]);
  if (Number(r?.held) !== 1) throw Error('review lease lost');
}
async function releaseLease(c: PoolConnection, held: boolean) {
  try {
    if (held) {
      const [[r]] = await c.query<RowDataPacket[]>('SELECT RELEASE_LOCK(?) released', [LOCK]);
      if (Number(r?.released) !== 1) throw Error('review lease lost');
    }
    c.release();
  } catch (error) {
    c.destroy();
    throw error;
  }
}
async function applyWithRetry(pool: Pool, check: Parameters<typeof recordCandidateCheck>[1]) {
  for (let attempt = 0; attempt < 3; attempt++)
    try {
      return await recordCandidateCheck(pool, check, true);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (!['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  throw Error('retry exhausted');
}
/** Review a bounded, resumable batch. Keep declined/operator-reviewed candidates out of automatic work. */
export async function runCandidateReviewBatch(
  pool: Pool,
  options: FeedCrawlerOptions & { apply?: boolean; limit?: number; maxDurationMs?: number } = {},
) {
  if ((pool as unknown as { pool?: { config?: { connectionLimit?: number } } }).pool?.config?.connectionLimit === 1)
    throw Error('candidate review requires poolSize >= 2');
  const connection = await pool.getConnection();
  let held = false;
  try {
    const [[lock]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) held', ['blog_observe:candidate-review']);
    if (Number(lock?.held) !== 1) return { skipped: 'review-already-running', results: [] };
    held = true;
    const limit = Math.max(1, Math.min(2000, Math.trunc(options.limit || 25)));
    const deadline = Date.now() + Math.max(1000, Math.min(3600000, options.maxDurationMs || 600000));
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id,url,name,status,source_type FROM discovery_candidates d WHERE status='candidate'
   AND NOT EXISTS (SELECT 1 FROM discovery_candidate_audits a WHERE a.candidate_id=d.id AND (a.source_type IN ('manual','human-review','admin') OR a.source_actor_id IS NOT NULL))
   AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.automaticReview.policy')),'')<>? OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.automaticReview.checkedAt')),'') < ?)
   ORDER BY COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.automaticReview.checkedAt')),''),id LIMIT ?`,
      [CANDIDATE_POLICY, new Date(Date.now() - 7 * 86400000).toISOString(), limit],
    );
    const results = [];
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      await assertLease(connection);
      const checked = await validateCandidate(row as DiscoveryCandidate, options);
      // Writer uses the second pool connection; never hold a SQL transaction while fetching.
      await assertLease(connection);
      try {
        results.push(options.apply === true ? await applyWithRetry(pool, checked) : { status: 'dry-run', check: checked });
      } catch {
        results.push({ id: row.id, status: 'write-failed', reason: 'transaction_failed_retained_for_retry' });
      }
    }
    return { policy: CANDIDATE_POLICY, selected: rows.length, processed: results.length, results };
  } finally {
    await releaseLease(connection, held);
  }
}
