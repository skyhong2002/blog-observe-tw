import { describe, expect, it } from 'vitest';
import { assessCutoverIntent, createCutoverIntent, parseCutoverIntent, replaceCutoverIntent } from './cutover-intent.ts';

const id = (n: number) => `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
const raw = () => ({
  intentId: id(1),
  scanRunId: id(2),
  target: id(3),
  predecessor: id(4),
  manifestSha256: 'a'.repeat(64),
  policyVersion: 'policy-v1',
  selectionId: 'selection-v1',
  matcherVersion: 'matcher-v1',
  cleanupVersion: 'cleanup-v1',
  readerContractVersion: 'reader-v1',
  scanVersion: 'scan-v2',
  scanStateSha256: 'b'.repeat(64),
  scanAsOf: '2026-10-12T00:00:00.000Z',
  scanHighWater: 20875,
  scanEpoch: 1,
  dirtyEpoch: 2,
  createdAt: '2026-10-13T00:00:00.000Z',
  ttlMs: 1000,
  targetRetainUntil: '2026-10-13T00:01:00.000Z',
  predecessorRetainUntil: '2026-10-13T00:01:00.000Z',
});
const expected = (intent = createCutoverIntent(raw())) => ({
  intentId: intent.intentId,
  identitySha256: intent.identitySha256,
  current: intent.predecessor,
  dirtyEpoch: intent.dirtyEpoch,
  scanRunId: intent.scanRunId,
  scanStateSha256: intent.scanStateSha256,
  readerContractVersion: intent.readerContractVersion,
});
const at = (ms = 500) => new Date(Date.parse(raw().createdAt) + ms);
describe('pure cutover intent is NEVER publication authorization', () => {
  it('creates frozenprimitive metadata and roundtrips JSON; compatible facts still hold', () => {
    const intent = createCutoverIntent(raw());
    expect(Object.isFrozen(intent)).toBe(true);
    expect(intent.expiresAt).toBe('2026-10-13T00:00:01.000Z');
    expect(parseCutoverIntent(JSON.parse(JSON.stringify(intent)))).toEqual(intent);
    expect(assessCutoverIntent(intent, expected(intent), at())).toMatchObject({
      status: 'hold',
      reason: 'runtime-proof-missing',
      canVerify: false,
      canPublish: false,
      retainCurrent: true,
    });
  });
  it('accepts null predecessor only with null retention and never makes ready publication', () => {
    const intent = createCutoverIntent({ ...raw(), predecessor: null, predecessorRetainUntil: null });
    expect(assessCutoverIntent(intent, expected(intent), at()).status).toBe('hold');
    expect(() => createCutoverIntent({ ...raw(), predecessor: null })).toThrow();
  });
  it.each([
    { intentId: 'bad' },
    { scanRunId: 'bad' },
    { target: 'bad' },
    { predecessor: 'bad' },
    { predecessor: id(3) },
    { manifestSha256: 'wrong' },
    { scanStateSha256: 'wrong' },
    { scanVersion: 'staged-scan-v1' },
    { readerContractVersion: 'https://private.test/body' },
    { selectionId: '' },
    { scanHighWater: -1 },
    { scanEpoch: -0 },
    { dirtyEpoch: 2 ** 31 },
    { ttlMs: 0 },
    { ttlMs: 30001 },
    { ttlMs: 1.5 },
    { createdAt: '2026-10-13' },
    { scanAsOf: '2027-01-01T00:00:00.000Z' },
    { targetRetainUntil: '2026-10-13T00:00:00.999Z' },
    { predecessorRetainUntil: null },
    { predecessorRetainUntil: '2026-10-13T00:00:00.999Z' },
  ])('rejects malformed/weakpins %j', (patch) =>
    expect(() => createCutoverIntent({ ...raw(), ...patch })).toThrow('invalid_cutover_intent'),
  );
  it('expiration is inclusive, future creation not active and original remains frozen', () => {
    const intent = createCutoverIntent(raw());
    expect(assessCutoverIntent(intent, expected(intent), at(999)).status).toBe('hold');
    expect(assessCutoverIntent(intent, expected(intent), at(1000))).toMatchObject({ status: 'expired', canPublish: false });
    expect(assessCutoverIntent(intent, expected(intent), at(-1)).status).toBe('not-active');
    expect(() => assessCutoverIntent(intent, expected(intent), new Date('bad'))).toThrow();
    expect(intent.ttlMs).toBe(1000);
  });
  it('window A→B→C changes conflict; scan-run identity and dirty/reader drift all hold', () => {
    const intent = createCutoverIntent(raw());
    for (const patch of [
      { current: id(5) },
      { current: id(6) },
      { dirtyEpoch: 3 },
      { scanRunId: id(7) },
      { scanStateSha256: 'c'.repeat(64) },
      { readerContractVersion: 'reader-v2' },
    ])
      expect(assessCutoverIntent(intent, { ...expected(intent), ...patch }, at())).toMatchObject({
        status: 'conflict',
        canPublish: false,
        canVerify: false,
      });
  });
  it('no in-place predecessor orTTL changes; recomputed different metadata still conflicts with externally pinned identity', () => {
    const intent = createCutoverIntent(raw());
    for (const patch of [{ predecessor: id(5) }, { ttlMs: 2000 }, { expiresAt: '2026-10-13T00:00:02.000Z' }])
      expect(() => parseCutoverIntent({ ...intent, ...patch })).toThrow();
    const other = createCutoverIntent({ ...raw(), predecessor: id(5), ttlMs: 2000 });
    expect(assessCutoverIntent(other, expected(intent), at()).reason).toBe('intent-identity');
    expect(() => replaceCutoverIntent(intent, other, 'conflict')).toThrow();
  });
  it('explicit rebase requires newID and freshmetadata; replacing still never publishes or mutates predecessor', () => {
    const original = createCutoverIntent(raw());
    const fresh = createCutoverIntent({
      ...raw(),
      intentId: id(8),
      predecessor: id(6),
      createdAt: '2026-10-13T00:00:02.000Z',
      dirtyEpoch: 4,
    });
    for (const reason of ['expired', 'conflict', 'explicit-rebase'] as const)
      expect(replaceCutoverIntent(original, fresh, reason)).toMatchObject({
        status: 'hold',
        previousIntentId: original.intentId,
        replacement: { intentId: id(8), predecessor: id(6) },
        canPublish: false,
        canVerify: false,
      });
    expect(original.predecessor).toBe(id(4));
    expect(original.ttlMs).toBe(1000);
    expect(() => replaceCutoverIntent(original, fresh, 'auto-repin' as never)).toThrow();
  });
  it('rejects getters/symbols/toJSON/extra secret fields with zero invocation and never retains bodyURL/token', () => {
    let reads = 0;
    const getter = { ...raw() };
    Object.defineProperty(getter, 'predecessor', {
      enumerable: true,
      get() {
        reads++;
        throw Error('SECRET');
      },
    });
    expect(() => createCutoverIntent(getter)).toThrow('invalid_cutover_intent');
    expect(reads).toBe(0);
    for (const extra of [
      { token: 'SECRET' },
      { bodyUrl: 'https://private.test/' },
      { [Symbol('hidden')]: 'SECRET' },
      {
        toJSON: () => {
          throw Error('RUN');
        },
      },
    ])
      expect(() => createCutoverIntent({ ...raw(), ...extra })).toThrow();
    expect(JSON.stringify(createCutoverIntent(raw()))).not.toContain('SECRET');
  });
  it('callerboolean cannot authorizeSQL/reader/dirtycompleteness, even when facts arealltrue', () => {
    const intent = createCutoverIntent(raw());
    expect(() => parseCutoverIntent({ ...intent, canPublish: true })).toThrow();
    expect(() => parseCutoverIntent({ ...intent, canVerify: true })).toThrow();
    expect(() =>
      assessCutoverIntent(intent, { ...expected(intent), barrierVerified: true, readerCompatible: true, dirtyComplete: true }, at()),
    ).toThrow();
  });
  it('strict expected facts reject getter/shape drift without secret error output', () => {
    const intent = createCutoverIntent(raw());
    let calls = 0;
    const facts = { ...expected(intent) };
    Object.defineProperty(facts, 'current', {
      get() {
        calls++;
        return 'SECRET';
      },
      enumerable: true,
    });
    expect(() => assessCutoverIntent(intent, facts, at())).toThrow('invalid_cutover_intent');
    expect(calls).toBe(0);
    expect(() => assessCutoverIntent(intent, { ...expected(intent), current: 'SECRET' }, at())).toThrow('invalid_cutover_intent');
  });
});
