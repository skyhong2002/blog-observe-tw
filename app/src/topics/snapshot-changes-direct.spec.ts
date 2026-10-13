import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createDirectChangesVerification, importDirectChangesCheckpoint, verifyNextDirectChangesPage } from './snapshot-changes-direct.ts';
import { hash, SOURCE } from './snapshot-client.ts';

const after = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  base = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const term = {
  id: hash('資\u200b安'),
  label: '資\u200b安',
  articleCount: 1,
  firstPublishedAt: '2026-01-01T00:00:00.000Z',
  lastPublishedAt: '2026-01-01T00:00:00.000Z',
  origin: 'article-tags-mixed',
  journalistAssigned: null,
};
const entry = { action: 'upsert', term, active: true };
function fixture(count = 501) {
  const events = Array.from({ length: count }, () => entry),
    pages = Array.from({ length: Math.ceil(count / 500) }, (_, i) => events.slice(i * 500, (i + 1) * 500));
  const generation = {
    schemaVersion: 1,
    kind: 'delta',
    id: target,
    previousId: after,
    baseSnapshotId: base,
    generatedAt: '2026-01-01T00:00:00.000Z',
    source: SOURCE,
    total: 1,
    pageSize: 500,
    changeCount: count,
    changePages: pages.map((p) => hash(JSON.stringify(p) + '\n')),
    noisePolicyVersion: 'v1',
    sourceAsOf: { opaque: 'keep' },
  };
  return {
    generation,
    page: (i: number) => ({
      snapshot: generation,
      entries: pages[i] ?? [],
      cursor: String(i),
      nextCursor: i + 1 < pages.length ? String(i + 1) : null,
      sha256: hash(JSON.stringify(pages[i] ?? []) + '\n'),
    }),
  };
}
function ready(f = fixture(), inputAfter = after) {
  const r = createDirectChangesVerification({ after: inputAfter, expectedFullBase: base, generation: f.generation });
  if (r.status !== 'ready') throw Error('fixture not ready');
  return r;
}
describe('direct generation wire-only catalog verification', () => {
  it('checks actual target catalog across2pages and resumes a serialized checkpoint without claiming application', () => {
    const f = fixture(),
      initial = ready(f);
    const first = verifyNextDirectChangesPage(initial.pin, initial.checkpoint, f.page(0));
    expect(first).toMatchObject({
      status: 'incomplete',
      checkpoint: { nextPage: 1, verifiedEvents: 500 },
      cutoverAllowed: false,
      applied: false,
      published: false,
    });
    const serialized = JSON.parse(JSON.stringify(first));
    const checkpoint = importDirectChangesCheckpoint(serialized.pin, serialized.checkpoint);
    const final = verifyNextDirectChangesPage(serialized.pin, checkpoint, f.page(1));
    expect(final).toMatchObject({
      status: 'wire-complete',
      checkpoint: { nextPage: 2, verifiedEvents: 501, complete: true },
      applied: false,
      published: false,
      cutoverAllowed: false,
    });
    expect(() => verifyNextDirectChangesPage(final.pin, final.checkpoint, f.page(1))).toThrow();
  });
  it('restores in a new Node process using only serialized pin/checkpoint', () => {
    const f = fixture(),
      r = ready(f),
      first = verifyNextDirectChangesPage(r.pin, r.checkpoint, f.page(0));
    const module = new URL('./snapshot-changes-direct.ts', import.meta.url).href;
    const code = `import {readFileSync} from 'node:fs';import {verifyNextDirectChangesPage} from ${JSON.stringify(module)};const p=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(verifyNextDirectChangesPage(p.pin,p.checkpoint,p.page)));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      input: JSON.stringify({ pin: first.pin, checkpoint: first.checkpoint, page: f.page(1) }),
      encoding: 'utf8',
      timeout: 5000,
    });
    expect(child.status, child.stderr).toBe(0);
    expect(JSON.parse(child.stdout)).toMatchObject({ status: 'wire-complete', cutoverAllowed: false });
  });
  it('aftertarget empty independently of target own count; zerochange direct requires explicit empty ack', () => {
    for (const [f, inputAfter] of [
      [fixture(501), target],
      [fixture(0), after],
    ] as const) {
      const r = ready(f, inputAfter);
      const wire = { snapshot: f.generation, entries: [], cursor: '0', nextCursor: null, sha256: hash('[]\n') };
      const final = verifyNextDirectChangesPage(r.pin, r.checkpoint, wire);
      expect(final).toMatchObject({ status: 'wire-complete', checkpoint: { verifiedEvents: 0, nextPage: 1, complete: true } });
    }
  });
  it('hold multi-generation; wrong base and full transition need rebase preservingcurrent', () => {
    const f = fixture();
    expect(createDirectChangesVerification({ after: base, expectedFullBase: base, generation: f.generation })).toMatchObject({
      status: 'hold',
      chain: 'unverified',
      cutoverAllowed: false,
    });
    expect(createDirectChangesVerification({ after, expectedFullBase: after, generation: f.generation })).toMatchObject({
      status: 'need-full-rebase',
      retainCurrent: true,
    });
    const { kind: _kind, baseSnapshotId: _base, ...g } = f.generation;
    const full = {
      ...g,
      attribution: 'tag',
      coverage: 'all-current-indexed-article-tags',
      provenance: 'mixed',
      identity: 'sha256-exact-utf8-label',
      pages: ['a'.repeat(64)],
      sha256: 'b'.repeat(64),
    };
    expect(createDirectChangesVerification({ after, expectedFullBase: base, generation: full })).toMatchObject({
      status: 'need-full-rebase',
    });
    expect(createDirectChangesVerification({ after: target, expectedFullBase: target, generation: full }).status).toBe('ready');
  });
  it('rejects wrong count/next/hash/order/metadata drift and samechain selfchecksum is not an oracle', () => {
    const f = fixture(),
      r = ready(f);
    for (const wire of [
      f.page(1),
      { ...f.page(0), nextCursor: null },
      { ...f.page(0), entries: [entry], sha256: hash(JSON.stringify([entry]) + '\n') },
      { ...f.page(0), sha256: '0'.repeat(64) },
      { ...f.page(0), snapshot: { ...f.generation, sourceAsOf: { opaque: 'changed' } } },
    ])
      expect(() => verifyNextDirectChangesPage(r.pin, r.checkpoint, wire)).toThrow();
    const first = verifyNextDirectChangesPage(r.pin, r.checkpoint, f.page(0));
    expect(() => verifyNextDirectChangesPage(first.pin, first.checkpoint, f.page(0))).toThrow();
  });
  it('checks pin/schema/state counters/digest/getters and preserves no secrets or lossy normalization', () => {
    const f = fixture(),
      r = ready(f);
    for (const patch of [
      { nextPage: 1 },
      { verifiedEvents: 1 },
      { canonicalEntriesBytes: 2 ** 31 + 1 },
      { rollingReceipt: '0'.repeat(64) },
      { complete: true },
      { version: 'unknown' },
      { extra: 'PRIVATE' },
    ])
      expect(() => importDirectChangesCheckpoint(r.pin, { ...r.checkpoint, ...patch })).toThrow();
    expect(() => importDirectChangesCheckpoint({ ...r.pin, expectedFullBase: after }, r.checkpoint)).toThrow();
    let reads = 0;
    const ck = { ...r.checkpoint };
    Object.defineProperty(ck, 'nextPage', {
      enumerable: true,
      get() {
        reads++;
        return 0;
      },
    });
    expect(() => importDirectChangesCheckpoint(r.pin, ck)).toThrow();
    expect(reads).toBe(0);
    const bad = { ...entry, term: { ...term, id: hash('資安') } };
    expect(() =>
      verifyNextDirectChangesPage(r.pin, r.checkpoint, { ...f.page(0), entries: [bad], sha256: hash(JSON.stringify([bad]) + '\n') }),
    ).toThrow();
  });
  it('absence remains upstream membership, duplicate events retain order, not SEOwithdraw', () => {
    const f = fixture(1),
      absence = { action: 'absent-from-index', id: term.id, label: term.label, active: false };
    f.generation.changePages = [hash(JSON.stringify([absence]) + '\n')];
    const r = ready(f);
    const final = verifyNextDirectChangesPage(r.pin, r.checkpoint, {
      ...f.page(0),
      entries: [absence],
      sha256: f.generation.changePages[0],
    });
    expect(final).toMatchObject({ status: 'wire-complete', cutoverAllowed: false });
  });
  it('enforces4MBmetadata/2MBpage and checkpoint2GiB ceiling before accepting newwire', () => {
    const f = fixture(),
      r = ready(f);
    expect(() =>
      createDirectChangesVerification({ after, expectedFullBase: base, generation: { ...f.generation, opaque: 'x'.repeat(4000001) } }),
    ).toThrow();
    expect(() => verifyNextDirectChangesPage(r.pin, r.checkpoint, { ...f.page(0), opaque: 'x'.repeat(2000001) })).toThrow();
    // Synthetic boundary verifies caps, not a2GiB throughput or oracle claim.
    expect(() => importDirectChangesCheckpoint(r.pin, { ...r.checkpoint, canonicalEntriesBytes: 2 ** 31 + 1 })).toThrow();
  });
});

it('accepts a synthetic exactly2GiB continuation but rejects one additional real page without allocating2GiB', () => {
  const f = fixture(500);
  f.generation.changeCount = 1075 * 500;
  f.generation.changePages = Array(1075).fill(f.generation.changePages[0]);
  const r = ready(f);
  const core = {
    version: r.checkpoint.version,
    pinDigest: r.pin.pinDigest,
    nextPage: 1074,
    verifiedEvents: 1074 * 500,
    canonicalEntriesBytes: 2 ** 31,
    rollingReceipt: 'a'.repeat(64),
    complete: false,
  };
  const checkpoint = { ...core, stateDigest: hash(JSON.stringify(core)) };
  expect(importDirectChangesCheckpoint(r.pin, checkpoint).canonicalEntriesBytes).toBe(2 ** 31);
  const wire = { ...f.page(0), cursor: '1074', nextCursor: null };
  expect(() => verifyNextDirectChangesPage(r.pin, checkpoint, wire)).toThrow();
});
