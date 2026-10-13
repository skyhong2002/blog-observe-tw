import { describe, expect, it } from 'vitest';
import { changesHttpStatus, pinChangesGeneration, validateChangesGeneration, validateChangesPage } from './snapshot-changes-contract.ts';
import { hash, SOURCE } from './snapshot-client.ts';

const after = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const term = {
  id: hash('資\u200b安'),
  label: '資\u200b安',
  articleCount: 1,
  firstPublishedAt: '2026-01-01T00:00:00.000Z',
  lastPublishedAt: '2026-01-01T00:00:00.000Z',
  origin: 'article-tags-mixed',
  journalistAssigned: null,
};
const delta = () => ({
  schemaVersion: 1,
  kind: 'delta',
  id: target,
  previousId: after,
  baseSnapshotId: after,
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: SOURCE,
  total: 2,
  pageSize: 500,
  changeCount: 1,
  changePages: ['a'.repeat(64)],
  noisePolicyVersion: 'tag-noise-v1',
  sourceAsOf: { opaque: 'keep' },
});
function page(entries: unknown[], generation = delta(), cursor = '0', nextCursor: string | null = null) {
  return { snapshot: generation, entries, cursor, nextCursor, sha256: hash(JSON.stringify(entries) + '\n') };
}
describe('offline changes contract (not deployed compatibility)', () => {
  it('preserves opaque full/delta identity and validates the appropriate schema', () => {
    const full = {
      ...delta(),
      kind: undefined,
      previousId: null,
      attribution: 'tag',
      coverage: 'all-current-indexed-article-tags',
      provenance: 'mixed',
      identity: 'sha256-exact-utf8-label',
      pages: ['b'.repeat(64)],
      sha256: 'c'.repeat(64),
    };
    delete full.kind;
    expect(validateChangesGeneration(full).sourceAsOf).toEqual({ opaque: 'keep' });
    expect(validateChangesGeneration(delta())).toEqual(delta());
  });
  it.each([
    { schemaVersion: 2 },
    { pageSize: 5000 },
    { total: -1 },
    { changeCount: 501 },
    { generatedAt: '2026-01-01' },
    { noisePolicyVersion: '' },
    { baseSnapshotId: 'x' },
    { changePages: ['bad'] },
    { kind: 'unknown' },
  ])('rejects invalid generation %j', (patch) => expect(() => validateChangesGeneration({ ...delta(), ...patch })).toThrow());
  it('upsert reuses full term validation, keeps exact zero-width label identity and duplicate events', () => {
    const entries = [
      { action: 'upsert', term, active: true },
      { action: 'upsert', term, active: false },
    ];
    const result = validateChangesPage(page(entries), pinChangesGeneration(after, delta()), '0');
    expect(result.page.entries).toHaveLength(2);
    expect(result.chain).toBe('unverified');
    expect(result.completeGeneration).toBe(false);
    expect(result.cutoverAllowed).toBe(false);
    expect(() =>
      validateChangesPage(page([{ action: 'upsert', term: { ...term, id: hash('資安') } }]), pinChangesGeneration(after, delta()), '0'),
    ).toThrow();
  });
  it('absence is not revocation and checks exact ID/label and optional active boolean', () => {
    const entry = { action: 'absent-from-index', id: term.id, label: term.label, active: false };
    expect(validateChangesPage(page([entry]), pinChangesGeneration(after, delta()), '0').absenceMeaning).toContain('not blog-evidence');
    for (const patch of [{ id: '0'.repeat(64) }, { active: 0 }, { action: 'delete' }, { label: '\ud800' }])
      expect(() => validateChangesPage(page([{ ...entry, ...patch }]), pinChangesGeneration(after, delta()), '0')).toThrow();
  });
  it('chain cursor can exceed target catalog; target changeCount must not be used as chain total', () => {
    const entries = Array.from({ length: 500 }, () => ({ action: 'absent-from-index', id: term.id, label: term.label }));
    expect(validateChangesPage(page(entries, delta(), '8', '9'), pinChangesGeneration(after, delta()), '8').chain).toBe('unverified');
    expect(() =>
      validateChangesPage(page([...entries, entries[0]], delta(), '8', '9'), pinChangesGeneration(after, delta()), '8'),
    ).toThrow();
  });
  it('pins target including opaque metadata and checks cursor/hash/next independently', () => {
    const pin = pinChangesGeneration(after, delta()),
      raw = page([{ action: 'upsert', term }]);
    for (const patch of [
      { cursor: '1' },
      { nextCursor: '3' },
      { sha256: '0'.repeat(64) },
      { snapshot: { ...delta(), sourceAsOf: { opaque: 'changed' } } },
    ])
      expect(() => validateChangesPage({ ...raw, ...patch }, pin, '0')).toThrow();
    expect(() => validateChangesPage(raw, pin, '00')).toThrow();
  });
  it('empty after=target response does not imply target itself had zero changes', () => {
    const pin = pinChangesGeneration(target, delta());
    expect(validateChangesPage(page([]), pin, '0').cutoverAllowed).toBe(false);
    expect(() => validateChangesPage(page([{ action: 'upsert', term }]), pin, '0')).toThrow();
  });
  it('rejects getters without side effects and oversize opaque data', () => {
    let reads = 0;
    const g = delta();
    Object.defineProperty(g, 'total', {
      enumerable: true,
      get() {
        reads++;
        return 1;
      },
    });
    expect(() => validateChangesGeneration(g)).toThrow();
    expect(reads).toBe(0);
    expect(() => validateChangesGeneration({ ...delta(), opaque: 'x'.repeat(4000001) })).toThrow();
  });
  it('409 requests full rebase, preserving current; no automatic staging/cutover', () =>
    expect(changesHttpStatus(409)).toEqual({ status: 'need-full-rebase', retainCurrent: true }));
});
