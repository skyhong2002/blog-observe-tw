import { types } from 'node:util';
import { ADAPTER_SELECTORS } from '../content/registry.ts';
import { TOPIC_FINGERPRINT_VERSION } from './provenance-fingerprint-sql.ts';
import type { ScanV2Pins } from './staged-scan-v2-contract.ts';
export const STAGED_PROOF_VERSION = 'full-index-proof-v1' as const;
const hex = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export type IndexProof = {
  snapshotId: string;
  postId: number;
  scanRunId: string;
  proofVersion: typeof STAGED_PROOF_VERSION;
  fingerprintVersion: typeof TOPIC_FINGERPRINT_VERSION;
  policyVersion: string;
  selectionId: string;
  matcherVersion: string;
  cleanupVersion: string;
  kind: 'full' | 'title-only';
  metadataFingerprint: string;
  bodyFingerprint: string | null;
  bodyContentHash: string | null;
  bodyRevision: number | null;
  sourceKind: string | null;
  bodyObtainedAt: string | null;
  observedAt: string;
  checkedAt: string;
  inputHash: string;
};
const keys = [
  'snapshotId',
  'postId',
  'scanRunId',
  'proofVersion',
  'fingerprintVersion',
  'policyVersion',
  'selectionId',
  'matcherVersion',
  'cleanupVersion',
  'kind',
  'metadataFingerprint',
  'bodyFingerprint',
  'bodyContentHash',
  'bodyRevision',
  'sourceKind',
  'bodyObtainedAt',
  'observedAt',
  'checkedAt',
  'inputHash',
];
const invalid = (): never => {
  throw Error('invalid-index-proof');
};
const utc = (v: unknown) => typeof v === 'string' && v.length === 24 && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
/** Structural proof record only; not authorization, ownership or authentication. */
export function validateIndexProof(raw: unknown): IndexProof {
  if (!raw || typeof raw !== 'object' || types.isProxy(raw) || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype)
    return invalid();
  const ds = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(raw).length !== keys.length || keys.some((k) => !ds[k] || !('value' in ds[k]))) return invalid();
  const r = Object.fromEntries(keys.map((k) => [k, ds[k].value]));
  if (
    typeof r.snapshotId !== 'string' ||
    !uuid.test(r.snapshotId) ||
    typeof r.scanRunId !== 'string' ||
    !uuid.test(r.scanRunId) ||
    !Number.isSafeInteger(r.postId) ||
    r.postId < 1 ||
    r.postId > 2147483647 ||
    r.proofVersion !== STAGED_PROOF_VERSION ||
    r.fingerprintVersion !== TOPIC_FINGERPRINT_VERSION
  )
    return invalid();
  for (const k of ['metadataFingerprint', 'inputHash', 'selectionId']) if (typeof r[k] !== 'string' || !hex.test(r[k])) return invalid();
  for (const k of ['policyVersion', 'matcherVersion', 'cleanupVersion'])
    if (typeof r[k] !== 'string' || !/^[A-Za-z0-9:._-]{1,128}$/.test(r[k])) return invalid();
  if (r.cleanupVersion.length > 64 || !utc(r.observedAt) || !utc(r.checkedAt)) return invalid();
  if (r.kind === 'title-only') {
    if (['bodyFingerprint', 'bodyContentHash', 'bodyRevision', 'sourceKind', 'bodyObtainedAt'].some((k) => r[k] !== null)) return invalid();
  } else if (r.kind === 'full') {
    for (const k of ['bodyFingerprint', 'bodyContentHash']) if (typeof r[k] !== 'string' || !hex.test(r[k])) return invalid();
    if (
      !Number.isSafeInteger(r.bodyRevision) ||
      r.bodyRevision < 1 ||
      r.bodyRevision > 2147483647 ||
      !['rss-content', 'atom-content', 'wordpress-api', 'article-html'].includes(r.sourceKind) ||
      !utc(r.bodyObtainedAt)
    )
      return invalid();
  } else return invalid();
  return r as IndexProof;
}
export function proofPinsMatch(row: Record<string, unknown>, pins: ScanV2Pins): boolean {
  return (
    row.proof_version === STAGED_PROOF_VERSION &&
    row.fingerprint_version === TOPIC_FINGERPRINT_VERSION &&
    row.status === 'staging' &&
    row.scan_contract_version === 'scan-v2' &&
    row.manifest_sha256 === pins.manifestSha256 &&
    row.policy_version === pins.policyVersion &&
    row.selection_id === pins.selectionId &&
    row.matcher_version === pins.matcherVersion &&
    row.cleanup_version === pins.cleanupVersion
  );
}
/** Strict origin evidence: canonical keys alone merge protocol/www and are insufficient. */
export function sameProofOrigin(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length > 1024 || b.length > 1024) return false;
  try {
    const x = new URL(a),
      y = new URL(b);
    return ['http:', 'https:'].includes(x.protocol) && !x.username && !x.password && !y.username && !y.password && x.origin === y.origin;
  } catch {
    return false;
  }
}

const knownAdapters = new Set(Object.keys(ADAPTER_SELECTORS).map((platform) => `${platform}-public`));
/** New proof mode only. Known ID is a schema gate, never identity/authorization proof. */
export function knownProofAdapter(body: Record<string, unknown>): boolean {
  return (
    typeof body.adapter_id === 'string' &&
    knownAdapters.has(body.adapter_id) &&
    Number.isSafeInteger(body.rule_revision) &&
    Number(body.rule_revision) >= 1 &&
    Number(body.rule_revision) <= 2147483647
  );
}
