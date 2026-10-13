import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export const SNAPSHOT_RETENTION = { keepPublished: 32, maxVersions: 64, batchRows: 500, maxRows: 250_000, maxMs: 10_000 } as const;
export type RetentionOptions = {
  keepPublished?: number;
  maxRows?: number;
  maxMs?: number;
  batchRows?: number;
  pinnedSnapshotIds?: readonly string[];
};
export type RetentionReport = { deletedRows: number; retiredSnapshots: number; backlog: boolean; publishedVersions: number };
const observed = "JSON_UNQUOTE(JSON_EXTRACT(s.manifest,'$.coverage'))='observed-article-window'";
const unfinishedWindow = "status IN ('scanning','ready')";
const activeImport = "status IN ('scanning','validating','preparing','ready')";
/** All tables here are disposable per-generation data. Never mutate legacy/v2 rollback tables. */
const tables = [
  ['topic_matches_v3', 'snapshot_id'],
  ['topic_post_indexes_v3', 'snapshot_id'],
  ['topic_term_frequencies', 'snapshot_id'],
  ['topic_frequency_runs', 'snapshot_id'],
  ['topic_term_aliases_v3', 'snapshot_id'],
  ['topic_canonical_terms_v3', 'snapshot_id'],
  ['topic_policy_selections', 'snapshot_id'],
  ['topic_window_articles', 'run_id'],
  ['topic_snapshot_pages', 'snapshot_id'],
  ['topic_snapshot_runs', 'snapshot_id'],
  ['topic_terms', 'snapshot_id'],
  ['topic_window_runs', 'id'],
  ['topic_snapshots', 'id'],
] as const;
const integer = (input: number | undefined, fallback: number, ceiling: number) =>
  input === undefined ? fallback : Math.min(ceiling, Math.max(0, Math.floor(Number.isFinite(input) ? input : 0)));
export function retentionLimits(options: RetentionOptions = {}) {
  return {
    keepPublished: integer(options.keepPublished, SNAPSHOT_RETENTION.keepPublished, SNAPSHOT_RETENTION.keepPublished),
    maxRows: integer(options.maxRows, SNAPSHOT_RETENTION.maxRows, SNAPSHOT_RETENTION.maxRows),
    maxMs: integer(options.maxMs, SNAPSHOT_RETENTION.maxMs, SNAPSHOT_RETENTION.maxMs),
    batchRows: Math.max(1, integer(options.batchRows, SNAPSHOT_RETENTION.batchRows, SNAPSHOT_RETENTION.batchRows)),
  };
}
/** Shared by the pre-start guard and diagnostics; full upstream snapshots are deliberately outside this GC. */
export async function canStartWindowSnapshot(pool: Pool, maxVersions: number = SNAPSHOT_RETENTION.maxVersions) {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) n FROM topic_snapshots s WHERE ${observed} AND s.status IN ('published','retiring')`,
  );
  const publishedVersions = Number(row.n);
  return { allowed: publishedVersions <= maxVersions, blocked: publishedVersions > maxVersions, publishedVersions };
}
function protection() {
  return `EXISTS (SELECT 1 FROM topic_current WHERE snapshot_id=s.id)
    OR EXISTS (SELECT 1 FROM topic_window_runs WHERE (id=s.id OR parent_run_id=s.id) AND ${unfinishedWindow})
    OR EXISTS (SELECT 1 FROM topic_snapshot_runs WHERE snapshot_id=s.id AND ${activeImport})
    OR EXISTS (SELECT 1 FROM topic_generation_proof_contracts WHERE snapshot_id=s.id)
    OR EXISTS (SELECT 1 FROM topic_staged_scan_runs WHERE target_snapshot_id=s.id AND status IN ('scanning','scanned-as-of'))
    OR EXISTS (SELECT 1 FROM topic_post_indexes_v2 WHERE snapshot_id=s.id)
    OR EXISTS (SELECT 1 FROM topic_post_indexes WHERE snapshot_id=s.id)`;
}
async function retainedIds(c: Pool | PoolConnection, keepPublished: number, pinned: readonly string[]) {
  const [rows] = await c.query<RowDataPacket[]>(
    `SELECT s.id FROM topic_snapshots s WHERE ${observed} AND s.status='published' ORDER BY s.generated_at DESC,s.id DESC LIMIT ${keepPublished}`,
  );
  return [...new Set([...pinned, ...rows.map((r) => String(r.id))])];
}
async function candidate(c: Pool | PoolConnection, retained: readonly string[]) {
  const [rows] = await c.query<RowDataPacket[]>(
    `SELECT s.id FROM topic_snapshots s WHERE ${observed} AND s.status IN ('published','retiring')
    AND (s.status='retiring' OR EXISTS (SELECT 1 FROM topic_window_runs r WHERE r.id=s.id AND r.status='published'))
    ${retained.length ? 'AND s.id NOT IN (?)' : ''} AND NOT (${protection()})
    ORDER BY s.generated_at,s.id LIMIT 1`,
    retained.length ? [retained] : [],
  );
  return rows[0]?.id as string | undefined;
}
/**
 * Requires the caller's exclusive topics lease. Each batch also locks current pointers and the
 * snapshot, rechecks every protection, and commits at most 500 deleted rows. Publication MUST
 * reject status=retiring before changing a pointer; a partially retired snapshot is never usable.
 * Keeping the complete current vocabulary does not mean retaining duplicate 15-minute pools
 * forever. Only superseded local observed-window generations are retired, oldest first; all raw
 * terms in the current, staged, imported, pinned and legacy rollback generations remain intact.
 */
export async function cleanupTopicSnapshots(
  pool: Pool,
  assertLease: () => Promise<void>,
  options: RetentionOptions = {},
): Promise<RetentionReport> {
  const limits = retentionLimits(options),
    deadline = Date.now() + limits.maxMs,
    pinned = options.pinnedSnapshotIds ?? [];
  let deletedRows = 0,
    retiredSnapshots = 0;
  while (deletedRows < limits.maxRows && Date.now() < deadline) {
    await assertLease();
    const retained = await retainedIds(pool, limits.keepPublished, pinned),
      id = await candidate(pool, retained);
    if (!id) break;
    const c = await pool.getConnection();
    let batchDeleted = 0,
      finished = false,
      eligible = false;
    try {
      await c.beginTransaction();
      // Publication is serialized by the topics lease; the locks additionally guard pointer updates.
      await c.query<RowDataPacket[]>('SELECT source,snapshot_id FROM topic_current FOR UPDATE');
      const [[snapshot]] = await c.query<RowDataPacket[]>('SELECT id,status FROM topic_snapshots WHERE id=? FOR UPDATE', [id]);
      if (snapshot && ['published', 'retiring'].includes(snapshot.status)) {
        const currentRetained = await retainedIds(c, limits.keepPublished, pinned);
        const [[protectedRow]] = await c.query<RowDataPacket[]>(`SELECT (${protection()}) protected FROM topic_snapshots s WHERE s.id=?`, [
          id,
        ]);
        eligible = !currentRetained.includes(id) && !Number(protectedRow?.protected ?? 1);
        if (eligible) {
          await c.execute("UPDATE topic_snapshots SET status='retiring' WHERE id=? AND status='published'", [id]);
          const allowance = Math.min(limits.batchRows, limits.maxRows - deletedRows);
          for (const [table, column] of tables) {
            if (batchDeleted >= allowance || Date.now() >= deadline) break;
            const [result] = await c.execute<ResultSetHeader>(`DELETE FROM ${table} WHERE ${column}=? LIMIT ${allowance - batchDeleted}`, [
              id,
            ]);
            batchDeleted += result.affectedRows;
            if (table === 'topic_snapshots' && result.affectedRows) finished = true;
          }
        }
      }
      await assertLease();
      await c.commit();
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
    deletedRows += batchDeleted;
    if (finished) retiredSnapshots++;
    // A newly protected target is retried on the next run, without spinning within this deadline.
    if (!eligible || !batchDeleted) break;
  }
  const retained = await retainedIds(pool, limits.keepPublished, pinned);
  const backlog = Boolean(await candidate(pool, retained));
  const { publishedVersions } = await canStartWindowSnapshot(pool);
  return { deletedRows, retiredSnapshots, backlog, publishedVersions };
}
