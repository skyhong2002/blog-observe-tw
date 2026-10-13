import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { inPublication } from '../content/article-content.ts';
import { CONTENT_VERSION } from '../content/contracts.ts';
import { articleIdentityKey } from '../crawl/feed.ts';
import { TopicMatcher } from './matcher.ts';
import { CLEANUP_VERSION, cleanTopicBody } from './matching-body.ts';
import { ACTIVE_TOPIC_LIMITS, MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { TOPIC_FINGERPRINT_VERSION, topicFingerprintSql } from './provenance-fingerprint-sql.ts';
import { SOURCE } from './snapshot-client.ts';
import { knownProofAdapter, proofPinsMatch, STAGED_PROOF_VERSION, sameProofOrigin, validateIndexProof } from './staged-scan-proof.ts';
import { advanceScanV2, parseScanV2, type ScanV2Pins, type ScanV2State, startScanV2 } from './staged-scan-v2-contract.ts';

const sha = (x: string) => createHash('sha256').update(x).digest('hex');
const sql = (q: string) => `SET STATEMENT max_statement_time=0.25 FOR ${q}`;
const admissions = new WeakSet<Pool>();
export type ScanControls = {
  enabled?: boolean;
  signal?: AbortSignal;
  maxDurationMs?: number;
  now?: () => Date;
  proofMode?: typeof STAGED_PROOF_VERSION;
};
class Stop extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
/** One admission retained until uncancellable acquisition settles. All work uses this connection. */
async function controlled<T>(pool: Pool, controls: ScanControls, work: (c: PoolConnection, guard: () => Promise<void>) => Promise<T>) {
  if (controls.enabled !== true) return { status: 'disabled' as const, canVerify: false };
  if (controls.proofMode !== undefined && controls.proofMode !== STAGED_PROOF_VERSION)
    return { status: 'blocked' as const, reason: 'proof-mode', canVerify: false };
  const duration = controls.maxDurationMs ?? 120_000;
  if (!Number.isSafeInteger(duration) || duration < 1 || duration > 600_000)
    return { status: 'blocked' as const, reason: 'invalid-bounds', canVerify: false };
  const size = (pool as unknown as { pool?: { config?: { connectionLimit?: number } } }).pool?.config?.connectionLimit;
  if (!Number.isSafeInteger(size) || Number(size) < 2) return { status: 'blocked' as const, reason: 'pool-size', canVerify: false };
  if (controls.signal?.aborted) return { status: 'deferred' as const, reason: 'deadline', canVerify: false };
  if (admissions.has(pool)) return { status: 'busy' as const, canVerify: false };
  admissions.add(pool);
  let c: PoolConnection | undefined,
    destroyed = false,
    held = false,
    settled = false,
    expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.resolve().then(() => pool.getConnection());
  pending.catch(() => {});
  const deadline = Date.now() + duration;
  let rejectAbort: ((error: Stop) => void) | undefined;
  const abort = () => {
    rejectAbort?.(new Stop('deadline'));
    expired = true;
    if (c && !destroyed) {
      destroyed = true;
      c.destroy();
    }
  };
  controls.signal?.addEventListener('abort', abort, { once: true });
  try {
    c = await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        rejectAbort = reject;
        if (controls.signal?.aborted) abort();
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort();
          reject(new Stop('deadline'));
        }, duration);
      }),
    ]);
    settled = true;
    if (controls.signal?.aborted) abort();
    const guard = async () => {
      if (expired || controls.signal?.aborted || Date.now() >= deadline) throw new Stop('deadline');
      const [[r]] = await c!.query<RowDataPacket[]>(sql('SELECT IS_USED_LOCK(?)=CONNECTION_ID() held'), ['blog_observe:topics']);
      if (Number(r?.held) !== 1) throw new Stop('lease');
    };
    const [[lock]] = await c.query<RowDataPacket[]>(sql('SELECT GET_LOCK(?,0) held'), ['blog_observe:topics']);
    if (Number(lock?.held) !== 1) return { status: 'busy' as const, canVerify: false };
    held = true;
    await c.query('SET SESSION innodb_lock_wait_timeout=1');
    await guard();
    return await work(c, guard);
  } catch (e) {
    return {
      status:
        e instanceof Stop &&
        [
          'target-not-ready',
          'target-public',
          'active-scan',
          'invalid-input',
          'scan-owner',
          'missing-run',
          'policy-count',
          'proof-mode-required',
          'missing-proof-marker',
          'proof-pin-mismatch',
          'proof-target-nonempty',
        ].includes(e.reason)
          ? ('blocked' as const)
          : e instanceof Stop && e.reason === 'cursor-conflict'
            ? ('conflict' as const)
            : ('deferred' as const),
      reason: e instanceof Stop ? e.reason : 'local-db-unavailable',
      canVerify: false,
    };
  } finally {
    controls.signal?.removeEventListener('abort', abort);
    if (!settled) {
      void pending
        .then(
          (late) => {
            try {
              late.release();
            } catch {
              try {
                late.destroy();
              } catch {
                /* only this late owned connection */
              }
            }
          },
          () => {},
        )
        .finally(() => admissions.delete(pool))
        .catch(() => {});
    } else {
      if (c && !destroyed) {
        try {
          await c.rollback();
          if (held) await c.query('SELECT RELEASE_LOCK(?)', ['blog_observe:topics']);
          await c.query('SET SESSION innodb_lock_wait_timeout=DEFAULT');
          c.release();
        } catch {
          c.destroy();
        }
      }
      admissions.delete(pool);
    }
    if (timer) clearTimeout(timer);
  }
}
async function target(c: PoolConnection, s: ScanV2Pins, lock = false) {
  const [[r]] = await c.query<RowDataPacket[]>(
    sql(
      `SELECT CAST(t.manifest AS CHAR CHARACTER SET utf8mb4) manifest,t.status, r.status import_status,r.payload_mode,p.status policy_status,p.selection_id,p.policy_version,p.active_terms FROM topic_snapshots t JOIN topic_snapshot_runs r ON r.snapshot_id=t.id JOIN topic_policy_selections p ON p.snapshot_id=t.id WHERE t.id=? ${lock ? 'FOR UPDATE' : ''}`,
    ),
    [s.target],
  );
  if (
    r?.status !== 'ready' ||
    r.import_status !== 'ready' ||
    r.payload_mode !== 'single-copy-v1' ||
    r.policy_status !== 'ready' ||
    r.selection_id !== s.selectionId ||
    r.policy_version !== s.policyVersion ||
    s.policyVersion !== POLICY_VERSION ||
    s.matcherVersion !== MATCHER_VERSION ||
    s.cleanupVersion !== CLEANUP_VERSION ||
    typeof r.manifest !== 'string' ||
    sha(r.manifest) !== s.manifestSha256 ||
    JSON.parse(r.manifest).coverage !== 'all-current-indexed-article-tags'
  )
    throw new Stop('target-not-ready');
  const [[current]] = await c.query<RowDataPacket[]>(
    sql(`SELECT source FROM topic_current WHERE snapshot_id=? LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`),
    [s.target],
  );
  if (current) throw new Stop('target-public');
  return r;
}
const report = (id: string, state: ScanV2State) => ({
  status: state.state,
  runId: id,
  target: state.target,
  cursor: state.cursor,
  highWater: state.highWater,
  checked: state.checked,
  eligible: state.eligible,
  titleOnly: state.titleOnly,
  zeroHit: state.zeroHit,
  skipped: state.skipped,
  capped: state.capped,
  unresolved: state.unresolved,
  coverageScope: 'fresh-as-of-id-boundary',
  canVerify: false,
  ...(state.titleOnly ? { titleOnlyReason: 'body-missing-or-source-unproven' } : {}),
});
export async function startStagedScan(pool: Pool, pins: ScanV2Pins, controls: ScanControls = {}) {
  return controlled(pool, controls, async (c, guard) => {
    // Validate all pins before SQL can interpolate or store them; highWater is replaced with actual indexed boundary.
    startScanV2(pins, 0, (controls.now?.() ?? new Date()).toISOString());
    await c.beginTransaction();
    await c.execute('INSERT IGNORE INTO topic_staged_scan_owner(source,run_id) VALUES (?,NULL)', [SOURCE]);
    const [[owner]] = await c.query<RowDataPacket[]>(sql('SELECT run_id FROM topic_staged_scan_owner WHERE source=? FOR UPDATE'), [SOURCE]);
    if (owner?.run_id) throw new Stop('active-scan');
    await marker(c, pins, controls.proofMode, true);
    await target(c, pins, true);
    const [[last]] = await c.query<RowDataPacket[]>(sql('SELECT id FROM posts ORDER BY id DESC LIMIT 1'));
    const state = startScanV2(pins, Number(last?.id ?? 0), (controls.now?.() ?? new Date()).toISOString()),
      id = randomUUID();
    await c.execute(
      'INSERT INTO topic_staged_scan_runs(run_id,target_snapshot_id,status,state_json,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      [id, state.target, state.state, JSON.stringify(state), controls.now?.() ?? new Date(), controls.now?.() ?? new Date()],
    );
    await c.execute('UPDATE topic_staged_scan_owner SET run_id=? WHERE source=?', [state.state === 'scanning' ? id : null, SOURCE]);
    await guard();
    await c.commit();
    return report(id, state);
  });
}
const bodyFields = `b.post_id,b.blog_id body_blog_id,b.status body_status,b.completeness,b.truncated,b.image_only,b.revision,b.content_hash body_hash,b.source_url,b.source_kind,b.adapter_id,b.adapter_version,b.rule_revision,b.article_url,b.obtained_at, OCTET_LENGTH(b.body_text) text_bytes,OCTET_LENGTH(b.body_html) html_bytes,
 CASE WHEN COALESCE(OCTET_LENGTH(b.body_text),0)<=500000 AND COALESCE(OCTET_LENGTH(b.body_html),0)<=2000000 THEN b.body_text END body_text,
 CASE WHEN COALESCE(OCTET_LENGTH(b.body_text),0)<=500000 AND COALESCE(OCTET_LENGTH(b.body_html),0)<=2000000 THEN b.body_html END body_html`;
async function readPost(c: PoolConnection, id: number, lock = false): Promise<RowDataPacket | null> {
  // Fresh lock ordering is blog -> post -> body. Other writer orders may deadlock; defer without cursor change.
  const [[key]] = await c.query<RowDataPacket[]>(sql('SELECT blog_id FROM posts WHERE id=?'), [id]);
  if (!key) return null;
  const [[blog]] = await c.query<RowDataPacket[]>(sql(`SELECT id,url,status FROM blogs WHERE id=? ${lock ? 'FOR UPDATE' : ''}`), [
    key.blog_id,
  ]);
  const [[p]] = await c.query<RowDataPacket[]>(
    sql(
      `SELECT id,blog_id,url,CASE WHEN OCTET_LENGTH(title)<=240000 THEN title END title,OCTET_LENGTH(title) title_bytes,SHA2(summary,256) summary_hash,content_hash,published_at FROM posts WHERE id=? ${lock ? 'FOR UPDATE' : ''}`,
    ),
    [id],
  );
  if (!p) return null;
  const [[length]] = await c.query<RowDataPacket[]>(
    sql('SELECT OCTET_LENGTH(body_text) text_bytes,OCTET_LENGTH(body_html) html_bytes FROM content_post_bodies WHERE post_id=?'),
    [id],
  );
  const [[body]] = await c.query<RowDataPacket[]>(
    sql(`SELECT ${bodyFields} FROM content_post_bodies b WHERE b.post_id=? ${lock ? 'FOR UPDATE' : ''}`),
    [id],
  );
  return { ...p, blog_status: blog?.status, blog_url: blog?.url, blog_owner: blog?.id === p.blog_id, body: body ?? null, length };
}
function eligible(p: RowDataPacket | null, s: ScanV2State, now: Date) {
  return (
    !!p &&
    p.blog_status === 'verified' &&
    p.blog_owner &&
    typeof p.blog_url === 'string' &&
    inPublication(p.url, p.blog_url) &&
    (p.published_at === null || new Date(p.published_at).getTime() <= Math.min(Date.parse(s.asOf), now.getTime()))
  );
}
function trustedBodySource(b: RowDataPacket, home: unknown): boolean {
  if (
    typeof home !== 'string' ||
    typeof b.source_url !== 'string' ||
    !inPublication(b.source_url, home) ||
    b.adapter_version !== CONTENT_VERSION
  )
    return false;
  if (b.source_kind === 'article-html') return articleIdentityKey(b.source_url) === articleIdentityKey(b.article_url);
  if (b.source_kind === 'rss-content' || b.source_kind === 'atom-content')
    return typeof b.adapter_id === 'string' && /^[a-z0-9-]+-public$/.test(b.adapter_id);
  if (b.source_kind === 'wordpress-api') {
    if (b.adapter_id !== 'wordpress-public') return false;
    try {
      const u = new URL(b.source_url);
      return /\/wp-json\/wp\/v2\/posts\/?$/.test(u.pathname) && u.origin === new URL(home).origin;
    } catch {
      return false;
    }
  }
  return false;
}
function bodyKind(p: RowDataPacket | null, now: Date, strict = false): 'missing' | 'full' | 'capped' {
  const b = p?.body;
  if (
    b?.body_status !== 'ok' ||
    b.body_blog_id !== p?.blog_id ||
    !articleIdentityKey(b.article_url) ||
    articleIdentityKey(b.article_url) !== articleIdentityKey(p?.url) ||
    !trustedBodySource(b, p?.blog_url) ||
    !Number.isFinite(new Date(b.obtained_at).getTime()) ||
    new Date(b.obtained_at).getTime() > now.getTime()
  )
    return 'missing';
  if (
    strict &&
    (!knownProofAdapter(b) ||
      !b.post_id ||
      !sameProofOrigin(b.article_url, p?.url) ||
      !sameProofOrigin(p?.url, p?.blog_url) ||
      !sameProofOrigin(b.source_url, p?.blog_url) ||
      (b.source_updated_at !== null &&
        (!Number.isFinite(new Date(b.source_updated_at).getTime()) || new Date(b.source_updated_at).getTime() > now.getTime())))
  )
    return 'missing';
  if (
    Buffer.byteLength(b.body_text ?? '') > 500000 ||
    Buffer.byteLength(b.body_html ?? '') > 2000000 ||
    b.text_bytes > 500000 ||
    b.html_bytes > 2000000 ||
    b.truncated ||
    b.completeness !== 'full' ||
    b.image_only ||
    typeof b.body_hash !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(b.body_hash)
  )
    return 'capped';
  return 'full';
}
export async function runStagedScanBatch(
  pool: Pool,
  input: { runId: string; expectedCursor: number; limit?: number },
  controls: ScanControls = {},
) {
  return controlled(pool, controls, async (c, guard) => {
    if (
      !/^[a-f0-9-]{36}$/i.test(input.runId) ||
      !Number.isSafeInteger(input.expectedCursor) ||
      input.expectedCursor < 0 ||
      !Number.isSafeInteger(input.limit ?? 50) ||
      (input.limit ?? 50) < 1 ||
      (input.limit ?? 50) > 50
    )
      throw new Stop('invalid-input');
    const [[run]] = await c.query<RowDataPacket[]>(sql('SELECT state_json FROM topic_staged_scan_runs WHERE run_id=?'), [input.runId]);
    if (!run) throw new Stop('missing-run');
    let state = parseScanV2(typeof run.state_json === 'string' ? JSON.parse(run.state_json) : run.state_json);
    if (state.cursor !== input.expectedCursor) throw new Stop('cursor-conflict');
    await marker(c, state, controls.proofMode);
    await target(c, state);
    if (state.state === 'scanned-as-of') {
      await c.beginTransaction();
      await marker(c, state, controls.proofMode, true);
      await target(c, state, true);
      await c.execute('UPDATE topic_staged_scan_owner SET run_id=NULL WHERE source=? AND run_id=?', [SOURCE, input.runId]);
      await guard();
      await c.commit();
      return report(input.runId, state);
    }
    const [[owner]] = await c.query<RowDataPacket[]>(sql('SELECT run_id FROM topic_staged_scan_owner WHERE source=?'), [SOURCE]);
    if (owner?.run_id !== input.runId) throw new Stop('scan-owner');
    const [terms] = await c.query<RowDataPacket[]>(
      sql(
        'SELECT id,label FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND policy_version=? AND exclusion_reason IS NULL AND inactive_reason IS NULL ORDER BY id LIMIT ?',
      ),
      [state.target, state.policyVersion, ACTIVE_TOPIC_LIMITS.maxTerms + 1],
    );
    const policy = await target(c, state);
    if (terms.length !== Number(policy.active_terms)) throw new Stop('policy-count');
    const matcher = new TopicMatcher(terms.map((t) => ({ id: t.id, label: t.label })));
    const [ids] = await c.query<RowDataPacket[]>(sql('SELECT id FROM posts WHERE id>? AND id<=? ORDER BY id LIMIT ?'), [
      state.cursor,
      state.highWater,
      input.limit ?? 50,
    ]);
    for (const item of ids) {
      await guard();
      const before = controls.proofMode ? await readProofPost(c, item.id) : await readPost(c, item.id),
        now = controls.now?.() ?? new Date();
      const kind = bodyKind(before, now, controls.proofMode !== undefined),
        clean = kind === 'full' ? cleanTopicBody({ text: before!.body.body_text, html: before!.body.body_html }) : null;
      const title = matcher.match(before?.title ?? ''),
        body = clean ? matcher.match(clean.text) : { ids: [], truncated: false };
      const capped = kind === 'capped' || Number(before?.title_bytes ?? 0) > 240000 || title.truncated || body.truncated;
      await c.beginTransaction();
      const [[locked]] = await c.query<RowDataPacket[]>(sql('SELECT state_json FROM topic_staged_scan_runs WHERE run_id=? FOR UPDATE'), [
        input.runId,
      ]);
      const freshState = parseScanV2(typeof locked.state_json === 'string' ? JSON.parse(locked.state_json) : locked.state_json);
      if (JSON.stringify(freshState) !== JSON.stringify(state)) throw new Stop('cursor-conflict');
      await marker(c, state, controls.proofMode, true);
      await target(c, state, true);
      const fresh = controls.proofMode ? await readProofPost(c, item.id, true, before?.blog_id) : await readPost(c, item.id, true);
      const freshPublic = eligible(fresh, state, controls.now?.() ?? new Date()),
        same =
          JSON.stringify(before) === JSON.stringify(fresh) &&
          (!controls.proofMode ||
            (typeof before?.metadata_fingerprint === 'string' &&
              before.metadata_fingerprint === fresh?.metadata_fingerprint &&
              (kind !== 'full' || before?.body_fingerprint === fresh?.body_fingerprint)));
      const next = advanceScanV2(
        state,
        state.cursor,
        {
          postId: Number(item.id),
          publicBefore: eligible(before, state, now),
          publicFresh: freshPublic,
          ownerFresh: !!fresh?.blog_owner,
          dateFresh: freshPublic,
          revisionFresh: same,
          result: capped ? 'capped' : title.ids.length + body.ids.length ? 'hits' : 'zero',
        },
        false,
        kind === 'missing',
      );
      if (controls.proofMode) await c.execute('DELETE FROM topic_index_proofs WHERE snapshot_id=? AND post_id=?', [state.target, item.id]);
      await c.execute('DELETE FROM topic_matches_v3 WHERE snapshot_id=? AND post_id=?', [state.target, item.id]);
      await c.execute('DELETE FROM topic_post_indexes_v3 WHERE snapshot_id=? AND post_id=?', [state.target, item.id]);
      if (freshPublic && same && !capped) {
        const hits = [
          ...title.ids.map((id) => [state.target, item.id, id, 'title']),
          ...body.ids.map((id) => [state.target, item.id, id, 'body']),
        ];
        if (hits.length) await c.query('INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) VALUES ?', [hits]);
        await c.execute(
          'INSERT INTO topic_post_indexes_v3(snapshot_id,post_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind,body_obtained_at,needs_refresh) VALUES (?,?,?,?,?,?,?,?,?,?,?,0)',
          [
            state.target,
            item.id,
            sha((before?.title ?? '') + '\n' + (clean?.text ?? '')),
            before?.content_hash ?? null,
            kind === 'full' ? before?.body.body_hash : null,
            now,
            'ok',
            state.matcherVersion,
            state.cleanupVersion,
            kind === 'full' ? 'full' : 'title-only',
            kind === 'full' ? before?.body.obtained_at : null,
          ],
        );
      }
      if (controls.proofMode && freshPublic && same && !capped) {
        const stamp = now.toISOString();
        const proof = validateIndexProof({
          snapshotId: state.target,
          postId: Number(item.id),
          scanRunId: input.runId,
          proofVersion: STAGED_PROOF_VERSION,
          fingerprintVersion: TOPIC_FINGERPRINT_VERSION,
          policyVersion: state.policyVersion,
          selectionId: state.selectionId,
          matcherVersion: state.matcherVersion,
          cleanupVersion: state.cleanupVersion,
          kind: kind === 'full' ? 'full' : 'title-only',
          metadataFingerprint: before!.metadata_fingerprint,
          bodyFingerprint: kind === 'full' ? before!.body_fingerprint : null,
          bodyContentHash: kind === 'full' ? before!.body.body_hash : null,
          bodyRevision: kind === 'full' ? Number(before!.body.revision) : null,
          sourceKind: kind === 'full' ? before!.body.source_kind : null,
          bodyObtainedAt: kind === 'full' ? new Date(before!.body.obtained_at).toISOString() : null,
          observedAt: stamp,
          checkedAt: stamp,
          inputHash: sha((before?.title ?? '') + '\n' + (clean?.text ?? '')),
        });
        await c.execute(
          'INSERT INTO topic_index_proofs(snapshot_id,post_id,scan_run_id,proof_version,fingerprint_version,policy_version,selection_id,matcher_version,cleanup_version,kind,metadata_fingerprint,body_fingerprint,body_content_hash,body_revision,source_kind,body_obtained_at,observed_at,checked_at,input_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [
            proof.snapshotId,
            proof.postId,
            proof.scanRunId,
            proof.proofVersion,
            proof.fingerprintVersion,
            proof.policyVersion,
            proof.selectionId,
            proof.matcherVersion,
            proof.cleanupVersion,
            proof.kind,
            proof.metadataFingerprint,
            proof.bodyFingerprint,
            proof.bodyContentHash,
            proof.bodyRevision,
            proof.sourceKind,
            proof.bodyObtainedAt ? new Date(proof.bodyObtainedAt) : null,
            now,
            now,
            proof.inputHash,
          ],
        );
      }
      await c.execute('UPDATE topic_staged_scan_runs SET state_json=?,updated_at=? WHERE run_id=?', [
        JSON.stringify(next),
        now,
        input.runId,
      ]);
      await guard();
      await c.commit();
      state = next;
    }
    if (ids.length < (input.limit ?? 50) || state.cursor === state.highWater) {
      await c.beginTransaction();
      const [[last]] = await c.query<RowDataPacket[]>(sql('SELECT state_json FROM topic_staged_scan_runs WHERE run_id=? FOR UPDATE'), [
        input.runId,
      ]);
      if (
        JSON.stringify(parseScanV2(typeof last.state_json === 'string' ? JSON.parse(last.state_json) : last.state_json)) !==
        JSON.stringify(state)
      )
        throw new Stop('cursor-conflict');
      await marker(c, state, controls.proofMode, true);
      await target(c, state, true);
      state = advanceScanV2(state, state.cursor, undefined, true);
      await c.execute('UPDATE topic_staged_scan_runs SET state_json=?,status=?,updated_at=? WHERE run_id=?', [
        JSON.stringify(state),
        state.state,
        controls.now?.() ?? new Date(),
        input.runId,
      ]);
      await c.execute('UPDATE topic_staged_scan_owner SET run_id=NULL WHERE source=? AND run_id=?', [SOURCE, input.runId]);
      await guard();
      await c.commit();
    }
    return report(input.runId, state);
  });
}

async function marker(c: PoolConnection, pins: ScanV2Pins, mode: ScanControls['proofMode'], lock = false) {
  const [[row]] = await c.query<RowDataPacket[]>(
    sql(`SELECT * FROM topic_generation_proof_contracts WHERE snapshot_id=? ${lock ? 'FOR UPDATE' : ''}`),
    [pins.target],
  );
  if (!mode) {
    if (row) throw new Stop('proof-mode-required');
    return;
  }
  if (!row) throw new Stop('missing-proof-marker');
  if (!proofPinsMatch(row, pins)) throw new Stop('proof-pin-mismatch');
}
/** Explicit staging enrollment only. No review/auth claims, filesystem hashes or publication. */
export async function enrollStagedScanProof(pool: Pool, pins: ScanV2Pins, controls: ScanControls = {}) {
  if (controls.enabled !== true) return { status: 'disabled', canVerify: false };
  if (controls.proofMode !== STAGED_PROOF_VERSION) return { status: 'blocked', reason: 'proof-mode-required', canVerify: false };
  return controlled(pool, controls, async (c, guard) => {
    startScanV2(pins, 0, (controls.now?.() ?? new Date()).toISOString());
    if (!/^[a-f0-9]{64}$/.test(pins.selectionId)) throw new Stop('proof-pin-mismatch');
    const [[active]] = await c.query<RowDataPacket[]>(sql('SELECT run_id FROM topic_staged_scan_owner WHERE source=?'), [SOURCE]);
    if (active?.run_id) throw new Stop('active-scan');
    await c.beginTransaction();
    // No run exists for enrollment. Same exclusive topics lease serializes marker -> target locks.
    const [[existing]] = await c.query<RowDataPacket[]>(
      sql('SELECT * FROM topic_generation_proof_contracts WHERE snapshot_id=? FOR UPDATE'),
      [pins.target],
    );
    if (existing && !proofPinsMatch(existing, pins)) throw new Stop('proof-pin-mismatch');
    await target(c, pins, true);
    for (const table of ['topic_post_indexes_v3', 'topic_matches_v3']) {
      const [[row]] = await c.query<RowDataPacket[]>(sql(`SELECT post_id FROM ${table} WHERE snapshot_id=? LIMIT 1`), [pins.target]);
      if (row) throw new Stop('proof-target-nonempty');
    }
    const now = controls.now?.() ?? new Date();
    if (!existing)
      await c.execute(
        'INSERT INTO topic_generation_proof_contracts(snapshot_id,proof_version,fingerprint_version,manifest_sha256,policy_version,selection_id,matcher_version,cleanup_version,scan_contract_version,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          pins.target,
          STAGED_PROOF_VERSION,
          TOPIC_FINGERPRINT_VERSION,
          pins.manifestSha256,
          pins.policyVersion,
          pins.selectionId,
          pins.matcherVersion,
          pins.cleanupVersion,
          'scan-v2',
          'staging',
          now,
          now,
        ],
      );
    await guard();
    await c.commit();
    return { status: 'enrolled', target: pins.target, canVerify: false };
  });
}
const fp = topicFingerprintSql();
const proofReadSql = `SELECT p.id,p.blog_id,p.url,CASE WHEN OCTET_LENGTH(p.title)<=240000 THEN p.title END title,OCTET_LENGTH(p.title) title_bytes,SHA2(p.summary,256) summary_hash,p.content_hash,p.published_at,b.url blog_url,b.status blog_status,b.id blog_owner_id,
 cb.post_id,cb.blog_id body_blog_id,cb.status body_status,cb.completeness,cb.truncated,cb.image_only,cb.revision,cb.content_hash body_hash,cb.source_kind,cb.source_url,cb.article_url,cb.adapter_id,cb.adapter_version,cb.rule_revision,cb.obtained_at,cb.source_updated_at,OCTET_LENGTH(cb.body_text) text_bytes,OCTET_LENGTH(cb.body_html) html_bytes,
 CASE WHEN COALESCE(OCTET_LENGTH(cb.body_text),0)<=500000 AND COALESCE(OCTET_LENGTH(cb.body_html),0)<=2000000 THEN cb.body_text END body_text,
 CASE WHEN COALESCE(OCTET_LENGTH(cb.body_text),0)<=500000 AND COALESCE(OCTET_LENGTH(cb.body_html),0)<=2000000 THEN cb.body_html END body_html,
 ${fp.metadataSql} metadata_fingerprint,${fp.bodySql} body_fingerprint
 FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN content_post_bodies cb ON cb.post_id=p.id AND cb.blog_id=p.blog_id WHERE p.id=?`;
async function readProofPost(c: PoolConnection, id: number, locking = false, expectedBlog?: number): Promise<RowDataPacket | null> {
  if (locking) {
    if (!Number.isSafeInteger(expectedBlog)) return null;
    await c.query(sql('SELECT id FROM blogs WHERE id=? FOR UPDATE'), [expectedBlog]);
    const [[post]] = await c.query<RowDataPacket[]>(sql('SELECT blog_id FROM posts WHERE id=? FOR UPDATE'), [id]);
    if (!post || post.blog_id !== expectedBlog) return null;
    await c.query(sql('SELECT post_id FROM content_post_bodies WHERE post_id=? FOR UPDATE'), [id]);
  }
  // The same bounded statement supplies matcher inputs and both fingerprints. Fresh read is locking/current.
  const [[r]] = await c.query<RowDataPacket[]>(sql(proofReadSql + (locking ? ' FOR UPDATE' : '')), [id]);
  if (!r) return null;
  const body =
    r.post_id === null
      ? null
      : {
          post_id: r.post_id,
          body_blog_id: r.body_blog_id,
          body_status: r.body_status,
          completeness: r.completeness,
          truncated: r.truncated,
          image_only: r.image_only,
          revision: r.revision,
          body_hash: r.body_hash,
          source_kind: r.source_kind,
          source_url: r.source_url,
          article_url: r.article_url,
          adapter_id: r.adapter_id,
          adapter_version: r.adapter_version,
          rule_revision: r.rule_revision,
          obtained_at: r.obtained_at,
          source_updated_at: r.source_updated_at,
          text_bytes: r.text_bytes,
          html_bytes: r.html_bytes,
          body_text: r.body_text,
          body_html: r.body_html,
        };
  return { ...r, blog_owner: r.blog_owner_id === r.blog_id, body };
}
