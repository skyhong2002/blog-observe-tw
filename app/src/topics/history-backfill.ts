import type { Pool, RowDataPacket } from 'mysql2/promise';
import { withJobLease } from '../jobs/lease.ts';
import { topicBodyHash, topicBodyJoins } from './body.ts';
import { FREQUENCY_POLICY } from './frequency.ts';
import type { HistoryEvidenceSource } from './history-contracts.ts';
import { historyWritesEnabled } from './history-contracts.ts';
import { applyHistoryObservations, type HistoryObservation } from './history-store.ts';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { publicationExclusionReason } from './publication-noise.ts';

export type HistoryWorkOptions = { enabled?: boolean; limit?: number; maxDurationMs?: number; now?: () => Date; signal?: AbortSignal };
export type HistoryBackfillResult = {
  processed: number;
  written: number;
  completedSnapshots: string[];
  incomplete: boolean;
  disabled?: boolean;
  leaseBusy?: boolean;
};
type Cursor = { postId: number; termId: string; source: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const json = (v: unknown): Cursor | null => (v ? ((typeof v === 'string' ? JSON.parse(v) : v) as Cursor) : null);
/** Capture compatible retained generations before GC. Each keyset page and its checkpoint commit together. */
export async function backfillTopicHistory(
  pool: Pool,
  options: HistoryWorkOptions & { snapshotId?: string } = {},
): Promise<HistoryBackfillResult> {
  const result: HistoryBackfillResult = { processed: 0, written: 0, completedSnapshots: [], incomplete: false };
  if (!(options.enabled ?? historyWritesEnabled())) return { ...result, disabled: true };
  if (options.snapshotId && !uuid.test(options.snapshotId)) throw Error('invalid history snapshot');
  if ([options.limit, options.maxDurationMs].some((n) => n !== undefined && (!Number.isFinite(n) || n <= 0)))
    throw Error('invalid history work bounds');
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit ?? 500)));
  const duration = Math.max(1, Math.min(30_000, options.maxDurationMs ?? 30_000)),
    started = Date.now();
  return (
    (await withJobLease(pool, 'topics', async (assertLease) => {
      const [snapshots] = await pool.query<RowDataPacket[]>(
        `SELECT s.id,s.status FROM topic_snapshots s LEFT JOIN topic_history_backfill_runs r ON r.id=CONCAT('snapshot:',s.id)
       WHERE s.status IN ('published','retiring') AND (r.id IS NULL OR r.status<>'complete') ${options.snapshotId ? 'AND s.id=?' : ''}
       ORDER BY s.generated_at,s.id LIMIT 100`,
        options.snapshotId ? [options.snapshotId] : [],
      );
      for (const snapshot of snapshots) {
        if (options.signal?.aborted || Date.now() - started >= duration) {
          result.incomplete = true;
          break;
        }
        const id = `snapshot:${snapshot.id}`;
        let finished = false;
        while (!finished) {
          if (options.signal?.aborted || Date.now() - started >= duration) {
            result.incomplete = true;
            break;
          }
          await assertLease();
          const c = await pool.getConnection();
          try {
            await c.beginTransaction();
            const now = options.now?.() ?? new Date();
            await c.execute(
              "INSERT INTO topic_history_backfill_runs(id,status,processed,updated_at) VALUES (?,'running',0,?) ON DUPLICATE KEY UPDATE id=VALUES(id)",
              [id, now],
            );
            const [[checkpoint]] = await c.query<RowDataPacket[]>(
              'SELECT status,`cursor` FROM topic_history_backfill_runs WHERE id=? FOR UPDATE',
              [id],
            );
            if (checkpoint.status === 'complete') {
              await c.rollback();
              finished = true;
              continue;
            }
            const cursor = json(checkpoint.cursor);
            const [rows] = await c.query<RowDataPacket[]>(
              `SELECT m.post_id,m.term_id,m.source,t.label,t.normalized_label,i.post_hash,i.body_hash,i.matched_at,i.matcher_version,
             p.id existing_post,p.content_hash current_post_hash,p.published_at,${topicBodyHash} current_body_hash
             FROM topic_matches_v3 m JOIN topic_post_indexes_v3 i ON i.snapshot_id=m.snapshot_id AND i.post_id=m.post_id
             JOIN topic_canonical_terms_v3 t ON t.snapshot_id=m.snapshot_id AND t.id=m.term_id
             LEFT JOIN posts p ON p.id=m.post_id ${topicBodyJoins}
             LEFT JOIN topic_article_evidence captured ON captured.canonical_id=m.term_id AND captured.post_id=m.post_id AND captured.source=m.source
             LEFT JOIN topic_term_frequencies f ON f.snapshot_id=m.snapshot_id AND f.term_id=m.term_id
             LEFT JOIN topic_frequency_runs fr ON fr.snapshot_id=m.snapshot_id AND fr.policy_version=?
             WHERE m.snapshot_id=? AND i.status='ok' AND i.matcher_version=? AND t.policy_version=?
              AND t.exclusion_reason IS NULL AND t.inactive_reason IS NULL AND m.source IN ('title','body')
              AND (m.source='title' OR fr.snapshot_id IS NULL OR COALESCE(f.high_frequency,0)=0)
              AND (captured.canonical_id IS NULL OR captured.checked_at<i.matched_at OR captured.first_observed_at>i.matched_at)
              ${cursor ? 'AND (m.post_id,m.term_id,m.source)>(?,?,?)' : ''}
             ORDER BY m.post_id,m.term_id,m.source LIMIT ?`,
              [
                FREQUENCY_POLICY.version,
                snapshot.id,
                MATCHER_VERSION,
                POLICY_VERSION,
                ...(cursor ? [cursor.postId, cursor.termId, cursor.source] : []),
                limit,
              ],
            );
            const observations: HistoryObservation[] = rows.map((r) => {
              const noise = publicationExclusionReason(r.label),
                deleted = !r.existing_post;
              const fresh = r.post_hash === r.current_post_hash && r.body_hash === r.current_body_hash;
              return {
                termId: r.term_id,
                label: r.label,
                normalizedLabel: r.normalized_label,
                snapshotId: snapshot.id,
                postId: Number(r.post_id),
                source: r.source as HistoryEvidenceSource,
                state: deleted || noise ? 'revoked' : fresh ? 'confirmed' : 'pending',
                reason: deleted ? 'post-deleted' : noise ? 'explicit-noise' : fresh ? null : 'content-changed',
                postHash: r.post_hash,
                bodyHash: r.body_hash,
                matcherVersion: r.matcher_version,
                observedAt: new Date(r.matched_at),
                checkedAt: deleted || noise ? now : new Date(r.matched_at),
                publishedAt: r.published_at ? new Date(r.published_at) : null,
              };
            });
            const applied = await applyHistoryObservations(c, observations, assertLease);
            finished = rows.length < limit;
            const last = rows.at(-1),
              nextCursor = last ? { postId: Number(last.post_id), termId: last.term_id, source: last.source } : cursor;
            await c.execute('UPDATE topic_history_backfill_runs SET status=?,`cursor`=?,processed=processed+?,updated_at=? WHERE id=?', [
              finished ? 'complete' : 'running',
              JSON.stringify({ ...nextCursor, ...(snapshot.status === 'retiring' ? { captureCoverage: 'retained-evidence-only' } : {}) }),
              rows.length,
              now,
              id,
            ]);
            await assertLease();
            await c.commit();
            result.processed += rows.length;
            result.written += applied.written;
            if (finished) result.completedSnapshots.push(snapshot.id);
          } catch (error) {
            await c.rollback();
            throw error;
          } finally {
            c.release();
          }
        }
        if (!finished) break;
      }
      return result;
    })) ?? { ...result, leaseBusy: true, incomplete: true }
  );
}
