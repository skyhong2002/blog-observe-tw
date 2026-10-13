import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { type ActiveState, admitActiveTerm, sourceTermMetadata, startActiveSelection } from './active-set.ts';
import {
  ACTIVE_TOPIC_LIMITS,
  digest,
  displayTerm,
  exclusionReason,
  mergeExclusionReasons,
  NORMALIZATION_VERSION,
  normalizeTerm,
  POLICY_VERSION,
  storedNormalizedLabel,
} from './policy.ts';

type Connection = Pick<PoolConnection, 'query' | 'execute'>;
type SourceTerm = { id: string; label: string; payload: unknown };
type Context = { asOf: Date; windowObservedAt: Date | null; total: number; coverage: string };
const parse = (raw: unknown): Record<string, unknown> => (typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>));
async function context(c: Connection, snapshotId: string): Promise<Context> {
  const [[row]] = await c.query<RowDataPacket[]>('SELECT manifest FROM topic_snapshots WHERE id=?', [snapshotId]);
  if (!row) throw Error('topic snapshot missing');
  const manifest = parse(row.manifest);
  const asOf = new Date(String(manifest.generatedAt));
  if (!Number.isFinite(asOf.getTime())) throw Error('topic snapshot anchor invalid');
  const window = manifest.coverage === 'observed-article-window' ? (manifest.window as { until?: string } | undefined) : undefined;
  const observed = window?.until ? new Date(window.until) : null;
  return {
    asOf,
    windowObservedAt: observed && Number.isFinite(observed.getTime()) ? observed : null,
    total: Number(manifest.total),
    coverage: String(manifest.coverage),
  };
}
const baseConfig = (ctx: Context) => ({
  limits: ACTIVE_TOPIC_LIMITS,
  normalization: NORMALIZATION_VERSION,
  windowDateFallback: ctx.windowObservedAt?.toISOString() ?? null,
  budgetReached: false,
  exclusionReasons: {},
  inactiveReasons: {},
});
async function initialize(c: Connection, snapshotId: string, ctx: Context) {
  await c.execute(
    `INSERT INTO topic_policy_selections(snapshot_id,policy_version,status,as_of,config) VALUES (?,?,'building',?,?)
    ON DUPLICATE KEY UPDATE policy_version=VALUES(policy_version),selection_id=NULL,status='building',\`cursor\`=NULL,as_of=VALUES(as_of),total_terms=0,eligible_terms=0,active_terms=0,code_points=0,estimated_bytes=0,config=VALUES(config)`,
    [snapshotId, POLICY_VERSION, ctx.asOf, JSON.stringify(baseConfig(ctx))],
  );
}
/** One raw page is merged exactly once because its cursor commits in the same transaction. */
async function projectPage(c: Connection, snapshotId: string, ctx: Context, cursor: string | null) {
  const [raw] = await c.query<RowDataPacket[]>(
    'SELECT id,label,payload FROM topic_terms WHERE snapshot_id=? AND id>? ORDER BY id LIMIT 500',
    [snapshotId, cursor ?? ''],
  );
  if (!raw.length) return false;
  const ids = [...new Set(raw.map((t) => digest(normalizeTerm(String(t.label)))))];
  const [previous] = await c.query<RowDataPacket[]>('SELECT * FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id IN (?) FOR UPDATE', [
    snapshotId,
    ids,
  ]);
  const groups = new Map<string, RowDataPacket>(previous.map((t) => [t.id, t]));
  const aliases: unknown[][] = [];
  for (const term of raw) {
    const normalized = normalizeTerm(String(term.label));
    const id = digest(normalized);
    const metadata = sourceTermMetadata(term.payload, ctx.windowObservedAt, ctx.asOf);
    const old = groups.get(id);
    const winner =
      !old ||
      metadata.articleCount > Number(old.winner_count) ||
      (metadata.articleCount === Number(old.winner_count) && String(term.id) < String(old.winner_id));
    const last = old?.last_published_at ? new Date(old.last_published_at) : null;
    groups.set(id, {
      ...(old ?? {}),
      id,
      normalized_label: storedNormalizedLabel(String(term.label)),
      label: winner ? displayTerm(String(term.label)) : old!.label,
      winner_id: winner ? term.id : old!.winner_id,
      winner_count: winner ? metadata.articleCount : Number(old!.winner_count),
      article_count: Math.max(Number(old?.article_count ?? 0), metadata.articleCount),
      last_published_at: !last || (metadata.lastPublishedAt && metadata.lastPublishedAt > last) ? metadata.lastPublishedAt : last,
      occurrences: Math.min(2_147_483_647, Number(old?.occurrences ?? 0) + metadata.articleCount),
      exclusion_reason: mergeExclusionReasons(old?.exclusion_reason ?? null, exclusionReason(String(term.label), term.payload)),
    } as RowDataPacket);
    aliases.push([snapshotId, term.id, id]);
  }
  // A fixed-width tuple catches schema/value drift before SQL execution.
  const records = [...groups.values()].map(
    (t): [unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown, unknown] => [
      snapshotId,
      t.id,
      t.normalized_label,
      t.label,
      t.exclusion_reason,
      t.occurrences,
      POLICY_VERSION,
      t.article_count,
      t.last_published_at,
      t.winner_id,
      t.winner_count,
      'pending-selection',
    ],
  );
  await c.query(
    `INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,exclusion_reason,occurrences,policy_version,article_count,last_published_at,winner_id,winner_count,inactive_reason) VALUES ?
    ON DUPLICATE KEY UPDATE normalized_label=VALUES(normalized_label),label=VALUES(label),exclusion_reason=VALUES(exclusion_reason),occurrences=VALUES(occurrences),policy_version=VALUES(policy_version),article_count=VALUES(article_count),last_published_at=VALUES(last_published_at),winner_id=VALUES(winner_id),winner_count=VALUES(winner_count),inactive_reason=VALUES(inactive_reason)`,
    [records],
  );
  await c.query('INSERT INTO topic_term_aliases_v3(snapshot_id,term_id,canonical_id) VALUES ?', [aliases]);
  await c.execute('UPDATE topic_policy_selections SET `cursor`=? WHERE snapshot_id=?', [raw.at(-1)!.id, snapshotId]);
  return true;
}
async function beginSelection(c: Connection, snapshotId: string, ctx: Context) {
  const [[counts]] = await c.query<RowDataPacket[]>(
    `SELECT (SELECT COUNT(*) FROM topic_terms WHERE snapshot_id=?) raw_n,
    (SELECT COUNT(*) FROM topic_term_aliases_v3 WHERE snapshot_id=?) alias_n,(SELECT COUNT(*) FROM topic_canonical_terms_v3 WHERE snapshot_id=?) canonical_n`,
    [snapshotId, snapshotId, snapshotId],
  );
  if (Number(counts.raw_n) !== ctx.total || Number(counts.alias_n) !== ctx.total) throw Error('topic policy raw/alias count mismatch');
  const state = startActiveSelection(snapshotId, ctx.asOf);
  await c.execute(
    `UPDATE topic_policy_selections SET status='selecting',\`cursor\`=NULL,total_terms=?,selection_id=?,estimated_bytes=?,config=? WHERE snapshot_id=?`,
    [Number(counts.canonical_n), state.selectionId, state.estimatedBytes, JSON.stringify(baseConfig(ctx)), snapshotId],
  );
}
async function selectPage(c: Connection, snapshotId: string, ctx: Context, row: RowDataPacket) {
  const config = parse(row.config) as ReturnType<typeof baseConfig>;
  const state: ActiveState = {
    activeTerms: Number(row.active_terms),
    codePoints: Number(row.code_points),
    estimatedBytes: Number(row.estimated_bytes),
    eligibleTerms: Number(row.eligible_terms),
    budgetReached: Boolean(config.budgetReached),
    selectionId: row.selection_id,
  };
  let cursorCount = 0;
  if (row.cursor) {
    const [[last]] = await c.query<RowDataPacket[]>('SELECT article_count FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id=?', [
      snapshotId,
      row.cursor,
    ]);
    if (!last) throw Error('topic selection cursor missing');
    cursorCount = Number(last.article_count);
  }
  const [terms] = await c.query<RowDataPacket[]>(
    `SELECT id,label,normalized_label,article_count,last_published_at,exclusion_reason FROM topic_canonical_terms_v3 WHERE snapshot_id=? ${row.cursor ? 'AND (article_count<? OR (article_count=? AND id<?))' : ''} ORDER BY article_count DESC,id DESC LIMIT 500`,
    [snapshotId, ...(row.cursor ? [cursorCount, cursorCount, row.cursor] : [])],
  );
  if (!terms.length) {
    await c.execute("UPDATE topic_policy_selections SET status='ready',`cursor`=NULL WHERE snapshot_id=?", [snapshotId]);
    return false;
  }
  const reasons = new Map<string | null, string[]>();
  const excluded = config.exclusionReasons as Record<string, number>;
  const inactive = config.inactiveReasons as Record<string, number>;
  for (const term of terms) {
    const reason = admitActiveTerm(
      state,
      {
        id: term.id,
        label: term.label,
        normalizedLabel: term.normalized_label,
        articleCount: Number(term.article_count),
        lastPublishedAt: term.last_published_at ? new Date(term.last_published_at) : null,
        exclusionReason: term.exclusion_reason,
      },
      ctx.asOf,
    );
    const values = reasons.get(reason) ?? [];
    values.push(term.id);
    reasons.set(reason, values);
    if (term.exclusion_reason) excluded[term.exclusion_reason] = (excluded[term.exclusion_reason] ?? 0) + 1;
    if (reason) inactive[reason] = (inactive[reason] ?? 0) + 1;
  }
  for (const [reason, ids] of reasons)
    await c.query('UPDATE topic_canonical_terms_v3 SET inactive_reason=? WHERE snapshot_id=? AND id IN (?)', [reason, snapshotId, ids]);
  config.budgetReached = state.budgetReached;
  await c.execute(
    'UPDATE topic_policy_selections SET `cursor`=?,selection_id=?,eligible_terms=?,active_terms=?,code_points=?,estimated_bytes=?,config=? WHERE snapshot_id=?',
    [
      terms.at(-1)!.id,
      state.selectionId,
      state.eligibleTerms,
      state.activeTerms,
      state.codePoints,
      state.estimatedBytes,
      JSON.stringify(config),
      snapshotId,
    ],
  );
  return true;
}
async function state(c: Connection, snapshotId: string) {
  const [[row]] = await c.query<RowDataPacket[]>('SELECT * FROM topic_policy_selections WHERE snapshot_id=? FOR UPDATE', [snapshotId]);
  return row;
}
/** Small observed-window caller owns the transaction; raw terms are read with keyset pagination. */
export async function writeTopicPolicy(c: Connection, snapshotId: string, _legacyTerms?: SourceTerm[]) {
  const ctx = await context(c, snapshotId);
  if (ctx.coverage !== 'observed-article-window' || ctx.total > 50_000) throw Error('large/full vocabulary requires staged policy');
  await c.execute('DELETE FROM topic_term_aliases_v3 WHERE snapshot_id=?', [snapshotId]);
  await c.execute('DELETE FROM topic_canonical_terms_v3 WHERE snapshot_id=?', [snapshotId]);
  await initialize(c, snapshotId, ctx);
  await c.execute("UPDATE topic_policy_selections SET status='projecting' WHERE snapshot_id=?", [snapshotId]);
  while (await projectPage(c, snapshotId, ctx, (await state(c, snapshotId)).cursor)) {
    /* bounded raw reads in caller transaction */
  }
  await beginSelection(c, snapshotId, ctx);
  while (await selectPage(c, snapshotId, ctx, await state(c, snapshotId))) {
    /* bounded selection */
  }
  return state(c, snapshotId);
}
/** A published full snapshot must already have a ready policy; never rebuild a complete pool on the worker hot path. */
export async function ensureTopicPolicy(pool: Pool, snapshotId: string) {
  const [[ready]] = await pool.query<RowDataPacket[]>(
    "SELECT snapshot_id FROM topic_policy_selections WHERE snapshot_id=? AND policy_version=? AND status='ready'",
    [snapshotId, POLICY_VERSION],
  );
  if (ready) return;
  const [[snapshot]] = await pool.query<RowDataPacket[]>('SELECT manifest FROM topic_snapshots WHERE id=?', [snapshotId]);
  if (snapshot && parse(snapshot.manifest).coverage === 'all-current-indexed-article-tags')
    throw Error('full_vocabulary_policy_requires_staged_preparation');
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await writeTopicPolicy(c, snapshotId);
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
/** Every page and cursor commit together; only unpublished snapshots may be incrementally rewritten. */
export async function prepareStagedTopicPolicy(
  pool: Pool,
  snapshotId: string,
  assertLease: () => Promise<void>,
  options: { maxBatches?: number } = {},
) {
  const maxBatches = Math.max(1, Math.min(1000, options.maxBatches ?? 40));
  for (let batch = 0; batch < maxBatches; batch++) {
    await assertLease();
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [[current]] = await c.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE snapshot_id=? FOR UPDATE', [
        snapshotId,
      ]);
      if (current) throw Error('staged policy cannot rewrite current vocabulary');
      const ctx = await context(c, snapshotId);
      let row = await state(c, snapshotId);
      if (!row || row.policy_version !== POLICY_VERSION) {
        await initialize(c, snapshotId, ctx);
        row = await state(c, snapshotId);
      }
      if (row.status === 'ready') {
        await c.commit();
        return { status: 'ready' as const, snapshotId, selectionId: String(row.selection_id) };
      }
      if (row.status === 'building') {
        const [aliases] = await c.execute<ResultSetHeader>('DELETE FROM topic_term_aliases_v3 WHERE snapshot_id=? LIMIT 500', [snapshotId]);
        const [terms] = await c.execute<ResultSetHeader>('DELETE FROM topic_canonical_terms_v3 WHERE snapshot_id=? LIMIT 500', [
          snapshotId,
        ]);
        if (!aliases.affectedRows && !terms.affectedRows)
          await c.execute("UPDATE topic_policy_selections SET status='projecting' WHERE snapshot_id=?", [snapshotId]);
      } else if (row.status === 'projecting') {
        if (!(await projectPage(c, snapshotId, ctx, row.cursor))) await beginSelection(c, snapshotId, ctx);
      } else if (row.status === 'selecting') {
        await selectPage(c, snapshotId, ctx, row);
      } else throw Error('unknown topic policy phase');
      await assertLease();
      await c.commit();
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
  const [[row]] = await pool.query<RowDataPacket[]>('SELECT status,selection_id FROM topic_policy_selections WHERE snapshot_id=?', [
    snapshotId,
  ]);
  return { status: String(row.status), snapshotId, selectionId: row.status === 'ready' ? String(row.selection_id) : null };
}
