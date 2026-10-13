/** Pure continuation contract only. Caller-supplied facts do not prove DB freshness or privacy. */
export type PublicationPins = {
  target: string;
  expectedCurrent: string | null;
  manifestSha256: string;
  policyVersion: string;
  selectionId: string;
  matcherVersion: string;
  cleanupVersion: string;
};
export type PublicationContinuation = PublicationPins & {
  version: 'staged-scan-v1';
  canVerify: false;
  state: 'scanning' | 'scanned-as-of';
  highWater: number;
  asOf: string;
  cursor: number;
  epoch: number;
  checked: number;
  eligible: number;
  zeroHit: number;
  skipped: number;
  capped: number;
  unresolved: number;
};
export type PublicationInput = PublicationPins & { enabled?: boolean; highWater: number; asOf: string };
/** Facts must be obtained and rechecked by the future SQL caller in its write transaction. */
export type FreshArticleFact = {
  postId: number;
  publicBefore: boolean;
  publicFresh: boolean;
  ownerFresh: boolean;
  dateFresh: boolean;
  revisionFresh: boolean;
  result: 'hits' | 'zero' | 'capped';
};
const pinKeys = [
  'target',
  'expectedCurrent',
  'manifestSha256',
  'policyVersion',
  'selectionId',
  'matcherVersion',
  'cleanupVersion',
] as const;
const keys = [
  ...pinKeys,
  'version',
  'canVerify',
  'state',
  'highWater',
  'asOf',
  'cursor',
  'epoch',
  'checked',
  'eligible',
  'zeroHit',
  'skipped',
  'capped',
  'unresolved',
];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const bounded = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 2_147_483_647;
const invalid = (): never => {
  throw Error('invalid-publication-contract');
};
function record(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) return invalid();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (
    Reflect.ownKeys(raw).length !== allowed.length ||
    allowed.some((k) => !descriptors[k] || !('value' in descriptors[k])) ||
    Reflect.ownKeys(raw).some((k) => typeof k !== 'string' || !allowed.includes(k))
  )
    return invalid();
  return Object.fromEntries(allowed.map((k) => [k, descriptors[k].value]));
}
function pins(r: Record<string, unknown>) {
  if (
    typeof r.target !== 'string' ||
    !uuid.test(r.target) ||
    !(r.expectedCurrent === null || (typeof r.expectedCurrent === 'string' && uuid.test(r.expectedCurrent))) ||
    typeof r.manifestSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(r.manifestSha256)
  )
    return invalid();
  for (const k of ['policyVersion', 'selectionId', 'matcherVersion', 'cleanupVersion'])
    if (typeof r[k] !== 'string' || !/^[a-zA-Z0-9:._-]{1,128}$/.test(r[k] as string)) return invalid();
}
export function parsePublicationContinuation(raw: unknown): PublicationContinuation {
  const r = record(raw, keys);
  pins(r);
  if (
    r.version !== 'staged-scan-v1' ||
    r.canVerify !== false ||
    typeof r.state !== 'string' ||
    !['scanning', 'scanned-as-of'].includes(r.state)
  )
    return invalid();
  for (const k of ['highWater', 'cursor', 'epoch', 'checked', 'eligible', 'zeroHit', 'skipped', 'capped', 'unresolved'])
    if (!bounded(r[k])) return invalid();
  if (
    typeof r.asOf !== 'string' ||
    r.asOf.length !== 24 ||
    !Number.isFinite(Date.parse(r.asOf)) ||
    new Date(r.asOf).toISOString() !== r.asOf
  )
    return invalid();
  if (
    Number(r.cursor) > Number(r.highWater) ||
    Number(r.checked) !== Number(r.eligible) + Number(r.skipped) + Number(r.capped) + Number(r.unresolved) ||
    Number(r.zeroHit) > Number(r.eligible) ||
    Number(r.checked) > Number(r.cursor)
  )
    return invalid();
  if (r.state === 'scanned-as-of' && r.cursor !== r.highWater) return invalid();
  return r as PublicationContinuation;
}
export function startPublicationScan(input: PublicationInput): { status: 'disabled' } | PublicationContinuation {
  // Disabled performs no validation or property enumeration of corpus/pins.
  const enabled = Object.getOwnPropertyDescriptor(input, 'enabled');
  if (!enabled || !('value' in enabled) || enabled.value !== true) return { status: 'disabled' };
  const r = record(input, [...pinKeys, 'enabled', 'highWater', 'asOf']);
  return parsePublicationContinuation({
    ...Object.fromEntries(pinKeys.map((k) => [k, r[k]])),
    version: 'staged-scan-v1',
    canVerify: false,
    state: r.highWater === 0 ? 'scanned-as-of' : 'scanning',
    highWater: r.highWater,
    asOf: r.asOf,
    cursor: 0,
    epoch: 0,
    checked: 0,
    eligible: 0,
    zeroHit: 0,
    skipped: 0,
    capped: 0,
    unresolved: 0,
  });
}
export function advancePublicationScan(
  raw: unknown,
  batch: { expectedCursor: number; observedCurrent: string | null; epoch: number; facts: FreshArticleFact[]; exhausted: boolean },
): { status: 'conflict'; reason: 'cursor' | 'current' | 'dirty' } | PublicationContinuation {
  const state = parsePublicationContinuation(raw);
  const b = record(batch, ['expectedCursor', 'observedCurrent', 'epoch', 'facts', 'exhausted']);
  if (!bounded(b.expectedCursor) || !bounded(b.epoch) || typeof b.exhausted !== 'boolean' || !Array.isArray(b.facts) || b.facts.length > 50)
    return invalid();
  if (b.expectedCursor !== state.cursor) return { status: 'conflict', reason: 'cursor' };
  if (b.observedCurrent !== state.expectedCurrent) return { status: 'conflict', reason: 'current' };
  if (b.epoch !== state.epoch) return { status: 'conflict', reason: 'dirty' };
  const next = { ...state };
  const arrayDescriptors = Object.getOwnPropertyDescriptors(b.facts);
  if (Reflect.ownKeys(b.facts).length !== b.facts.length + 1) return invalid();
  for (let i = 0; i < b.facts.length; i++) {
    const d = arrayDescriptors[String(i)];
    if (!d || !('value' in d)) return invalid();
    const f = record(d.value, ['postId', 'publicBefore', 'publicFresh', 'ownerFresh', 'dateFresh', 'revisionFresh', 'result']);
    if (
      !bounded(f.postId) ||
      Number(f.postId) <= next.cursor ||
      Number(f.postId) > next.highWater ||
      typeof f.result !== 'string' ||
      !['hits', 'zero', 'capped'].includes(f.result)
    )
      return invalid();
    for (const k of ['publicBefore', 'publicFresh', 'ownerFresh', 'dateFresh', 'revisionFresh'])
      if (typeof f[k] !== 'boolean') return invalid();
    next.cursor = Number(f.postId);
    next.checked++;
    if (!f.publicFresh || !f.ownerFresh || !f.dateFresh) next.skipped++;
    else if (!f.publicBefore || !f.revisionFresh) next.unresolved++;
    else if (f.result === 'capped') next.capped++;
    else {
      next.eligible++;
      if (f.result === 'zero') next.zeroHit++;
    }
  }
  if (b.exhausted) {
    next.cursor = next.highWater;
    next.state = 'scanned-as-of';
  }
  // No verified state or cutover authorization, even when all counters are clean.
  return parsePublicationContinuation(next);
}
export function resumePublicationScan(raw: unknown, expected: PublicationPins): PublicationContinuation {
  const state = parsePublicationContinuation(raw),
    p = record(expected, pinKeys);
  pins(p);
  if (pinKeys.some((k) => state[k] !== p[k])) throw Error('publication-pin-mismatch');
  return state;
}
