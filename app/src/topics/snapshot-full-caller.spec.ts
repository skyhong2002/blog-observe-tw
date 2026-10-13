import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { test, vi } from 'vitest';
import type { SnapshotSource } from './snapshot-client.ts';
import { type ExportManifest, type ExportTerm, MAX_SNAPSHOT_PAGE_BYTES, SOURCE } from './snapshot-client.ts';
import * as fullCaller from './snapshot-full-caller.ts';
import { FULL_WIRE_ACCOUNTING, type FullSnapshotOptions, inheritFullControls, runFullSnapshot } from './snapshot-full-caller.ts';
import { LARGE_SNAPSHOT_CONTRACT, LargeSnapshotSource } from './snapshot-large-source.ts';
import { syncVocabulary } from './sync.ts';

const explicit: FullSnapshotOptions = {
  enabled: true,
  sourceMode: 'large5000',
  payloadMode: 'single-copy-v1',
  largeContract: LARGE_SNAPSHOT_CONTRACT,
};
function fixture(ready = false) {
  const reservations: { scope: string; limit: number }[] = [];
  let queries = 0,
    imports = 0,
    factories = 0;
  let beforeWire: () => Promise<void> = async () => {};
  const pool = {
    query: async () => {
      queries++;
      return [ready ? [{ snapshot_id: '00000000-0000-4000-8000-000000000001' }] : []];
    },
  } as unknown as Pool;
  const source: SnapshotSource = {
    current: async () => {
      throw Error('must not reread current');
    },
    page: async () => {
      throw Error('unused');
    },
  };
  const options = {
    ...explicit,
    sourceFactory: {
      accounting: FULL_WIRE_ACCOUNTING,
      inheritFullControls,
      create: (c: { beforeRequest: () => Promise<void> }) => {
        factories++;
        beforeWire = c.beforeRequest;
        return source;
      },
    },
  };
  const deps = {
    withJobLease: async (_p: Pool, _n: string, work: (guard: () => Promise<void>) => Promise<unknown>) => work(async () => {}),
    reserveBudget: async (_p: Pool, r: { scope: string; limit: number }[]) => {
      reservations.push(...r);
      return true;
    },
    importSnapshot: async (...args: unknown[]) => {
      imports++;
      const controls = args[5] as Record<string, unknown>;
      assert.equal(controls.payloadMode, 'single-copy-v1');
      assert.equal(controls.beforeRequest, undefined);
      assert.ok(Number(args[4]) <= 50);
      assert.equal(args[1], source);
      return { status: 'ready', version: '00000000-0000-4000-8000-000000000001', secret: 'not public' };
    },
  };
  return {
    pool,
    options,
    deps: deps as unknown as Parameters<typeof runFullSnapshot>[2],
    reservations,
    wire: () => beforeWire(),
    counts: () => ({ queries, imports, factories }),
  };
}
test('disabled and unknown contract do zero DB/wire', async () => {
  const f = fixture();
  assert.equal((await runFullSnapshot(f.pool, {}, f.deps)).status, 'disabled');
  assert.equal((await runFullSnapshot(f.pool, { ...f.options, payloadMode: undefined }, f.deps)).status, 'blocked');
  assert.equal(
    (await runFullSnapshot(f.pool, { ...f.options, sourceFactory: { ...f.options.sourceFactory, accounting: 'unknown' } as never }, f.deps))
      .status,
    'blocked',
  );
  assert.deepEqual(f.counts(), { queries: 0, imports: 0, factories: 0 });
});
test('ready unpublished returns zero source/wire', async () => {
  const f = fixture(true);
  assert.equal((await runFullSnapshot(f.pool, f.options, f.deps)).status, 'ready-pending-publication');
  assert.deepEqual(f.counts(), { queries: 1, imports: 0, factories: 0 });
  assert.equal(f.reservations.length, 0);
});
test('transport callback only accounting, retry/fallback charged once each; safe output', async () => {
  const f = fixture();
  const r = await runFullSnapshot(f.pool, { ...f.options, maxPages: 999 }, f.deps);
  assert.equal(r.status, 'ready');
  assert.equal('secret' in r, false);
  assert.equal(r.becameCurrent, false);
  await f.wire();
  await f.wire();
  await f.wire();
  assert.deepEqual(
    f.reservations,
    [1, 2, 3].map(() => ({ scope: 'topics:upstream-requests', amount: 1, limit: 504 })),
  );
});
test('aborted caller guards before queries and wires', async () => {
  const f = fixture();
  const c = new AbortController();
  c.abort();
  assert.equal((await runFullSnapshot(f.pool, { ...f.options, signal: c.signal }, f.deps)).status, 'deferred');
  assert.equal(f.counts().queries, 0);
});
test('persistent budget denial blocks wire without raw error', async () => {
  const f = fixture();
  await runFullSnapshot(f.pool, f.options, f.deps);
  f.deps!.reserveBudget = async () => false;
  await assert.rejects(f.wire(), /topic_upstream_budget/);
});
test('lease failure safe deferred with zero import', async () => {
  const f = fixture();
  f.deps!.withJobLease = async () => {
    throw Error('secret database URI');
  };
  const r = await runFullSnapshot(f.pool, f.options, f.deps);
  assert.equal(r.status, 'deferred');
  assert.equal(JSON.stringify(r).includes('secret'), false);
  assert.equal(f.counts().imports, 0);
});
test('daily start remains one and duration/page limits are bounded', async () => {
  const f = fixture();
  f.deps!.importSnapshot = async (...args) => {
    const control = args[5]!;
    assert.ok(control.deadline! <= Date.now() + 600_000);
    assert.equal(args[4], 50);
    assert.equal(await control.beforeStart!(), true);
    return { status: 'incomplete', phase: 'policy', version: '00000000-0000-4000-8000-000000000001', total: 1, becameCurrent: false };
  };
  assert.equal((await runFullSnapshot(f.pool, { ...f.options, maxDurationMs: 9_999_999, maxPages: 999 }, f.deps)).status, 'incomplete');
  assert.deepEqual(f.reservations, [{ scope: 'topics:full-sync', amount: 1, limit: 1 }]);
});
test('caller delegates pinned active A to importer without current reread', async () => {
  const f = fixture();
  let currentCalls = 0,
    pageId = '';
  const A = '00000000-0000-4000-8000-000000000001';
  f.options.sourceFactory.create = () => ({
    current: async () => {
      currentCalls++;
      throw Error('moving B');
    },
    page: async (m) => {
      pageId = m.id;
      return {} as never;
    },
  });
  f.deps!.importSnapshot = async (_pool, source) => {
    await source.page({ id: A } as never, 0);
    return { status: 'incomplete', version: A, pages: 1, processed: 1, total: 1, stagedTerms: 1 };
  };
  const r = await runFullSnapshot(f.pool, f.options, f.deps);
  assert.equal(r.version, A);
  assert.equal(pageId, A);
  assert.equal(currentCalls, 0);
  // This mock checks delegation only; existing importer tests establish persisted-manifest resume.
});
test('deadline expires before a later transport reservation', async () => {
  const f = fixture();
  await runFullSnapshot(f.pool, { ...f.options, maxDurationMs: 100_000 }, f.deps);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200_000);
  await assert.rejects(f.wire());
  assert.equal(f.reservations.length, 0);
  vi.restoreAllMocks();
});
test('invalid numeric bounds and malformed factory fail before DB', async () => {
  const f = fixture();
  for (const n of [NaN, Infinity, 1.5, 0, -1])
    for (const key of ['maxPages', 'maxDurationMs'])
      assert.equal((await runFullSnapshot(f.pool, { ...f.options, [key]: n }, f.deps)).status, 'blocked');
  assert.equal(
    (
      await runFullSnapshot(
        f.pool,
        { ...f.options, sourceFactory: { accounting: FULL_WIRE_ACCOUNTING, inheritFullControls, create: null } as never },
        f.deps,
      )
    ).status,
    'blocked',
  );
  assert.equal(f.counts().queries, 0);
});
test('safe importer cursor and reason retained; bad ready identity rejected', async () => {
  const f = fixture();
  f.deps!.importSnapshot = async () => ({
    status: 'incomplete',
    version: '00000000-0000-4000-8000-000000000001',
    pages: 2,
    processed: 1,
    total: 1000,
    stagedTerms: 1000,
  });
  const r = await runFullSnapshot(f.pool, f.options, f.deps);
  assert.equal('nextPage' in r && r.nextPage, 2);
  assert.equal('processed' in r && r.processed, 1);
  const bad = fixture(true);
  bad.pool.query = (async () => [[{ snapshot_id: 'secret' }]]) as never;
  assert.equal((await runFullSnapshot(bad.pool, bad.options, bad.deps)).status, 'failed');
});

const hash = (x: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(x) + '\n')
    .digest('hex');
function wireFixture(total = 5001) {
  const terms = Array.from(
    { length: total },
    (_, i) =>
      ({
        id: createHash('sha256')
          .update(`部落格${String(i).padStart(5, '0')}`)
          .digest('hex'),
        label: `部落格${String(i).padStart(5, '0')}`,
        articleCount: 3,
        recentArticleCount: 3,
        noise: false,
        noEqual: false,
        firstPublishedAt: '2026-10-12T00:00:00.000Z',
        lastPublishedAt: '2026-10-12T00:00:00.000Z',
        origin: 'article-tags-mixed',
        journalistAssigned: null,
      }) as ExportTerm,
  );
  const small = Array.from({ length: Math.ceil(total / 500) }, (_, i) => terms.slice(i * 500, (i + 1) * 500)),
    groups = Array.from({ length: Math.ceil(total / 5000) }, (_, i) => terms.slice(i * 5000, (i + 1) * 5000));
  const manifest = {
    schemaVersion: 1,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    previousId: null,
    generatedAt: '2026-10-13T00:00:00.000Z',
    source: SOURCE,
    coverage: 'all-current-indexed-article-tags',
    identity: 'sha256-exact-utf8-label',
    attribution: 'fixture',
    provenance: 'fixture',
    total,
    pageSize: 500,
    pages: small.map(hash),
    sha256: createHash('sha256')
      .update(terms.map((t) => JSON.stringify(t) + '\n').join(''))
      .digest('hex'),
    changeCount: 0,
    changePages: [],
    largePages: groups.map(hash),
    opaque: { keep: true },
  } as ExportManifest & { largePages: string[]; opaque: { keep: boolean } };
  const identity = () => ({
    id: manifest.id,
    generatedAt: manifest.generatedAt,
    total: manifest.total,
    pageSize: 500,
    sha256: manifest.sha256,
  });
  const large = (index: number) => ({
    snapshot: identity(),
    entries: groups[index],
    limit: 5000,
    cursor: String(index),
    nextCursor: index + 1 < groups.length ? String(index + 1) : null,
    sha256: manifest.largePages[index],
  });
  const page = (index: number) => ({
    snapshot: identity(),
    entries: small[index],
    cursor: String(index),
    nextCursor: index + 1 < small.length ? String(index + 1) : null,
    sha256: manifest.pages[index],
  });
  return { terms, manifest, large, page };
}

for (const behavior of ['normal', 'byte-cap', 'retry'] as const)
  test(`real source wire accounting: ${behavior}`, async () => {
    const f = fixture(),
      data = wireFixture(5000);
    let wires = 0;
    const request: typeof fetch = async (raw) => {
      wires++;
      assert.equal(f.reservations.length, wires);
      const url = new URL(String(raw));
      if (behavior === 'byte-cap' && url.searchParams.get('limit') === '5000') return new Response('x'.repeat(MAX_SNAPSHOT_PAGE_BYTES + 1));
      if (behavior === 'retry' && wires === 1) return new Response('', { status: 429, headers: { 'retry-after': '1' } });
      return new Response(
        JSON.stringify(url.searchParams.get('limit') === '5000' ? data.large(0) : data.page(Number(url.searchParams.get('cursor')))),
      );
    };
    f.options.sourceFactory.create = (c) =>
      new LargeSnapshotSource(request, {
        ...c,
        enabled: true,
        largeContract: LARGE_SNAPSHOT_CONTRACT,
        origin: SOURCE,
        readServiceToken: async () => null,
        now: () => 0,
        sleep: async () => {},
      });
    f.deps!.importSnapshot = async (_p, source) => {
      for (let i = 0; i < 10; i++) await source.page(data.manifest, i);
      return { status: 'ready', version: data.manifest.id, total: 5000, becameCurrent: false, coverage: data.manifest.coverage };
    };
    assert.equal((await runFullSnapshot(f.pool, f.options, f.deps)).status, 'ready');
    assert.equal(wires, behavior === 'normal' ? 1 : behavior === 'retry' ? 2 : 11);
    assert.equal(f.reservations.length, wires);
  });
test('safe reason table, unknown is fixed, absent remains absent; cursor phase matches importer', async () => {
  for (const reason of [
    'page-byte-cap',
    'checkpoint-invalid',
    'checkpoint-continuity',
    'page-checksum',
    'page-index-gap',
    'manifest-roundtrip',
    'payload-roundtrip',
    'local-db-unavailable',
    'secret URI',
    undefined,
  ]) {
    const f = fixture();
    f.deps!.importSnapshot = async () => ({ status: 'deferred', version: null, reason: reason as string, becameCurrent: false });
    const r = await runFullSnapshot(f.pool, f.options, f.deps);
    assert.equal('reason' in r ? r.reason : undefined, reason === undefined ? undefined : reason === 'secret URI' ? 'unknown' : reason);
  }
  for (const phase of [undefined, 'checksum', 'policy']) {
    const f = fixture();
    f.deps!.importSnapshot = (async () => ({
      status: 'incomplete',
      phase,
      pages: phase === 'policy' ? undefined : 3,
      processed: phase === 'policy' ? undefined : 1,
    })) as never;
    const r = await runFullSnapshot(f.pool, f.options, f.deps);
    assert.equal('phase' in r ? r.phase : undefined, phase ?? 'scanning');
    assert.equal('nextPage' in r ? r.nextPage : undefined, phase === 'policy' ? undefined : 3);
  }
});

test('sync common controls preserve both signals, strict minima, outer clock and invalid bounds', () => {
  const outer = new AbortController(),
    nested = new AbortController(),
    now = () => new Date(0);
  const merged = inheritFullControls(
    { signal: nested.signal, maxPages: 40, maxDurationMs: 4000 },
    { signal: outer.signal, maxPages: 20, maxDurationMs: 8000, now },
  );
  assert.equal(merged.maxPages, 20);
  assert.equal(merged.maxDurationMs, 4000);
  assert.equal(merged.now, now);
  outer.abort();
  assert.equal(merged.signal?.aborted, true);
  const other = inheritFullControls({ signal: nested.signal }, { signal: new AbortController().signal });
  nested.abort();
  assert.equal(other.signal?.aborted, true);
  assert.ok(Number.isNaN(inheritFullControls({ maxPages: 4 }, { maxPages: NaN }).maxPages));
});

test('sync adapter passes actual outer abort, limits and clock to full caller', async () => {
  const c = new AbortController(),
    now = () => new Date(0);
  c.abort();
  let captured: FullSnapshotOptions | undefined;
  const spy = vi.spyOn(fullCaller, 'runFullSnapshot').mockImplementation(async (_p, o) => {
    captured = o;
    return { status: 'disabled', becameCurrent: false };
  });
  try {
    await syncVocabulary({} as Pool, {
      enabled: true,
      mode: 'full',
      signal: c.signal,
      maxPages: 2,
      maxDurationMs: 10,
      now,
      full: { ...explicit, maxPages: 8, maxDurationMs: 100 },
    });
    assert.equal(captured?.signal?.aborted, true);
    assert.equal(captured?.maxPages, 2);
    assert.equal(captured?.maxDurationMs, 10);
    assert.equal(captured?.now, now);
  } finally {
    spy.mockRestore();
  }
});

test('CLI full default admission refuses before config/DB with safe output', () => {
  const env = { ...process.env, BLOG_VOCABULARY_FULL_STAGE_ADMITTED: 'false', BLOG_DB_URL: 'not-a-db-url' };
  const run = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      'tools/topics-once.ts',
      '--sync',
      '--full',
      '--source=large5000',
      '--payload=single-copy-v1',
      '--contract=tag-a89908a-large5000-compact-v1',
    ],
    { cwd: process.cwd(), env, encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { status: 'disabled', reason: 'full-stage-not-admitted', becameCurrent: false });
  assert.equal(run.stderr, '');
});
