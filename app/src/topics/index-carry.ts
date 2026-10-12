import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { FREQUENCY_POLICY } from './frequency.ts';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';

/** Copy into the unpublished generation inside its publication transaction; old evidence remains
 * available for pointer rollback. Existing destination indexes are never overwritten, so retrying
 * publication cannot undo a rematch or mix stale source hits into a refreshed destination article. */
export async function carryTopicIndexes(c: Pick<PoolConnection, 'query' | 'execute'>, oldId: string | null, newId: string) {
  if (!oldId || oldId === newId) return { reused: false, recentQueued: false };
  const [policies] = await c.query<RowDataPacket[]>(
    "SELECT snapshot_id FROM topic_policy_selections WHERE snapshot_id IN (?,?) AND status='ready' AND policy_version=?",
    [oldId, newId, POLICY_VERSION],
  );
  if (policies.length !== 2) return { reused: false, recentQueued: false };
  const [[added]] = await c.query<RowDataPacket[]>(
    `SELECT COUNT(*) n FROM topic_canonical_terms_v3 n LEFT JOIN topic_canonical_terms_v3 o ON o.snapshot_id=? AND o.id=n.id
     AND o.exclusion_reason IS NULL AND o.inactive_reason IS NULL AND o.policy_version=?
     WHERE n.snapshot_id=? AND n.exclusion_reason IS NULL AND n.inactive_reason IS NULL AND n.policy_version=? AND o.id IS NULL`,
    [oldId, POLICY_VERSION, newId, POLICY_VERSION],
  );
  // Copy hits first, only for destination articles not already indexed. Existing destination indexes
  // may contain a newer post/body hash, including a valid zero-hit result; never add old hits to them.
  await c.execute(
    `INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source)
     SELECT ?,m.post_id,m.term_id,m.source FROM topic_matches_v3 m
     JOIN topic_post_indexes_v3 old_index ON old_index.snapshot_id=m.snapshot_id AND old_index.post_id=m.post_id
     JOIN topic_canonical_terms_v3 t ON t.snapshot_id=? AND t.id=m.term_id
     LEFT JOIN topic_post_indexes_v3 destination ON destination.snapshot_id=? AND destination.post_id=m.post_id
     WHERE m.snapshot_id=? AND destination.post_id IS NULL AND old_index.matcher_version=?
       AND t.exclusion_reason IS NULL AND t.inactive_reason IS NULL AND t.policy_version=?
     ON DUPLICATE KEY UPDATE source=VALUES(source)`,
    [newId, newId, newId, oldId, MATCHER_VERSION, POLICY_VERSION],
  );
  await c.execute(
    `INSERT INTO topic_post_indexes_v3(snapshot_id,post_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind,body_obtained_at,needs_refresh)
     SELECT ?,i.post_id,i.input_hash,i.post_hash,i.body_hash,i.matched_at,i.status,i.matcher_version,i.cleanup_version,i.body_kind,i.body_obtained_at,
       IF(i.needs_refresh=1 OR (? > 0 AND i.matcher_version=? AND p.published_at>=DATE_SUB(s.generated_at,INTERVAL 48 HOUR) AND p.published_at<=s.generated_at),1,0)
     FROM topic_post_indexes_v3 i JOIN posts p ON p.id=i.post_id JOIN topic_snapshots s ON s.id=? WHERE i.snapshot_id=?
     ON DUPLICATE KEY UPDATE post_id=VALUES(post_id)`,
    [newId, Number(added.n), MATCHER_VERSION, newId, oldId],
  );
  // Preserve a destination baseline already refreshed by the new generation. A compatible old
  // baseline may be copied once; the explicit observation window and policy identity remain intact.
  const [[baseline]] = await c.query<RowDataPacket[]>(
    'SELECT old.snapshot_id FROM topic_frequency_runs old LEFT JOIN topic_frequency_runs destination ON destination.snapshot_id=? WHERE old.snapshot_id=? AND old.policy_version=? AND destination.snapshot_id IS NULL',
    [newId, oldId, FREQUENCY_POLICY.version],
  );
  if (baseline) {
    await c.execute(
      `INSERT INTO topic_frequency_runs(snapshot_id,baseline_from,baseline_until,total_posts,covered_posts,threshold_ratio,policy_version,updated_at)
       SELECT ?,baseline_from,baseline_until,total_posts,IF(? > 0,0,covered_posts),threshold_ratio,policy_version,updated_at FROM topic_frequency_runs WHERE snapshot_id=?
       ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)`,
      [newId, Number(added.n), oldId],
    );
    await c.execute(
      `INSERT INTO topic_term_frequencies(snapshot_id,term_id,matched_posts,title_posts,high_frequency)
       SELECT ?,f.term_id,f.matched_posts,f.title_posts,f.high_frequency FROM topic_term_frequencies f
       JOIN topic_canonical_terms_v3 t ON t.snapshot_id=? AND t.id=f.term_id
       WHERE f.snapshot_id=? AND t.exclusion_reason IS NULL AND t.inactive_reason IS NULL AND t.policy_version=?
       ON DUPLICATE KEY UPDATE term_id=VALUES(term_id)`,
      [newId, newId, oldId, POLICY_VERSION],
    );
  }
  return { reused: true, recentQueued: Number(added.n) > 0 };
}
