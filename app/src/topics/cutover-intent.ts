import { createHash } from 'node:crypto';
export const CUTOVER_INTENT_VERSION = 'cutover-intent-v1' as const;
export const CUTOVER_INTENT_MAX_TTL_MS = 30_000;
export type CutoverIntentInput = {
  intentId: string;
  scanRunId: string;
  target: string;
  predecessor: string | null;
  manifestSha256: string;
  policyVersion: string;
  selectionId: string;
  matcherVersion: string;
  cleanupVersion: string;
  readerContractVersion: string;
  scanVersion: 'scan-v2';
  scanStateSha256: string;
  scanAsOf: string;
  scanHighWater: number;
  scanEpoch: number;
  dirtyEpoch: number;
  createdAt: string;
  ttlMs: number;
  targetRetainUntil: string;
  predecessorRetainUntil: string | null;
};
export type CutoverIntent = Readonly<
  CutoverIntentInput & {
    version: typeof CUTOVER_INTENT_VERSION;
    expiresAt: string;
    identitySha256: string;
    canPublish: false;
    canVerify: false;
  }
>;
export type CutoverIntentExpected = {
  intentId: string;
  identitySha256: string;
  current: string | null;
  dirtyEpoch: number;
  scanRunId: string;
  scanStateSha256: string;
  readerContractVersion: string;
};
const inputKeys = [
  'intentId',
  'scanRunId',
  'target',
  'predecessor',
  'manifestSha256',
  'policyVersion',
  'selectionId',
  'matcherVersion',
  'cleanupVersion',
  'readerContractVersion',
  'scanVersion',
  'scanStateSha256',
  'scanAsOf',
  'scanHighWater',
  'scanEpoch',
  'dirtyEpoch',
  'createdAt',
  'ttlMs',
  'targetRetainUntil',
  'predecessorRetainUntil',
] as const;
const expectedKeys = [
  'intentId',
  'identitySha256',
  'current',
  'dirtyEpoch',
  'scanRunId',
  'scanStateSha256',
  'readerContractVersion',
] as const;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const version = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9:._-]{1,128}$/.test(v);
const iso = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;
const counter = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647 && !Object.is(v, -0);
const invalid = (): never => {
  throw Error('invalid_cutover_intent');
};
/** Capture data primitives once; never invoke input getters/toJSON/iterators. Not a Proxy sandbox. */
function record(raw: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
  try {
    const descriptors = Object.getOwnPropertyDescriptors(raw),
      own = Reflect.ownKeys(descriptors);
    if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k))) return invalid();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      const d = descriptors[key];
      if (!d?.enumerable || !Object.hasOwn(d, 'value') || !(d.value === null || ['string', 'number', 'boolean'].includes(typeof d.value)))
        return invalid();
      result[key] = d.value;
    }
    return result;
  } catch {
    return invalid();
  }
}
function createFromCaptured(v: Record<string, unknown>): CutoverIntent {
  for (const key of ['intentId', 'scanRunId', 'target']) if (!uuid(v[key])) return invalid();
  if (v.predecessor !== null && !uuid(v.predecessor)) return invalid();
  if (v.predecessor === v.target || !sha(v.manifestSha256) || !sha(v.scanStateSha256) || v.scanVersion !== 'scan-v2') return invalid();
  for (const key of ['policyVersion', 'selectionId', 'matcherVersion', 'cleanupVersion', 'readerContractVersion'])
    if (!version(v[key])) return invalid();
  for (const key of ['scanHighWater', 'scanEpoch', 'dirtyEpoch']) if (!counter(v[key])) return invalid();
  if (
    !iso(v.createdAt) ||
    !iso(v.scanAsOf) ||
    Date.parse(v.scanAsOf) > Date.parse(v.createdAt) ||
    !iso(v.targetRetainUntil) ||
    typeof v.ttlMs !== 'number' ||
    !Number.isSafeInteger(v.ttlMs) ||
    v.ttlMs < 1 ||
    v.ttlMs > CUTOVER_INTENT_MAX_TTL_MS
  )
    return invalid();
  const expires = new Date(Date.parse(v.createdAt) + v.ttlMs).toISOString();
  if (!iso(expires) || Date.parse(v.targetRetainUntil) < Date.parse(expires)) return invalid();
  if (v.predecessor === null) {
    if (v.predecessorRetainUntil !== null) return invalid();
  } else if (!iso(v.predecessorRetainUntil) || Date.parse(v.predecessorRetainUntil) < Date.parse(expires)) return invalid();
  const input = {} as CutoverIntentInput;
  for (const k of inputKeys) Object.defineProperty(input, k, { value: v[k], enumerable: true });
  const core = { version: CUTOVER_INTENT_VERSION, ...input, expiresAt: expires };
  const identitySha256 = createHash('sha256').update(JSON.stringify(core), 'utf8').digest('hex');
  return Object.freeze({ ...core, identitySha256, canPublish: false as const, canVerify: false as const });
}
/** Future caller must create this only AFTER X barrier + fresh locking current read, not before long drain. */
export function createCutoverIntent(raw: unknown): CutoverIntent {
  return createFromCaptured(record(raw, inputKeys));
}
/** Digest checks corruption, not DB authenticity, lock ownership, retention enforcement or publication authority. */
export function parseCutoverIntent(raw: unknown): CutoverIntent {
  const v = record(raw, [...inputKeys, 'version', 'expiresAt', 'identitySha256', 'canPublish', 'canVerify']);
  if (v.version !== CUTOVER_INTENT_VERSION || v.canPublish !== false || v.canVerify !== false) return invalid();
  const parsed = createFromCaptured(v);
  if (parsed.expiresAt !== v.expiresAt || parsed.identitySha256 !== v.identitySha256) return invalid();
  return parsed;
}
export function assessCutoverIntent(raw: unknown, expectedRaw: unknown, now = new Date()) {
  const intent = parseCutoverIntent(raw),
    expected = record(expectedRaw, expectedKeys);
  if (
    !uuid(expected.intentId) ||
    !sha(expected.identitySha256) ||
    (expected.current !== null && !uuid(expected.current)) ||
    !counter(expected.dirtyEpoch) ||
    !uuid(expected.scanRunId) ||
    !sha(expected.scanStateSha256) ||
    !version(expected.readerContractVersion)
  )
    return invalid();
  let time: number;
  try {
    time = Date.prototype.getTime.call(now);
  } catch {
    return invalid();
  }
  if (!Number.isFinite(time)) return invalid();
  const base = { intentId: intent.intentId, canPublish: false as const, canVerify: false as const, retainCurrent: true as const };
  if (intent.intentId !== expected.intentId || intent.identitySha256 !== expected.identitySha256)
    return { ...base, status: 'conflict' as const, reason: 'intent-identity' as const };
  if (time < Date.parse(intent.createdAt)) return { ...base, status: 'not-active' as const, reason: 'created-in-future' as const };
  if (time >= Date.parse(intent.expiresAt)) return { ...base, status: 'expired' as const, reason: 'explicit-new-intent-required' as const };
  if (
    intent.predecessor !== expected.current ||
    intent.dirtyEpoch !== expected.dirtyEpoch ||
    intent.scanRunId !== expected.scanRunId ||
    intent.scanStateSha256 !== expected.scanStateSha256 ||
    intent.readerContractVersion !== expected.readerContractVersion
  )
    return { ...base, status: 'conflict' as const, reason: 'fresh-pins-drift' as const };
  return { ...base, status: 'hold' as const, reason: 'runtime-proof-missing' as const };
}
/** Explicit replacement only. Never mutate old predecessor/TTL, auto repin, continue a SQL operation or publish. */
export function replaceCutoverIntent(oldRaw: unknown, replacementRaw: unknown, reason: 'expired' | 'conflict' | 'explicit-rebase') {
  const previous = parseCutoverIntent(oldRaw),
    replacement = parseCutoverIntent(replacementRaw);
  if (
    !['expired', 'conflict', 'explicit-rebase'].includes(reason) ||
    previous.intentId === replacement.intentId ||
    Date.parse(replacement.createdAt) < Date.parse(previous.createdAt)
  )
    return invalid();
  return {
    status: 'hold' as const,
    reason: 'runtime-proof-missing' as const,
    replacementReason: reason,
    previousIntentId: previous.intentId,
    replacement,
    canPublish: false as const,
    canVerify: false as const,
    retainCurrent: true as const,
  };
}
