import { types } from 'node:util';
import type { Pool, PoolConnection } from 'mysql2/promise';
import { CONTENT_VERSION } from '../content/contracts.ts';
import { ADAPTER_SELECTORS } from '../content/registry.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { TOPIC_FINGERPRINT_VERSION, topicFingerprintSql } from './provenance-fingerprint-sql.ts';
import { STAGED_PROOF_VERSION } from './staged-scan-proof.ts';
export type InspectorPins = {
  manifestSha256: string;
  policyVersion: string;
  selectionId: string;
  matcherVersion: string;
  cleanupVersion: string;
  proofVersion: typeof STAGED_PROOF_VERSION;
  fingerprintVersion: typeof TOPIC_FINGERPRINT_VERSION;
};
export type InspectorInput = { enabled?: boolean; target: string; postIds: number[]; pins: InspectorPins };
export type InspectorControls = { signal?: AbortSignal; maxDurationMs?: number };
export type InspectorItem = {
  postId: number;
  titleFresh: boolean;
  bodyFresh: boolean;
  reason: 'unavailable' | 'fresh' | 'title-only-or-body-stale';
};
export type InspectorResult = {
  status: 'disabled' | 'blocked' | 'busy' | 'deferred' | 'ok';
  reason?: 'opaque-invalid' | 'deadline' | 'local-db-unavailable';
  items: InspectorItem[];
};
const admissions = new WeakSet<Pool>(),
  hex = /^[a-f0-9]{64}$/,
  uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const blocked = (): InspectorResult => ({ status: 'blocked', reason: 'opaque-invalid', items: [] });
function data(raw: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
    throw Error('opaque-invalid');
  const ds = Object.getOwnPropertyDescriptors(raw),
    own = Reflect.ownKeys(raw);
  if (
    own.some((k) => typeof k !== 'string' || !keys.includes(k) || !('value' in ds[k])) ||
    keys.some((k) => !optional.includes(k) && !ds[k])
  )
    throw Error('opaque-invalid');
  return Object.fromEntries(own.map((k) => [k, ds[k as string].value]));
}
function checked(raw: unknown): InspectorInput | undefined {
  const r = data(raw, ['enabled', 'target', 'postIds', 'pins'], ['enabled', 'target', 'postIds', 'pins']);
  if (r.enabled !== true) return undefined;
  if (typeof r.target !== 'string' || !uuid.test(r.target) || !Array.isArray(r.postIds) || types.isProxy(r.postIds))
    throw Error('opaque-invalid');
  const ds = Object.getOwnPropertyDescriptors(r.postIds) as Record<string, PropertyDescriptor>,
    length = ds.length?.value;
  if (!Number.isSafeInteger(length) || length < 1 || length > 50 || Reflect.ownKeys(r.postIds).length !== length + 1)
    throw Error('opaque-invalid');
  const ids: number[] = [];
  for (let i = 0; i < length; i++) {
    const d = ds[String(i)];
    if (!d || !('value' in d) || !Number.isSafeInteger(d.value) || d.value < 1 || d.value > 2147483647 || ids.includes(d.value))
      throw Error('opaque-invalid');
    ids.push(d.value);
  }
  const p = data(r.pins, [
    'manifestSha256',
    'policyVersion',
    'selectionId',
    'matcherVersion',
    'cleanupVersion',
    'proofVersion',
    'fingerprintVersion',
  ]);
  if (
    typeof p.manifestSha256 !== 'string' ||
    !hex.test(p.manifestSha256) ||
    typeof p.selectionId !== 'string' ||
    !hex.test(p.selectionId) ||
    p.policyVersion !== POLICY_VERSION ||
    p.matcherVersion !== MATCHER_VERSION ||
    p.cleanupVersion !== CLEANUP_VERSION ||
    p.proofVersion !== STAGED_PROOF_VERSION ||
    p.fingerprintVersion !== TOPIC_FINGERPRINT_VERSION
  )
    throw Error('opaque-invalid');
  return { enabled: true, target: r.target, postIds: ids, pins: p as InspectorPins };
}
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeAdd = EventTarget.prototype.addEventListener;
const nativeRemove = EventTarget.prototype.removeEventListener;
const aborted = (signal: AbortSignal | undefined): boolean => (signal === undefined ? false : nativeAborted.call(signal));
const fp = topicFingerprintSql();
/** SQL builder exposed for offline shape/EXPLAIN fixtures, never returned in inspector DTO. */
export function stagedProofInspectorQueryForTests(raw: InspectorInput): { sql: string; values: unknown[] } {
  const input = checked(raw);
  if (!input) throw Error('opaque-invalid');
  const p = input.pins;
  const generation = `SELECT t.id snapshot_id,m.proof_version,m.fingerprint_version,m.policy_version,m.selection_id,m.matcher_version,m.cleanup_version
 FROM topic_snapshots t JOIN topic_snapshot_runs sr ON sr.snapshot_id=t.id JOIN topic_generation_proof_contracts m ON m.snapshot_id=t.id JOIN topic_policy_selections ps ON ps.snapshot_id=t.id
 WHERE t.id=? AND BINARY t.status='ready' AND BINARY sr.status='ready' AND BINARY sr.payload_mode='single-copy-v1' AND BINARY m.status='staging' AND BINARY m.scan_contract_version='scan-v2' AND BINARY ps.status='ready'
 AND BINARY m.proof_version=BINARY ? AND BINARY m.fingerprint_version=BINARY ? AND BINARY m.policy_version=BINARY ? AND BINARY m.selection_id=BINARY ? AND BINARY m.matcher_version=BINARY ? AND BINARY m.cleanup_version=BINARY ? AND BINARY ps.policy_version=BINARY m.policy_version AND BINARY ps.selection_id=BINARY m.selection_id
 AND BINARY m.manifest_sha256=BINARY ? AND OCTET_LENGTH(CAST(sr.manifest AS CHAR CHARACTER SET utf8mb4))<=4194304 AND BINARY CAST(sr.manifest AS CHAR CHARACTER SET utf8mb4)=BINARY CAST(t.manifest AS CHAR CHARACTER SET utf8mb4) AND OCTET_LENGTH(CAST(t.manifest AS CHAR CHARACTER SET utf8mb4))<=4194304
 AND CASE WHEN OCTET_LENGTH(CAST(t.manifest AS CHAR CHARACTER SET utf8mb4))<=4194304 THEN SHA2(CAST(t.manifest AS CHAR CHARACTER SET utf8mb4),256) END=m.manifest_sha256
 AND JSON_UNQUOTE(JSON_EXTRACT(t.manifest,'$.coverage'))='all-current-indexed-article-tags' AND NOT EXISTS(SELECT 1 FROM topic_current WHERE snapshot_id=t.id) LIMIT 1`;
  const lineage = `BINARY q.proof_version=BINARY g.proof_version AND BINARY q.fingerprint_version=BINARY g.fingerprint_version AND BINARY q.policy_version=BINARY g.policy_version AND BINARY q.selection_id=BINARY g.selection_id AND BINARY q.matcher_version=BINARY g.matcher_version AND BINARY q.cleanup_version=BINARY g.cleanup_version
 AND r.target_snapshot_id=g.snapshot_id AND r.status IN ('scanning','scanned-as-of') AND JSON_UNQUOTE(JSON_EXTRACT(r.state_json,'$.version'))='scan-v2'
 AND JSON_UNQUOTE(JSON_EXTRACT(r.state_json,'$.target'))=g.snapshot_id AND BINARY JSON_UNQUOTE(JSON_EXTRACT(r.state_json,'$.manifestSha256'))=BINARY ? AND BINARY JSON_UNQUOTE(JSON_EXTRACT(r.state_json,'$.policyVersion'))=BINARY g.policy_version AND BINARY JSON_UNQUOTE(JSON_EXTRACT(r.state_json,'$.selectionId'))=BINARY g.selection_id AND BINARY JSON_UNQUOTE(JSON_EXTRACT(r.state_json,'$.matcherVersion'))=BINARY g.matcher_version AND BINARY JSON_UNQUOTE(JSON_EXTRACT(r.state_json,'$.cleanupVersion'))=BINARY g.cleanup_version`;
  const metadata = `g.snapshot_id IS NOT NULL AND p.id IS NOT NULL AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP(6)) AND i.status='ok' AND i.matcher_version=g.matcher_version AND i.cleanup_version=g.cleanup_version AND i.body_kind=q.kind AND q.kind IN ('full','title-only') AND (q.kind='full' OR (q.body_fingerprint IS NULL AND q.body_content_hash IS NULL AND q.body_revision IS NULL AND q.body_obtained_at IS NULL AND q.source_kind IS NULL AND i.body_hash IS NULL)) AND (${lineage})
 AND q.observed_at IS NOT NULL AND q.checked_at IS NOT NULL AND q.observed_at<=UTC_TIMESTAMP(6) AND q.checked_at<=UTC_TIMESTAMP(6) AND q.checked_at>=q.observed_at AND i.input_hash IS NOT NULL AND q.input_hash IS NOT NULL AND BINARY i.input_hash=BINARY q.input_hash AND i.post_hash IS NOT NULL AND p.content_hash IS NOT NULL AND BINARY i.post_hash=BINARY p.content_hash AND q.metadata_fingerprint IS NOT NULL AND BINARY q.metadata_fingerprint=BINARY (${fp.metadataSql})`;
  const adapters = Object.keys(ADAPTER_SELECTORS).map((platform) => `${platform}-public`);
  const body = `q.kind='full' AND cb.post_id IS NOT NULL AND cb.blog_id=p.blog_id AND cb.status='ok' AND cb.completeness='full' AND cb.truncated=0 AND cb.image_only=0 AND cb.obtained_at<=UTC_TIMESTAMP(6) AND (cb.source_updated_at IS NULL OR cb.source_updated_at<=UTC_TIMESTAMP(6)) AND COALESCE(OCTET_LENGTH(cb.body_text),0)<=500000 AND COALESCE(OCTET_LENGTH(cb.body_html),0)<=2000000
 AND cb.adapter_version=? AND cb.adapter_id IN (${adapters.map(() => '?').join(',')}) AND cb.rule_revision BETWEEN 1 AND 2147483647 AND cb.source_kind IN ('rss-content','atom-content','wordpress-api','article-html')
 AND q.body_fingerprint IS NOT NULL AND q.body_content_hash IS NOT NULL AND i.body_hash IS NOT NULL AND cb.content_hash IS NOT NULL AND BINARY q.body_content_hash=BINARY cb.content_hash AND BINARY i.body_hash=BINARY cb.content_hash AND q.body_revision=cb.revision AND q.body_obtained_at=cb.obtained_at AND q.source_kind=cb.source_kind AND BINARY q.body_fingerprint=BINARY (${fp.bodySql})`;
  const requests = input.postIds.map(() => 'SELECT ? postId').join(' UNION ALL ');
  const statement = `SET STATEMENT max_statement_time=0.25 FOR SELECT d.postId,IF(g.snapshot_id IS NOT NULL,1,0) generationValid,IFNULL((${metadata}),0) titleFresh,IFNULL((${metadata}) AND (${body}),0) bodyFresh
 FROM (${requests}) d LEFT JOIN (${generation}) g ON 1=1 LEFT JOIN posts p ON p.id=d.postId LEFT JOIN blogs b ON b.id=p.blog_id LEFT JOIN topic_post_indexes_v3 i ON i.snapshot_id=g.snapshot_id AND i.post_id=d.postId LEFT JOIN topic_index_proofs q ON q.snapshot_id=g.snapshot_id AND q.post_id=d.postId LEFT JOIN topic_staged_scan_runs r ON r.run_id=q.scan_run_id LEFT JOIN content_post_bodies cb ON cb.post_id=p.id AND cb.blog_id=p.blog_id`;
  // Bind order follows SELECT predicates first, then request-derived and generation-derived FROM clauses.
  return {
    sql: statement,
    values: [
      p.manifestSha256,
      p.manifestSha256,
      CONTENT_VERSION,
      ...adapters,
      ...input.postIds,
      input.target,
      p.proofVersion,
      p.fingerprintVersion,
      p.policyVersion,
      p.selectionId,
      p.matcherVersion,
      p.cleanupVersion,
      p.manifestSha256,
    ],
  };
}
function resultRows(raw: unknown, input: InspectorInput): InspectorResult {
  if (!Array.isArray(raw) || types.isProxy(raw) || raw.length !== input.postIds.length || raw.length > 50) return blocked();
  const arrayDs = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== raw.length + 1) return blocked();
  const map = new Map<number, { generationValid: number; titleFresh: number; bodyFresh: number }>();
  let bytes = 0;
  for (let n = 0; n < raw.length; n++) {
    const descriptor = arrayDs[String(n)];
    if (!descriptor || !('value' in descriptor)) return blocked();
    const r = data(descriptor.value, ['postId', 'generationValid', 'titleFresh', 'bodyFresh']);
    if (!Number.isSafeInteger(r.postId) || !input.postIds.includes(Number(r.postId)) || map.has(Number(r.postId))) return blocked();
    for (const k of ['generationValid', 'titleFresh', 'bodyFresh']) if (r[k] !== 0 && r[k] !== 1) return blocked();
    if (r.bodyFresh === 1 && r.titleFresh !== 1) return blocked();
    bytes += Buffer.byteLength(JSON.stringify(r));
    if (bytes > 65536) return blocked();
    map.set(Number(r.postId), r as { generationValid: number; titleFresh: number; bodyFresh: number });
  }
  if ([...map.values()].some((r) => r.generationValid !== 1)) return blocked();
  return {
    status: 'ok',
    items: input.postIds.map((postId) => {
      const r = map.get(postId)!;
      return {
        postId,
        titleFresh: r.titleFresh === 1,
        bodyFresh: r.bodyFresh === 1,
        reason: r.titleFresh !== 1 ? 'unavailable' : r.bodyFresh === 1 ? 'fresh' : 'title-only-or-body-stale',
      };
    }),
  };
}
/** Private bounded inspector only. Cooperative writer proof, not auth or full consumer adoption. */
export async function inspectStagedProof(
  pool: Pool,
  raw: InspectorInput | unknown = {},
  controls: InspectorControls = {},
): Promise<InspectorResult> {
  let input: InspectorInput | undefined, duration: number, signal: AbortSignal | undefined;
  try {
    input = checked(raw);
    if (!input) return { status: 'disabled', items: [] };
    const c = data(controls, ['signal', 'maxDurationMs'], ['signal', 'maxDurationMs']);
    duration = c.maxDurationMs === undefined ? 1000 : (c.maxDurationMs as number);
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > 5000) return blocked();
    signal = c.signal as AbortSignal | undefined;
    if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) return blocked();
    aborted(signal); // Native brand check; own getters and event methods are never invoked.
  } catch {
    return blocked();
  }
  const size = (pool as unknown as { pool?: { config?: { connectionLimit?: number } } }).pool?.config?.connectionLimit;
  if (!Number.isSafeInteger(size) || Number(size) < 2) return blocked();
  if (aborted(signal)) return { status: 'deferred', reason: 'deadline', items: [] };
  if (admissions.has(pool)) return { status: 'busy', items: [] };
  admissions.add(pool);
  const deadline = Date.now() + duration;
  let c: PoolConnection | undefined,
    acquired = false,
    destroyed = false,
    expired = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    rejectAbort: (() => void) | undefined;
  let activeRead: Promise<unknown> | undefined,
    readSettled = false;
  const pending = Promise.resolve().then(() => pool.getConnection());
  pending.catch(() => {});
  const stop = () => {
    expired = true;
    rejectAbort?.();
    if (c && !destroyed) {
      destroyed = true;
      try {
        c.destroy();
      } catch {}
    }
  };
  const cancelled = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(Error('deadline'));
    timer = setTimeout(stop, duration);
    if (aborted(signal)) stop();
  });
  cancelled.catch(() => {});
  try {
    if (signal) nativeAdd.call(signal, 'abort', stop, { once: true });
    if (aborted(signal)) stop();
    c = await Promise.race([pending, cancelled]);
    acquired = true;
    if (expired || Date.now() >= deadline) {
      stop();
      throw Error('deadline');
    }
    const query = stagedProofInspectorQueryForTests(input);
    const read = c.query({ sql: query.sql, timeout: Math.max(1, deadline - Date.now()) }, query.values);
    activeRead = read;
    void read.then(
      () => {
        readSettled = true;
      },
      () => {
        readSettled = true;
      },
    );
    read.catch(() => {});
    const [rows] = await Promise.race([read, cancelled]);
    if (expired || aborted(signal) || Date.now() >= deadline) {
      stop();
      throw Error('deadline');
    }
    try {
      return resultRows(rows, input);
    } catch {
      return blocked();
    }
  } catch {
    if (c && !destroyed) {
      destroyed = true;
      try {
        c.destroy();
      } catch {}
    }
    return { status: 'deferred', reason: expired ? 'deadline' : 'local-db-unavailable', items: [] };
  } finally {
    try {
      if (signal) nativeRemove.call(signal, 'abort', stop);
    } catch {} // Removal failure must not bypass owned connection/admission cleanup.
    if (timer) clearTimeout(timer);
    if (!acquired) {
      void pending
        .then(
          (late) => {
            try {
              late.release();
            } catch {
              try {
                late.destroy();
              } catch {}
            }
          },
          () => {},
        )
        .finally(() => admissions.delete(pool))
        .catch(() => {});
    } else {
      if (c && !destroyed) {
        try {
          c.release();
        } catch {
          try {
            c.destroy();
          } catch {}
        }
      }
      if (activeRead && !readSettled) void activeRead.finally(() => admissions.delete(pool)).catch(() => {});
      else admissions.delete(pool);
    }
  }
}
