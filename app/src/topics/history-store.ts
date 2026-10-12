import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { topicBodyHash, topicBodyJoins } from './body.ts';
import { FREQUENCY_POLICY } from './frequency.ts';
import type { HistoryEvidenceSource, HistoryEvidenceState, HistoryRecordInput } from './history-contracts.ts';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { publicationExclusionReason } from './publication-noise.ts';

export const HISTORY_VERSION = 'topic-history-v1';
export type HistoryObservation = {
  termId: string;
  label: string;
  normalizedLabel: string;
  snapshotId: string;
  postId: number;
  source: HistoryEvidenceSource;
  state: HistoryEvidenceState;
  reason: string | null;
  postHash: string | null;
  bodyHash: string | null;
  matcherVersion: string;
  observedAt: Date;
  checkedAt: Date;
  publishedAt: Date | null;
};
/** DATETIME stores whole seconds. A tied revocation always wins over an observation. */
export function acceptsHistoryTransition(
  previous: { state: string; checkedAt: Date } | null,
  next: { state: string; checkedAt: Date },
): boolean {
  if (!previous) return true;
  const oldTime = Math.floor(previous.checkedAt.getTime() / 1000);
  const newTime = Math.floor(next.checkedAt.getTime() / 1000);
  if (newTime !== oldTime) return newTime > oldTime;
  if (previous.state === 'revoked') return next.state === 'revoked';
  if (next.state === 'revoked') return true;
  // A replay may recognise newly stale hashes, never revive an equally old pending observation.
  return previous.state === next.state || next.state === 'pending';
}
export function aggregateHistoryState(counts: { confirmed: number; pending: number }): 'active' | 'pending' | 'revoked' {
  return counts.confirmed > 0 ? 'active' : counts.pending > 0 ? 'pending' : 'revoked';
}
const date = (value: unknown) => new Date(value as string | Date);
const minDate = (a: Date, b: Date) => (a < b ? a : b);
const maxDate = (a: Date, b: Date) => (a > b ? a : b);

/** Caller owns the transaction. Lock all pages in stable order before locking any evidence. */
export async function applyHistoryObservations(c: PoolConnection, observations: HistoryObservation[], assertLease: () => Promise<void>) {
  if (observations.length > 1000) throw Error('topic history observation cap');
  const byTerm = new Map<string, HistoryObservation[]>();
  for (const o of observations) {
    if (!/^[a-f0-9]{64}$/.test(o.termId) || !Number.isSafeInteger(o.postId) || o.postId < 1 || !['title', 'body'].includes(o.source))
      throw Error('invalid topic history observation');
    if (![o.observedAt, o.checkedAt].every((d) => Number.isFinite(d.getTime()))) throw Error('invalid topic history date');
    const list = byTerm.get(o.termId) ?? [];
    list.push(o);
    byTerm.set(o.termId, list);
  }
  const pages = new Map<string, RowDataPacket>();
  for (const id of [...byTerm.keys()].sort()) {
    const o = byTerm.get(id)![0];
    await c.execute(
      `INSERT INTO topic_pages(canonical_id,label,normalized_label,state,first_snapshot_id,last_snapshot_id,first_observed_at,last_observed_at,last_article_at,updated_at)
       VALUES (?,?,?,'pending',?,?,?,?,?,?) ON DUPLICATE KEY UPDATE canonical_id=VALUES(canonical_id)`,
      [id, o.label, o.normalizedLabel, o.snapshotId, o.snapshotId, o.observedAt, o.observedAt, o.publishedAt, o.checkedAt],
    );
    const [[page]] = await c.query<RowDataPacket[]>('SELECT * FROM topic_pages WHERE canonical_id=? FOR UPDATE', [id]);
    pages.set(id, page);
  }
  let written = 0;
  for (const id of [...byTerm.keys()].sort()) {
    const page = pages.get(id)!;
    if (page.state === 'merged') continue;
    let changed = false;
    for (const o of byTerm.get(id)!.sort((a, b) => a.postId - b.postId || a.source.localeCompare(b.source))) {
      const [[old]] = await c.query<RowDataPacket[]>(
        'SELECT * FROM topic_article_evidence WHERE canonical_id=? AND post_id=? AND source=? FOR UPDATE',
        [id, o.postId, o.source],
      );
      if (!acceptsHistoryTransition(old ? { state: old.state, checkedAt: date(old.checked_at) } : null, o)) {
        // Earlier provenance is monotonic metadata, not permission to resurrect old state.
        if (old && o.observedAt < date(old.first_observed_at)) {
          await c.execute('UPDATE topic_article_evidence SET first_observed_at=? WHERE canonical_id=? AND post_id=? AND source=?', [
            o.observedAt,
            id,
            o.postId,
            o.source,
          ]);
          changed = true;
          written++;
        }
        continue;
      }
      // Preserve an explicit topic tombstone; only a newer, deliberate reconciliation may clear it.
      if (page.state === 'revoked' && page.reason === 'explicit-noise' && o.state !== 'revoked') continue;
      const first = old ? minDate(date(old.first_observed_at), o.observedAt) : o.observedAt;
      const last = old ? maxDate(date(old.last_observed_at), o.observedAt) : o.observedAt;
      await c.execute(
        `INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,reason,source_snapshot_id,post_hash,body_hash,matcher_version,first_observed_at,last_observed_at,checked_at,published_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE state=VALUES(state),reason=VALUES(reason),source_snapshot_id=VALUES(source_snapshot_id),post_hash=VALUES(post_hash),body_hash=VALUES(body_hash),matcher_version=VALUES(matcher_version),first_observed_at=VALUES(first_observed_at),last_observed_at=VALUES(last_observed_at),checked_at=VALUES(checked_at),published_at=VALUES(published_at)`,
        [
          id,
          o.postId,
          o.source,
          o.state,
          o.reason,
          o.snapshotId,
          o.postHash,
          o.bodyHash,
          o.matcherVersion,
          first,
          last,
          o.checkedAt,
          o.publishedAt,
        ],
      );
      written++;
      changed = true;
    }
    if (changed) {
      const [[stats]] = await c.query<RowDataPacket[]>(
        `SELECT SUM(state='confirmed') confirmed,SUM(state='pending') pending,MIN(first_observed_at) firstObserved,MAX(last_observed_at) lastObserved,MAX(published_at) lastArticle,MAX(checked_at) checkedAt,SUM(reason='explicit-noise') noiseCount,COUNT(*) total FROM topic_article_evidence WHERE canonical_id=?`,
        [id],
      );
      const state = aggregateHistoryState({ confirmed: Number(stats.confirmed), pending: Number(stats.pending) });
      const latest = byTerm.get(id)!.reduce((a, b) => (a.observedAt > b.observedAt ? a : b));
      const earliest = byTerm.get(id)!.reduce((a, b) => (a.observedAt < b.observedAt ? a : b));
      await c.execute(
        `UPDATE topic_pages SET state=?,reason=?,first_snapshot_id=IF(first_observed_at>?, ?,first_snapshot_id),first_observed_at=?,last_observed_at=?,last_article_at=?,updated_at=GREATEST(updated_at,?),last_snapshot_id=IF(last_observed_at<=?, ?,last_snapshot_id) WHERE canonical_id=? AND state<>'merged'`,
        [
          state,
          state === 'revoked' ? (Number(stats.noiseCount) === Number(stats.total) ? 'explicit-noise' : 'all-evidence-revoked') : null,
          earliest.observedAt,
          earliest.snapshotId,
          stats.firstObserved,
          stats.lastObserved,
          stats.lastArticle,
          stats.checkedAt,
          latest.observedAt,
          latest.snapshotId,
          id,
        ],
      );
    }
  }
  await assertLease();
  return { written };
}

/** Successful current matcher hook. Missing historical terms are NOT negative evidence. */
export async function recordTopicHistory(c: PoolConnection, input: HistoryRecordInput, assertLease: () => Promise<void>) {
  if (!input.complete) return { written: 0 };
  const [[post]] = await c.query<RowDataPacket[]>(
    `SELECT p.id,p.content_hash,p.published_at,${topicBodyHash} body_hash,CASE WHEN cb.status='ok' THEN (cb.completeness='full' AND cb.truncated=0 AND COALESCE(OCTET_LENGTH(cb.body_html),0)<=2000000 AND COALESCE(OCTET_LENGTH(cb.body_text),0)<=500000) WHEN o.status='ok' THEN (o.truncated=0 AND COALESCE(OCTET_LENGTH(o.body_text),0)<=500000) ELSE 0 END body_complete FROM posts p ${topicBodyJoins} WHERE p.id=?`,
    [input.postId],
  );
  if (!post) return { written: 0 };
  const [existing] = await c.query<RowDataPacket[]>(
    'SELECT * FROM topic_article_evidence WHERE post_id=? ORDER BY canonical_id,source LIMIT 1001',
    [input.postId],
  );
  if (existing.length > 1000) throw Error('topic history post evidence cap');
  const ids = [...new Set([...input.records.map((r) => r.termId), ...existing.map((r) => String(r.canonical_id))])];
  if (!ids.length) return { written: 0 };
  const [terms] = await c.query<RowDataPacket[]>(
    `SELECT t.id,t.label,t.normalized_label,t.exclusion_reason,t.inactive_reason,IF(fr.snapshot_id IS NULL,0,COALESCE(f.high_frequency,0)) high_frequency FROM topic_canonical_terms_v3 t LEFT JOIN topic_term_frequencies f ON f.snapshot_id=t.snapshot_id AND f.term_id=t.id LEFT JOIN topic_frequency_runs fr ON fr.snapshot_id=t.snapshot_id AND fr.policy_version=? WHERE t.snapshot_id=? AND t.policy_version=? AND t.id IN (?)`,
    [FREQUENCY_POLICY.version, input.snapshotId, POLICY_VERSION, ids],
  );
  const covered = new Map(
    terms.filter((t) => !t.exclusion_reason && !t.inactive_reason && !publicationExclusionReason(t.label)).map((t) => [String(t.id), t]),
  );
  const positives = new Set(input.records.map((r) => `${r.termId}:${r.source}`));
  const observations: HistoryObservation[] = [];
  const fresh = post.content_hash === input.postHash && post.body_hash === input.bodyHash;
  const make = (
    id: string,
    source: HistoryEvidenceSource,
    state: HistoryEvidenceState,
    reason: string | null,
    observedAt: Date,
  ): HistoryObservation => ({
    termId: id,
    label: covered.get(id)!.label,
    normalizedLabel: covered.get(id)!.normalized_label,
    snapshotId: input.snapshotId,
    postId: input.postId,
    source,
    state,
    reason,
    postHash: input.postHash,
    bodyHash: input.bodyHash,
    matcherVersion: MATCHER_VERSION,
    observedAt,
    checkedAt: input.matchedAt,
    publishedAt: post.published_at ? date(post.published_at) : null,
  });
  for (const r of input.records)
    if (covered.has(r.termId) && (r.source === 'title' || !Number(covered.get(r.termId)!.high_frequency)))
      observations.push(make(r.termId, r.source, fresh ? 'confirmed' : 'pending', fresh ? null : 'content-changed', input.matchedAt));
  for (const old of existing) {
    const id = String(old.canonical_id),
      source = old.source as HistoryEvidenceSource;
    if (!covered.has(id) || positives.has(`${id}:${source}`) || (source === 'body' && (!input.bodyCovered || !Number(post.body_complete))))
      continue;
    observations.push({
      ...make(id, source, fresh ? 'revoked' : 'pending', fresh ? 'no-longer-matches' : 'content-changed', date(old.last_observed_at)),
      snapshotId: old.source_snapshot_id,
    });
  }
  return applyHistoryObservations(c, observations, assertLease);
}
