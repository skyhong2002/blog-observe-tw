import type { Pool, RowDataPacket } from 'mysql2/promise';
import { withJobLease } from '../jobs/lease.ts';
import { topicBodyHash, topicBodyJoins } from './body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { SOURCE } from './snapshot-client.ts';

const parameters = { baselineDays: 365, highFrequencyRatio: 0.02, reason: 'high-document-frequency-title-only' } as const;
export const FREQUENCY_POLICY = Object.freeze({
  ...parameters,
  version: `topic-frequency-v1:${digest(JSON.stringify(parameters) + MATCHER_VERSION + ':distinct-verified-posts-positive-evidence-dirty-coverage-excluded')}`,
});
export function highDocumentFrequency(matchedPosts: number, totalPosts: number): boolean {
  return totalPosts > 0 && matchedPosts / totalPosts > FREQUENCY_POLICY.highFrequencyRatio;
}
/** Baselines are stored once per hour; HTTP never scans the year-long article corpus. */
export async function refreshTopicFrequencies(pool: Pool, options: { now?: Date; force?: boolean } = {}) {
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw Error('invalid frequency date');
  const from = new Date(now.getTime() - FREQUENCY_POLICY.baselineDays * 86_400_000);
  return (
    (await withJobLease(pool, 'topics', async (assertLease) => {
      const [[current]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
      if (!current) return { status: 'skipped' as const, reason: 'no-current-snapshot' };
      const snapshotId = String(current.snapshot_id);
      const [[previous]] = await pool.query<RowDataPacket[]>('SELECT * FROM topic_frequency_runs WHERE snapshot_id=?', [snapshotId]);
      if (
        !options.force &&
        previous?.policy_version === FREQUENCY_POLICY.version &&
        new Date(previous.updated_at).getTime() > now.getTime() - 3_600_000
      )
        return {
          status: 'fresh' as const,
          snapshotId,
          totalPosts: Number(previous.total_posts),
          coveredPosts: Number(previous.covered_posts),
        };
      await assertLease();
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [[fresh]] = await c.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=? FOR UPDATE', [SOURCE]);
        if (fresh?.snapshot_id !== snapshotId) {
          await c.rollback();
          return { status: 'skipped' as const, reason: 'snapshot-changed' };
        }
        const [[selection]] = await c.query<RowDataPacket[]>(
          "SELECT snapshot_id FROM topic_policy_selections WHERE snapshot_id=? AND policy_version=? AND status='ready'",
          [snapshotId, POLICY_VERSION],
        );
        if (!selection) {
          await c.rollback();
          return { status: 'skipped' as const, reason: 'selection-not-ready' };
        }
        const [[counts]] = await c.query<RowDataPacket[]>(
          `SELECT COUNT(*) total_posts,
        COALESCE(SUM(i.status='ok' AND i.matcher_version=? AND i.needs_refresh=0 AND (i.post_hash<=>p.content_hash) AND (i.body_hash<=>(${topicBodyHash}))),0) covered_posts
        FROM posts p JOIN blogs b ON b.id=p.blog_id
        LEFT JOIN topic_post_indexes_v3 i ON i.post_id=p.id AND i.snapshot_id=? ${topicBodyJoins}
        WHERE b.status='verified' AND p.published_at>=? AND p.published_at<=?`,
          [MATCHER_VERSION, snapshotId, from, now],
        );
        const totalPosts = Number(counts.total_posts),
          coveredPosts = Number(counts.covered_posts);
        await c.execute('DELETE FROM topic_term_frequencies WHERE snapshot_id=?', [snapshotId]);
        // Keep all real positive title/body observations, including indexes marked dirty
        // after vocabulary growth. They are lower-bound evidence, not claims of complete
        // coverage. Dirty articles do not count in covered_posts until rematched.
        await c.execute(
          `INSERT INTO topic_term_frequencies(snapshot_id,term_id,matched_posts,title_posts,high_frequency)
        SELECT ?,e.term_id,COUNT(*),SUM(e.title_hit),IF(? > 0 AND COUNT(*) > ? * ?,1,0)
        FROM (
          SELECT m.term_id,p.id,MAX(m.source='title') title_hit
          FROM posts p JOIN blogs b ON b.id=p.blog_id
          JOIN topic_post_indexes_v3 i ON i.post_id=p.id AND i.snapshot_id=?
          JOIN topic_matches_v3 m ON m.post_id=p.id AND m.snapshot_id=i.snapshot_id
          JOIN topic_canonical_terms_v3 t ON t.snapshot_id=m.snapshot_id AND t.id=m.term_id
          ${topicBodyJoins}
          WHERE b.status='verified' AND p.published_at>=? AND p.published_at<=?
          AND i.status='ok' AND i.matcher_version=? AND (i.post_hash<=>p.content_hash) AND (i.body_hash<=>(${topicBodyHash}))
          AND t.policy_version=? AND t.exclusion_reason IS NULL AND t.inactive_reason IS NULL
          AND m.source IN ('title','body') GROUP BY m.term_id,p.id
        ) e GROUP BY e.term_id`,
          [snapshotId, totalPosts, totalPosts, FREQUENCY_POLICY.highFrequencyRatio, snapshotId, from, now, MATCHER_VERSION, POLICY_VERSION],
        );
        await c.execute(
          `INSERT INTO topic_frequency_runs(snapshot_id,baseline_from,baseline_until,total_posts,covered_posts,threshold_ratio,policy_version,updated_at) VALUES (?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE baseline_from=VALUES(baseline_from),baseline_until=VALUES(baseline_until),total_posts=VALUES(total_posts),covered_posts=VALUES(covered_posts),threshold_ratio=VALUES(threshold_ratio),policy_version=VALUES(policy_version),updated_at=VALUES(updated_at)`,
          [snapshotId, from, now, totalPosts, coveredPosts, FREQUENCY_POLICY.highFrequencyRatio, FREQUENCY_POLICY.version, now],
        );
        await assertLease();
        await c.commit();
        return {
          status: 'refreshed' as const,
          snapshotId,
          totalPosts,
          coveredPosts,
          baselineFrom: from.toISOString(),
          baselineUntil: now.toISOString(),
        };
      } catch (error) {
        await c.rollback();
        throw error;
      } finally {
        c.release();
      }
    })) ?? { status: 'skipped' as const, reason: 'lease-busy' }
  );
}
