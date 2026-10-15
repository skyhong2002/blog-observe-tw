import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { fetch as undiciFetch } from 'undici';
import { infer } from '../ai/service.ts';
import { reserveBudget } from '../jobs/budget.ts';
import { recordCandidateCheck } from './candidate-promotion.ts';
import { CANDIDATE_POLICY, type DiscoveryCandidate, validateCandidate } from './candidate-validation.ts';
import type { FeedCrawlerOptions, FeedFetcher } from './feed.ts';

/** Daily candidate-review requests in total and per host. */
export const CANDIDATE_HTTP_DAILY = 1500,
  CANDIDATE_HOST_DAILY = 20;
/**
 * Counts robots and each redirect immediately before the existing pinned dispatcher performs I/O. A spent total
 * budget stops the batch; a spent per-host budget fails only the current candidate (`onHostBudget`), so one host can
 * never hold the queue.
 */
export function budgetedCandidateFetcher(
  pool: Pool,
  options: FeedCrawlerOptions & { signal?: AbortSignal; now?: () => Date },
  assert: () => Promise<void>,
  deadline: number,
  onStop: () => void,
  onHostBudget: () => void = onStop,
): FeedFetcher {
  const fetcher = options.fetcher ?? (undiciFetch as FeedFetcher);
  return async (input, init) => {
    if (options.signal?.aborted || Date.now() >= deadline) {
      onStop();
      throw Error('candidate_batch_stopped');
    }
    await assert();
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const host = createHash('sha256').update(url.hostname.toLowerCase()).digest('hex');
    const day = options.now?.() ?? new Date();
    if (!(await reserveBudget(pool, [{ scope: `candidates:host:${host}`, amount: 1, limit: CANDIDATE_HOST_DAILY }], day))) {
      onHostBudget();
      throw Error('candidate_host_budget');
    }
    if (!(await reserveBudget(pool, [{ scope: 'candidates:http', amount: 1, limit: CANDIDATE_HTTP_DAILY }], day))) {
      onStop();
      throw Error('candidate_http_budget');
    }
    if (options.signal?.aborted || Date.now() >= deadline) {
      onStop();
      throw Error('candidate_batch_stopped');
    }
    await assert(); // Permission/lease can change while waiting for the budget transaction.
    return fetcher(input, init);
  };
}
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
  options: FeedCrawlerOptions & { apply?: boolean; limit?: number; maxDurationMs?: number; signal?: AbortSignal; now?: () => Date } = {},
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
      `SELECT id,url,name,status,source_type,source_evidence FROM discovery_candidates d WHERE status='candidate'
   AND NOT EXISTS (SELECT 1 FROM discovery_candidate_audits a WHERE a.candidate_id=d.id AND (a.source_type IN ('manual','human-review','admin') OR a.source_actor_id IS NOT NULL))
   AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.automaticReview.policy')),'')<>? OR COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.automaticReview.checkedAt')),'') < ? OR EXISTS(SELECT 1 FROM ai_results ai WHERE ai.entity_type='candidate' AND ai.entity_id=d.id AND ai.task='classification' AND ai.status<>'ok' AND ai.attempts<3 AND ai.next_attempt_at<=UTC_TIMESTAMP()))
   ORDER BY COALESCE(JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.automaticReview.checkedAt')),''),id LIMIT ?`,
      [CANDIDATE_POLICY, new Date(Date.now() - 7 * 86400000).toISOString(), limit],
    );
    const results = [];
    let stopped = false,
      hostSpent = false;
    const boundedOptions =
      options.apply === true
        ? {
            ...options,
            fetcher: budgetedCandidateFetcher(
              pool,
              options,
              () => assertLease(connection),
              deadline,
              () => {
                stopped = true;
              },
              () => {
                hostSpent = true;
              },
            ),
          }
        : options;
    for (const row of rows) {
      if (Date.now() >= deadline || options.signal?.aborted) break;
      await assertLease(connection);
      hostSpent = false;
      const checked = await validateCandidate(row as DiscoveryCandidate, boundedOptions);
      // Recorded (retried after the 7-day recheck) rather than deferred: deferring left it first in line every run.
      if (hostSpent && !stopped) Object.assign(checked, { eligible: false, reason: 'candidate_host_budget_exhausted' });
      if (stopped) {
        results.push({ id: row.id, status: 'deferred', reason: 'candidate_http_budget_or_deadline' });
        break;
      }
      if (
        options.apply === true &&
        process.env.BLOG_AI_ENABLED === 'true' &&
        checked.feed &&
        !checked.eligible &&
        checked.personalEvidence?.method === 'unresolved' &&
        checked.personalEvidence.reason === 'personal_identity_uncertain'
      ) {
        const inference = await infer(pool, 'classification', 'candidate', checked.id, checked.personalEvidence.input, 'homepage', {
          signal: options.signal,
          now: options.now,
        });
        if (
          inference.status === 'ok' &&
          inference.result?.classification === 'personal' &&
          inference.result.confidence >= 0.95 &&
          inference.result.quotedEvidence.length
        ) {
          checked.personalEvidence = {
            ...checked.personalEvidence,
            method: 'ai',
            personal: true,
            reason: 'ai_personal_high_confidence',
            cacheKey: inference.cacheKey,
          };
          checked.eligible = true;
          checked.reason = 'verified_personal_homepage_and_rss';
        }
      }
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
