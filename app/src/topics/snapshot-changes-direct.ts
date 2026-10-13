import { pinChangesGeneration, validateChangesPage } from './snapshot-changes-contract.ts';
import { hash, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_MANIFEST_BYTES, MAX_SNAPSHOT_PAGE_BYTES } from './snapshot-client.ts';

export const DIRECT_CHANGES_VERSION = 'direct-changes-wire-v1' as const;
const CHECKPOINT_VERSION = 'direct-changes-checkpoint-v1' as const;
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/.test(v);
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const invalid = (): never => {
  throw Error('invalid_direct_changes');
};
/** Plain JSON envelope only. Proxy traps/arbitrary JS execution are not sandboxed. */
function copy(raw: unknown, cap: number): Record<string, unknown> {
  let nodes = 0;
  function visit(v: unknown, depth = 0): unknown {
    if (++nodes > 200100 || depth > 32) return invalid();
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0)) return v;
    if (!v || typeof v !== 'object') return invalid();
    const descriptors = Object.getOwnPropertyDescriptors(v),
      array = Array.isArray(v);
    const out: unknown[] | Record<string, unknown> = array ? [] : Object.create(null);
    for (const key of Reflect.ownKeys(descriptors)) {
      if (array && key === 'length') continue;
      const d = typeof key === 'string' ? descriptors[key] : undefined;
      if (typeof key !== 'string' || !d || !d.enumerable || !Object.hasOwn(d, 'value') || (array && !/^(0|[1-9]\d*)$/.test(key)))
        return invalid();
      Object.defineProperty(out, key, { value: visit(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
    }
    if (array && Object.keys(out).length !== (v as unknown[]).length) return invalid();
    return out;
  }
  const result = visit(raw);
  if (!result || typeof result !== 'object' || Array.isArray(result) || Buffer.byteLength(JSON.stringify(result)) > cap) return invalid();
  return result as Record<string, unknown>;
}
const disposition = { applied: false as const, published: false as const, cutoverAllowed: false as const, retainCurrent: true as const };
export type DirectChangesPin = {
  version: typeof DIRECT_CHANGES_VERSION;
  mode: 'empty' | 'direct';
  after: string;
  target: string;
  expectedFullBase: string;
  generationDigest: string;
  generation: ReturnType<typeof pinChangesGeneration>['generation'];
  pinDigest: string;
};
export type DirectChangesCheckpoint = {
  version: typeof CHECKPOINT_VERSION;
  pinDigest: string;
  nextPage: number;
  verifiedEvents: number;
  canonicalEntriesBytes: number;
  rollingReceipt: string;
  complete: boolean;
  stateDigest: string;
};
function pinCore(options: Record<string, unknown>) {
  if (!uuid(options.after) || !uuid(options.expectedFullBase)) return invalid();
  const pinned = pinChangesGeneration(options.after, options.generation),
    g = pinned.generation;
  const empty = pinned.after === pinned.target;
  if (g.previousId === g.id || (g.kind === 'delta' && g.baseSnapshotId === g.id)) return invalid();
  if (g.kind === 'delta' && g.baseSnapshotId !== options.expectedFullBase) return { status: 'need-full-rebase' as const, ...disposition };
  if (g.kind !== 'delta' && (!empty || g.id !== options.expectedFullBase)) return { status: 'need-full-rebase' as const, ...disposition };
  if (!empty && g.previousId !== options.after) return { status: 'hold' as const, chain: 'unverified' as const, ...disposition };
  const core = {
    version: DIRECT_CHANGES_VERSION,
    mode: empty ? ('empty' as const) : ('direct' as const),
    after: pinned.after,
    target: pinned.target,
    expectedFullBase: options.expectedFullBase,
    generationDigest: pinned.generationDigest,
    generation: g,
  };
  const pin = { ...core, pinDigest: hash(JSON.stringify(core)) };
  return { status: 'ready' as const, pin, ...disposition };
}
function checkedPin(raw: unknown): DirectChangesPin {
  const v = copy(raw, MAX_SNAPSHOT_MANIFEST_BYTES + 4096);
  if (Object.keys(v).length !== 8 || v.version !== DIRECT_CHANGES_VERSION) return invalid();
  const classified = pinCore(v);
  if (classified.status !== 'ready') return invalid();
  for (const k of ['mode', 'after', 'target', 'expectedFullBase', 'generationDigest', 'pinDigest'] as const)
    if (v[k] !== classified.pin[k]) return invalid();
  return classified.pin;
}
function expected(pin: DirectChangesPin) {
  const events = pin.mode === 'empty' ? 0 : Number(pin.generation.changeCount);
  return { events, pages: Math.max(1, Math.ceil(events / 500)) };
}
function seal(core: Omit<DirectChangesCheckpoint, 'stateDigest'>): DirectChangesCheckpoint {
  return { ...core, stateDigest: hash(JSON.stringify(core)) };
}
function initial(pin: DirectChangesPin) {
  return seal({
    version: CHECKPOINT_VERSION,
    pinDigest: pin.pinDigest,
    nextPage: 0,
    verifiedEvents: 0,
    canonicalEntriesBytes: 0,
    rollingReceipt: hash('direct-receipts-v1\n' + pin.pinDigest),
    complete: false,
  });
}
/** This is a wire receipt, not a SQL receipt, authentication or an upstream whole-image SHA. */
export function importDirectChangesCheckpoint(rawPin: unknown, raw: unknown): DirectChangesCheckpoint {
  const pin = checkedPin(rawPin),
    v = copy(raw, 4096),
    bounds = expected(pin);
  if (
    Object.keys(v).length !== 8 ||
    v.version !== CHECKPOINT_VERSION ||
    v.pinDigest !== pin.pinDigest ||
    !sha(v.rollingReceipt) ||
    !sha(v.stateDigest) ||
    typeof v.complete !== 'boolean'
  )
    return invalid();
  for (const k of ['nextPage', 'verifiedEvents', 'canonicalEntriesBytes'])
    if (typeof v[k] !== 'number' || !Number.isSafeInteger(v[k]) || Number(v[k]) < 0) return invalid();
  const next = Number(v.nextPage),
    events = Number(v.verifiedEvents),
    bytes = Number(v.canonicalEntriesBytes);
  if (
    next > bounds.pages ||
    events !== Math.min(next * 500, bounds.events) ||
    bytes > MAX_SNAPSHOT_BYTES ||
    v.complete !== (next === bounds.pages) ||
    bytes < next * 3 ||
    bytes > next * MAX_SNAPSHOT_PAGE_BYTES
  )
    return invalid();
  if (next === 0 && (bytes !== 0 || v.rollingReceipt !== initial(pin).rollingReceipt)) return invalid();
  const core = {
    version: CHECKPOINT_VERSION,
    pinDigest: pin.pinDigest,
    nextPage: next,
    verifiedEvents: events,
    canonicalEntriesBytes: bytes,
    rollingReceipt: v.rollingReceipt,
    complete: v.complete,
  };
  const checkpoint = seal(core);
  if (checkpoint.stateDigest !== v.stateDigest) return invalid();
  return checkpoint;
}
export function createDirectChangesVerification(raw: unknown) {
  const result = pinCore(copy(raw, MAX_SNAPSHOT_MANIFEST_BYTES + 4096));
  if (result.status !== 'ready') return result;
  return { ...result, checkpoint: initial(result.pin) };
}
export function verifyNextDirectChangesPage(rawPin: unknown, rawCheckpoint: unknown, rawPage: unknown) {
  const pin = checkedPin(rawPin),
    checkpoint = importDirectChangesCheckpoint(pin, rawCheckpoint),
    bounds = expected(pin);
  if (checkpoint.complete) return invalid();
  const index = checkpoint.nextPage;
  const page = validateChangesPage(rawPage, pinChangesGeneration(pin.after, pin.generation), String(index)).page;
  const entries = page.entries as unknown[];
  const count = Math.min(500, Math.max(0, bounds.events - index * 500));
  const expectedHash = bounds.events === 0 ? hash('[]\n') : (pin.generation.changePages as string[])[index];
  if (entries.length !== count || page.sha256 !== expectedHash || page.nextCursor !== (index + 1 < bounds.pages ? String(index + 1) : null))
    return invalid();
  const bytes = Buffer.byteLength(JSON.stringify(entries) + '\n');
  if (bytes > MAX_SNAPSHOT_PAGE_BYTES || bytes > MAX_SNAPSHOT_BYTES - checkpoint.canonicalEntriesBytes) return invalid();
  const next = seal({
    version: CHECKPOINT_VERSION,
    pinDigest: pin.pinDigest,
    nextPage: index + 1,
    verifiedEvents: checkpoint.verifiedEvents + count,
    canonicalEntriesBytes: checkpoint.canonicalEntriesBytes + bytes,
    rollingReceipt: hash(checkpoint.rollingReceipt + '\n' + JSON.stringify({ index, count, sha256: expectedHash, bytes }) + '\n'),
    complete: index + 1 === bounds.pages,
  });
  return {
    status: next.complete ? ('wire-complete' as const) : ('incomplete' as const),
    pin,
    checkpoint: next,
    page,
    verification: 'direct-generation-catalog' as const,
    ...disposition,
  };
}
