import type { Pool, RowDataPacket } from 'mysql2/promise';
import { reserveBudgetOnConnection } from '../jobs/budget.ts';
import { withJobLease } from '../jobs/lease.ts';
import { topicBodyHash, topicBodyHtml, topicBodyJoins, topicBodyText } from './body.ts';
import type { HistoryWorkOptions } from './history-backfill.ts';
import { type HistoryEvidenceSource, historyWritesEnabled } from './history-contracts.ts';
import { applyHistoryObservations, type HistoryObservation } from './history-store.ts';
import { TopicMatcher } from './matcher.ts';
import { cleanTopicBody } from './matching-body.ts';
import { exclusionReason, MATCHER_VERSION } from './policy.ts';
import { publicationExclusionReason } from './publication-noise.ts';
import { SOURCE } from './snapshot-client.ts';

export type HistoryRevalidationResult = {
  processed: number;
  written: number;
  revoked: number;
  pending: number;
  truncated: boolean;
  budgetExhausted: boolean;
  disabled?: boolean;
  leaseBusy?: boolean;
};
type RevalidationCandidate = { post_id: number; oldest: Date };

/** The full definition: every unrevoked row whose post is gone, pending, re-hashed or older than the cutoff.
 * Hashing joins every evidence row to its article body, so it reads most of content_post_bodies. */
export async function scanRevalidationCandidates(pool: Pool, cutoff: Date, limit: number, postIds?: number[]) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT e.post_id,MIN(e.checked_at) oldest FROM topic_article_evidence e
       LEFT JOIN posts p ON p.id=e.post_id ${topicBodyJoins}
       JOIN topic_pages hp ON hp.canonical_id=e.canonical_id AND hp.state<>'merged'
       WHERE e.state<>'revoked' ${postIds ? 'AND e.post_id IN (?)' : ''} AND (p.id IS NULL OR e.state='pending' OR NOT(e.post_hash<=>p.content_hash)
         OR NOT(e.body_hash<=>(${topicBodyHash})) OR e.checked_at<?)
       GROUP BY e.post_id ORDER BY oldest,e.post_id LIMIT ?`,
    [...(postIds ? [postIds] : []), cutoff, limit],
  );
  return rows as RevalidationCandidate[];
}

const STALE_WINDOWS = [4_000, 16_000, 64_000, 256_000];
/** Same result as the full scan, read from topic_history_work. Every row checked before the cutoff
 * qualifies, so a post's oldest qualifying row is its first stale row in (checked_at, post_id) order,
 * and any post with a stale row sorts ahead of every post without one. Once `limit` stale posts are
 * known the hash comparison cannot change the answer; only a short stale backlog needs the full scan. */
export async function selectRevalidationCandidates(pool: Pool, cutoff: Date, limit: number, postIds?: number[]) {
  if (postIds) return scanRevalidationCandidates(pool, cutoff, limit, postIds);
  const key = (r: RowDataPacket) => [new Date(r.checked_at).getTime(), Number(r.post_id)] as const;
  const before = (a: readonly [number, number], b: readonly [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  for (const window of STALE_WINDOWS) {
    const states = await Promise.all(
      (['confirmed', 'pending'] as const).map(async (state) => {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT STRAIGHT_JOIN e.post_id,e.checked_at FROM topic_article_evidence e FORCE INDEX (topic_history_work)
           JOIN topic_pages hp ON hp.canonical_id=e.canonical_id AND hp.state<>'merged'
           WHERE e.state=? AND e.checked_at<? ORDER BY e.checked_at,e.post_id LIMIT ?`,
          [state, cutoff, window],
        );
        return rows;
      }),
    );
    // Rows past the shortest full window may be missing from the other state's window.
    const bound = states
      .filter((rows) => rows.length === window)
      .map((rows) => key(rows[rows.length - 1]))
      .reduce<readonly [number, number] | null>((min, k) => (!min || before(k, min) ? k : min), null);
    const candidates = new Map<number, RevalidationCandidate>();
    for (const r of states.flat().sort((a, b) => (before(key(a), key(b)) ? -1 : before(key(b), key(a)) ? 1 : 0))) {
      if (bound && !before(key(r), bound)) break;
      if (!candidates.has(Number(r.post_id))) candidates.set(Number(r.post_id), { post_id: Number(r.post_id), oldest: r.checked_at });
    }
    if (candidates.size >= limit) return [...candidates.values()].slice(0, limit);
    if (!bound) break;
  }
  return scanRevalidationCandidates(pool, cutoff, limit);
}
/** No network requests. The historical matcher contains exactly the ledger terms for this article;
 * unlike the current rolling matcher, its absence result really covers those historical terms. */
export async function revalidateTopicHistory(
  pool: Pool,
  options: HistoryWorkOptions & { postIds?: number[] } = {},
): Promise<HistoryRevalidationResult> {
  const result: HistoryRevalidationResult = { processed: 0, written: 0, revoked: 0, pending: 0, truncated: false, budgetExhausted: false };
  if (!(options.enabled ?? historyWritesEnabled())) return { ...result, disabled: true };
  if ([options.limit, options.maxDurationMs].some((n) => n !== undefined && (!Number.isFinite(n) || n <= 0)))
    throw Error('invalid history work bounds');
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 50))),
    duration = Math.max(1, Math.min(30_000, options.maxDurationMs ?? 30_000));
  if (options.postIds && (options.postIds.length > 50 || options.postIds.some((id) => !Number.isSafeInteger(id) || id < 1)))
    throw Error('invalid history post filter');
  if (options.postIds?.length === 0) return result;
  const started = Date.now();
  return (
    (await withJobLease(pool, 'topics', async (assertLease) => {
      const now = options.now?.() ?? new Date();
      const posts = await selectRevalidationCandidates(pool, new Date(now.getTime() - 6 * 3600_000), limit, options.postIds);
      result.truncated = posts.length === limit;
      for (const candidate of posts) {
        if (options.signal?.aborted || Date.now() - started >= duration) {
          result.truncated = true;
          break;
        }
        await assertLease();
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          // Same lock ordering as the normal batch: article, sorted pages, then evidence.
          const [[locked]] = await c.query<RowDataPacket[]>('SELECT id FROM posts WHERE id=? FOR UPDATE', [candidate.post_id]);
          const [[post]] = locked
            ? await c.query<RowDataPacket[]>(
                `SELECT p.id,p.title,p.content_hash,p.published_at,${topicBodyHash} body_hash,${topicBodyText} body_text,${topicBodyHtml} body_html,CASE WHEN cb.status='ok' THEN (cb.completeness='full' AND cb.truncated=0) WHEN o.status='ok' THEN o.truncated=0 ELSE 0 END body_complete FROM posts p ${topicBodyJoins} WHERE p.id=?`,
                [candidate.post_id],
              )
            : [[]];
          const [rows] = await c.query<RowDataPacket[]>(
            `SELECT e.*,hp.label,hp.normalized_label,t.exclusion_reason current_exclusion
           FROM topic_article_evidence e JOIN topic_pages hp ON hp.canonical_id=e.canonical_id AND hp.state<>'merged'
           LEFT JOIN topic_current tc ON tc.source=?
           LEFT JOIN topic_canonical_terms_v3 t ON t.snapshot_id=tc.snapshot_id AND t.id=e.canonical_id
           WHERE e.post_id=? AND e.state<>'revoked' ORDER BY e.canonical_id,e.source LIMIT 1001`,
            [SOURCE, candidate.post_id],
          );
          if (rows.length > 1000) {
            await c.rollback();
            result.truncated = true;
            continue;
          }
          if (!rows.length) {
            await c.rollback();
            continue;
          }
          const checkedAt = options.now?.() ?? new Date();
          if (!(await reserveBudgetOnConnection(c, [{ scope: 'topics:maintenance-match', amount: 1, limit: 5000 }], checkedAt))) {
            await c.rollback();
            result.budgetExhausted = true;
            result.truncated = true;
            break;
          }
          const noise = (r: RowDataPacket) => r.current_exclusion || publicationExclusionReason(r.label) || exclusionReason(r.label);
          const unique = new Map<string, { id: string; label: string }>();
          for (const r of rows) if (!noise(r)) unique.set(r.canonical_id, { id: r.canonical_id, label: r.label });
          const matcher = new TopicMatcher([...unique.values()]);
          const body = cleanTopicBody({ html: post?.body_html, text: post?.body_text });
          const titleHits = matcher.match(post?.title ?? ''),
            bodyHits = matcher.match(body.text);
          const hits = { title: new Set(titleHits.ids), body: new Set(bodyHits.ids) };
          const complete = !titleHits.truncated && !bodyHits.truncated;
          const observations: HistoryObservation[] = rows.map((r) => {
            const source = r.source as HistoryEvidenceSource,
              excluded = Boolean(noise(r));
            const hit = Boolean(post && hits[source].has(r.canonical_id));
            const available =
              source === 'title' ||
              (body.kind !== 'none' &&
                Number(post?.body_complete) === 1 &&
                (post?.body_html?.length ?? 0) <= 2_000_000 &&
                (post?.body_text?.length ?? 0) <= 500_000);
            const state = !post || excluded ? 'revoked' : hit ? 'confirmed' : complete && available ? 'revoked' : 'pending';
            const reason = !post
              ? 'post-deleted'
              : excluded
                ? 'explicit-noise'
                : hit
                  ? null
                  : !available
                    ? body.kind === 'none'
                      ? 'body-unavailable'
                      : 'incomplete-body'
                    : !complete
                      ? 'incomplete-match'
                      : 'no-longer-matches';
            return {
              termId: r.canonical_id,
              label: r.label,
              normalizedLabel: r.normalized_label,
              snapshotId: r.source_snapshot_id,
              postId: Number(r.post_id),
              source,
              state,
              reason,
              postHash: post?.content_hash ?? r.post_hash,
              bodyHash: post?.body_hash ?? r.body_hash,
              matcherVersion: MATCHER_VERSION,
              observedAt: hit && !excluded ? checkedAt : new Date(r.last_observed_at),
              checkedAt,
              publishedAt: post?.published_at ? new Date(post.published_at) : r.published_at ? new Date(r.published_at) : null,
            };
          });
          const applied = await applyHistoryObservations(c, observations, assertLease);
          await assertLease();
          await c.commit();
          result.processed++;
          result.written += applied.written;
          result.revoked += observations.filter((r) => r.state === 'revoked').length;
          result.pending += observations.filter((r) => r.state === 'pending').length;
        } catch (error) {
          await c.rollback();
          throw error;
        } finally {
          c.release();
        }
      }
      return result;
    })) ?? { ...result, leaseBusy: true }
  );
}
