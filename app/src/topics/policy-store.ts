import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { POLICY_VERSION, projectTopicTerms } from './policy.ts';

type SourceTerm = { id: string; label: string; payload: unknown };
/** Caller holds the topics lease and transaction. Raw upstream labels/payloads are never overwritten. */
export async function writeTopicPolicy(connection: Pick<PoolConnection, 'query' | 'execute'>, snapshotId: string, terms: SourceTerm[]) {
  const projection = projectTopicTerms(terms);
  await connection.execute('DELETE FROM topic_term_aliases WHERE snapshot_id=?', [snapshotId]);
  await connection.execute('DELETE FROM topic_canonical_terms WHERE snapshot_id=?', [snapshotId]);
  for (let offset = 0; offset < projection.terms.length; offset += 100) {
    const rows = projection.terms.slice(offset, offset + 100);
    await connection.query(
      'INSERT INTO topic_canonical_terms(snapshot_id,id,normalized_label,label,exclusion_reason,occurrences,policy_version) VALUES ?',
      [
        rows.map((t) => [
          snapshotId,
          t.id,
          t.normalizedLabel,
          t.label,
          t.exclusionReason,
          Math.min(2147483647, t.occurrences),
          POLICY_VERSION,
        ]),
      ],
    );
  }
  for (let offset = 0; offset < projection.aliases.length; offset += 100) {
    const rows = projection.aliases.slice(offset, offset + 100);
    await connection.query('INSERT INTO topic_term_aliases(snapshot_id,term_id,canonical_id) VALUES ?', [
      rows.map((t) => [snapshotId, t.termId, t.canonicalId]),
    ]);
  }
  return projection;
}
/** Build a missing policy projection under the topics job lease, without republishing the vocabulary. */
export async function ensureTopicPolicy(pool: Pool, snapshotId: string) {
  const [[state]] = await pool.query<RowDataPacket[]>(
    `SELECT
    (SELECT COUNT(*) FROM topic_terms WHERE snapshot_id=?) sourceCount,
    (SELECT COUNT(*) FROM topic_term_aliases WHERE snapshot_id=?) aliasCount,
    (SELECT COUNT(*) FROM topic_canonical_terms WHERE snapshot_id=? AND policy_version<>?) obsoleteCount,
    (SELECT COUNT(*) FROM topic_canonical_terms WHERE snapshot_id=?) canonicalCount`,
    [snapshotId, snapshotId, snapshotId, POLICY_VERSION, snapshotId],
  );
  if (
    Number(state.sourceCount) === Number(state.aliasCount) &&
    !Number(state.obsoleteCount) &&
    (Number(state.canonicalCount) > 0 || !Number(state.sourceCount))
  )
    return;
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<RowDataPacket[]>('SELECT id,label,payload FROM topic_terms WHERE snapshot_id=?', [snapshotId]);
    await writeTopicPolicy(
      connection,
      snapshotId,
      rows.map((r) => ({ id: r.id, label: r.label, payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload })),
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
