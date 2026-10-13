import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { CONTENT_VERSION } from '../content/contracts.ts';
import { CLEANUP_VERSION } from './matching-body.ts';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { runStagedScanBatch, startStagedScan } from './staged-scan-v2.ts';
import { advanceScanV2, parseScanV2, startScanV2 } from './staged-scan-v2-contract.ts';

const manifest = JSON.stringify({ coverage: 'all-current-indexed-article-tags' });
const pins = {
  target: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  manifestSha256: createHash('sha256').update(manifest).digest('hex'),
  policyVersion: POLICY_VERSION,
  selectionId: 'selection-v1',
  matcherVersion: MATCHER_VERSION,
  cleanupVersion: CLEANUP_VERSION,
};
const now = () => new Date('2026-10-13T00:00:00.000Z'),
  id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function db(
  change: {
    publicTarget?: boolean;
    empty?: boolean;
    terminal?: boolean;
    freshStatus?: string;
    blogUrl?: string;
    freshBlogUrl?: string;
    postUrl?: string;
    body?: Record<string, unknown>;
    failCommit?: boolean;
  } = {},
) {
  let state = startScanV2(pins, change.terminal ? 0 : 1, now().toISOString()),
    blogReads = 0,
    acquires = 0,
    commits = 0,
    releases = 0,
    destroys = 0;
  const queries: string[] = [],
    writes: { q: string; p: unknown[] }[] = [];
  const c = {
    query: vi.fn(async (q: string, _p: unknown[] = []) => {
      queries.push(q);
      if (q.includes('GET_LOCK') || q.includes('IS_USED_LOCK')) return [[{ held: 1 }]];
      if (q.includes('FROM topic_snapshots'))
        return [
          [
            {
              manifest,
              status: 'ready',
              import_status: 'ready',
              payload_mode: 'single-copy-v1',
              policy_status: 'ready',
              selection_id: pins.selectionId,
              policy_version: POLICY_VERSION,
              active_terms: 0,
            },
          ],
        ];
      if (q.includes('FROM topic_current')) return [change.publicTarget ? [{ source: 'test' }] : []];
      if (q.includes('FROM topic_staged_scan_owner')) return [[{ run_id: q.includes('FOR UPDATE') ? null : id }]];
      if (q.includes('FROM topic_staged_scan_runs')) return [[{ state_json: JSON.stringify(state) }]];
      if (q.includes('FROM topic_canonical_terms')) return [[]];
      if (q.includes('FROM posts ORDER BY')) return [change.empty ? [] : [{ id: 1 }]];
      if (q.includes('SELECT id FROM posts WHERE')) return [[{ id: 1 }]];
      if (q.includes('SELECT blog_id FROM posts')) return [[{ blog_id: 1 }]];
      if (q.includes('FROM blogs'))
        return [
          [
            {
              id: 1,
              url:
                blogReads === 0
                  ? (change.blogUrl ?? 'https://x.example/')
                  : (change.freshBlogUrl ?? change.blogUrl ?? 'https://x.example/'),
              status: ++blogReads === 1 ? 'verified' : (change.freshStatus ?? 'verified'),
            },
          ],
        ];
      if (q.includes('SELECT id,blog_id,url,CASE'))
        return [
          [
            {
              id: 1,
              blog_id: 1,
              url: change.postUrl ?? 'https://x.example/post',
              title: 'safe',
              summary: null,
              content_hash: 'a'.repeat(64),
              published_at: null,
            },
          ],
        ];
      if (q.includes('FROM content_post_bodies')) return [change.body ? [change.body] : []];
      return [[]];
    }),
    execute: vi.fn(async (q: string, p: unknown[] = []) => {
      writes.push({ q, p });
      if (q.includes('SET state_json')) state = parseScanV2(JSON.parse(p[0] as string));
      return [{ affectedRows: 1 }];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {
      if (change.failCommit) throw Error('secret');
      commits++;
    }),
    rollback: vi.fn(async () => {}),
    release: () => {
      releases++;
    },
    destroy: () => {
      destroys++;
    },
  };
  const pool = {
    pool: { config: { connectionLimit: 2 } },
    getConnection: async () => {
      acquires++;
      return c;
    },
  } as unknown as Pool;
  return { pool, c, queries, writes, stats: () => ({ state, acquires, commits, releases, destroys }) };
}
describe('staged as-of DAO, not publication', () => {
  it('default disabled is zero connection; unknown pool1 fails closed', async () => {
    const f = db();
    expect(await startStagedScan(f.pool, pins)).toMatchObject({ status: 'disabled' });
    expect(f.stats().acquires).toBe(0);
    (f.pool as never as { pool: { config: { connectionLimit: number } } }).pool.config.connectionLimit = 1;
    expect(await startStagedScan(f.pool, pins, { enabled: true })).toMatchObject({ reason: 'pool-size' });
  });
  it('start pins target, stores generation-local state and no current/history mutation', async () => {
    const f = db();
    expect(await startStagedScan(f.pool, pins, { enabled: true, now })).toMatchObject({ status: 'scanning', canVerify: false });
    expect(f.stats().acquires).toBe(1);
    expect(f.writes.every((x) => !x.q.includes('topic_current') && !x.q.includes('topic_article_evidence'))).toBe(true);
  });
  it('public target blocks before any target write', async () => {
    const f = db({ publicTarget: true });
    expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now })).toMatchObject({
      reason: 'target-public',
    });
    expect(f.writes.length).toBe(0);
  });
  it('NULL date public/title-only zero result remains as-of, one connection and bounded SQL', async () => {
    const f = db();
    expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now })).toMatchObject({
      status: 'scanned-as-of',
      eligible: 1,
      titleOnly: 1,
      zeroHit: 1,
      canVerify: false,
    });
    expect(f.stats().acquires).toBe(1);
    expect(f.queries.some((q) => q.includes('COUNT('))).toBe(false);
    expect(f.writes.some((x) => x.q.includes('INSERT INTO topic_post_indexes_v3'))).toBe(true);
  });
  it('fresh rejected/withdrawn removes target evidence but never indexes', async () => {
    const f = db({ freshStatus: 'rejected' });
    expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now })).toMatchObject({
      skipped: 1,
      eligible: 0,
    });
    expect(f.writes.some((x) => x.q.includes('DELETE FROM topic_matches_v3'))).toBe(true);
    expect(f.writes.some((x) => x.q.includes('INSERT INTO topic_post_indexes_v3'))).toBe(false);
  });
  it('oversize/truncated body capped rather than complete zero', async () => {
    const f = db({
      body: {
        post_id: 1,
        body_blog_id: 1,
        body_status: 'ok',
        source_kind: 'article-html',
        adapter_id: 'generic-public',
        adapter_version: CONTENT_VERSION,
        article_url: 'https://x.example/post',
        source_url: 'https://x.example/post',
        obtained_at: now(),
        text_bytes: 500001,
        html_bytes: 0,
        truncated: 1,
        completeness: 'full',
      },
    });
    expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now })).toMatchObject({
      capped: 1,
      zeroHit: 0,
    });
    expect(f.writes.some((x) => x.q.includes('INSERT INTO topic_post_indexes_v3'))).toBe(false);
    expect(f.queries.some((q) => q.includes('CASE WHEN') && q.includes('OCTET_LENGTH'))).toBe(true);
  });
  it('strict cursor conflict no writes; commit errors deferred, safe cleanup', async () => {
    const f = db();
    expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 1 }, { enabled: true, now })).toMatchObject({
      reason: 'cursor-conflict',
    });
    expect(f.writes.length).toBe(0);
    const g = db({ failCommit: true });
    const r = await startStagedScan(g.pool, pins, { enabled: true, now });
    expect(r).toMatchObject({ status: 'deferred', reason: 'local-db-unavailable' });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(g.c.rollback).toHaveBeenCalled();
    expect(g.stats().releases).toBe(1);
  });
  it('pending connection retains admission until late settle, late connection noSQL/release', async () => {
    vi.useFakeTimers();
    let resolve!: (c: unknown) => void;
    const c = { release: vi.fn(), query: vi.fn() };
    const pool = {
      pool: { config: { connectionLimit: 2 } },
      getConnection: () =>
        new Promise((r) => {
          resolve = r;
        }),
    } as unknown as Pool;
    const p = startStagedScan(pool, pins, { enabled: true, maxDurationMs: 10 });
    await vi.advanceTimersByTimeAsync(11);
    expect(await p).toMatchObject({ reason: 'deadline' });
    expect(await startStagedScan(pool, pins, { enabled: true })).toMatchObject({ status: 'busy' });
    resolve(c);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.release).toHaveBeenCalledOnce();
    expect(c.query).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it('scan-v2 does not depend on predecessor; v1 unknown fields still reject; serialization bounded', () => {
    const s = startScanV2(pins, 2, now().toISOString());
    expect(() => parseScanV2({ ...s, expectedCurrent: null })).toThrow();
    const next = advanceScanV2(
      s,
      0,
      { postId: 1, publicBefore: true, publicFresh: true, ownerFresh: true, dateFresh: true, revisionFresh: true, result: 'zero' },
      false,
      true,
    );
    expect(next.titleOnly).toBe(1);
    expect(next.canVerify).toBe(false);
    expect(JSON.stringify(next).length).toBeLessThan(2048);
  });
});

it('current publication URL owner and fresh URL change reject old article/body', async () => {
  for (const change of [
    { blogUrl: 'https://other.example/' },
    { freshBlogUrl: 'https://x.example/new-owner/' },
    { postUrl: 'https://other.example/post' },
  ]) {
    const f = db(change);
    const r = await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now });
    expect(r).toMatchObject({ eligible: 0, skipped: 1 });
    expect(f.writes.some((x) => x.q.includes('INSERT INTO topic_post_indexes_v3'))).toBe(false);
  }
});
const fullBody = (changes: Record<string, unknown> = {}) => ({
  post_id: 1,
  body_blog_id: 1,
  body_status: 'ok',
  source_kind: 'rss-content',
  adapter_id: 'generic-public',
  adapter_version: CONTENT_VERSION,
  article_url: 'https://x.example/post',
  source_url: 'https://x.example/feed/',
  obtained_at: now(),
  text_bytes: 12,
  html_bytes: 0,
  body_text: 'safe content',
  body_html: null,
  truncated: 0,
  completeness: 'full',
  image_only: 0,
  body_hash: 'b'.repeat(64),
  revision: 1,
  ...changes,
});
it('same publication RSS and proven WP API accepted; canonical tracking retained meaningful IDs', async () => {
  for (const b of [
    fullBody(),
    fullBody({
      source_kind: 'wordpress-api',
      adapter_id: 'wordpress-public',
      source_url: 'https://x.example/wp-json/wp/v2/posts?slug=post',
    }),
    fullBody({ article_url: 'https://x.example/post?utm_source=fixture#part' }),
  ]) {
    const f = db({ body: b });
    expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now })).toMatchObject({
      eligible: 1,
      titleOnly: 0,
    });
  }
  for (const b of [
    fullBody({ article_url: 'https://x.example/post?id=2' }),
    fullBody({ source_url: 'https://foreign.example/feed' }),
    fullBody({ source_kind: 'wordpress-api', adapter_id: 'unknown', source_url: 'https://x.example/api/private' }),
  ]) {
    const f = db({ body: b });
    expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now })).toMatchObject({ titleOnly: 1 });
  }
});
it('abort pending acquisition returns promptly while retained slot waits for late release', async () => {
  let resolve!: (c: unknown) => void;
  let calls = 0;
  const c = { release: vi.fn(), query: vi.fn() },
    controller = new AbortController();
  const pool = {
    pool: { config: { connectionLimit: 2 } },
    getConnection: () => {
      calls++;
      return new Promise((r) => {
        resolve = r;
      });
    },
  } as unknown as Pool;
  const pending = startStagedScan(pool, pins, { enabled: true, signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  expect(await pending).toMatchObject({ reason: 'deadline' });
  expect(await startStagedScan(pool, pins, { enabled: true })).toMatchObject({ status: 'busy' });
  resolve(c);
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toBe(1);
  expect(c.release).toHaveBeenCalledOnce();
  expect(c.query).not.toHaveBeenCalled();
});
it('synchronous acquire throw does not strand admission forever', async () => {
  let calls = 0;
  const pool = {
    pool: { config: { connectionLimit: 2 } },
    getConnection: () => {
      calls++;
      throw Error('secret');
    },
  } as unknown as Pool;
  expect(await startStagedScan(pool, pins, { enabled: true })).toMatchObject({ reason: 'local-db-unavailable' });
  await Promise.resolve();
  await Promise.resolve();
  await startStagedScan(pool, pins, { enabled: true });
  expect(calls).toBe(2);
});

it('late release throwing destroys only owned connection and clears admission without SQL', async () => {
  let resolve!: (c: unknown) => void;
  let calls = 0;
  const c = {
      release: vi.fn(() => {
        throw Error('release');
      }),
      destroy: vi.fn(),
      query: vi.fn(),
    },
    controller = new AbortController();
  const pool = {
    pool: { config: { connectionLimit: 2 } },
    getConnection: () => {
      calls++;
      if (calls > 1) throw Error('no DB');
      return new Promise((r) => {
        resolve = r;
      });
    },
  } as unknown as Pool;
  const pending = startStagedScan(pool, pins, { enabled: true, signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await pending;
  resolve(c);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(c.release).toHaveBeenCalledOnce();
  expect(c.destroy).toHaveBeenCalledOnce();
  expect(c.query).not.toHaveBeenCalled();
  expect(await startStagedScan(pool, pins, { enabled: true })).toMatchObject({ reason: 'local-db-unavailable' });
  expect(calls).toBe(2);
});

it('empty terminal start keeps receipt but does not bind active owner', async () => {
  const f = db({ empty: true });
  expect(await startStagedScan(f.pool, pins, { enabled: true, now })).toMatchObject({ status: 'scanned-as-of', highWater: 0 });
  const owner = f.writes.find((x) => x.q.startsWith('UPDATE topic_staged_scan_owner SET run_id'));
  expect(owner?.p[0]).toBe(null);
  expect(f.writes.some((x) => x.q.startsWith('INSERT INTO topic_staged_scan_runs'))).toBe(true);
});

it('terminal recovery releases only exact own owner, never another run', async () => {
  const f = db({ terminal: true });
  expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now })).toMatchObject({
    status: 'scanned-as-of',
  });
  const w = f.writes.find((x) => x.q.includes('SET run_id=NULL'));
  expect(w?.q).toContain('WHERE source=? AND run_id=?');
  expect(w?.p[1]).toBe(id);
  expect(f.writes.some((x) => x.q.includes('topic_matches'))).toBe(false);
});

// Proof mode mocks use actual approved aliases/tuples; they do not execute MariaDB semantics.
it('proof enrollment disabled zeroDB; nonempty target and unknown mode block', async () => {
  const { enrollStagedScanProof } = await import('./staged-scan-v2.ts'),
    { STAGED_PROOF_VERSION } = await import('./staged-scan-proof.ts');
  const f = db();
  expect(await enrollStagedScanProof(f.pool, pins)).toMatchObject({ status: 'disabled' });
  expect(f.stats().acquires).toBe(0);
  expect(await startStagedScan(f.pool, pins, { enabled: true, proofMode: 'unknown' as never })).toMatchObject({ reason: 'proof-mode' });
  const proper = { ...pins, selectionId: 'a'.repeat(64) },
    base = f.c.query.getMockImplementation()!;
  f.c.query.mockImplementation(async (q, p) => {
    if (q.includes('FROM topic_staged_scan_owner')) return [[]];
    if (q.includes('FROM topic_generation_proof_contracts')) return [[]];
    if (q.includes('FROM topic_snapshots')) {
      const r = await base(q, p);
      (r[0][0] as Record<string, unknown>).selection_id = proper.selectionId;
      return r;
    }
    if (q.includes('SELECT post_id FROM topic_post_indexes_v3')) return [[{ post_id: 1 }]];
    return base(q, p);
  });
  expect(await enrollStagedScanProof(f.pool, proper, { enabled: true, proofMode: STAGED_PROOF_VERSION, now })).toMatchObject({
    status: 'blocked',
    reason: 'proof-target-nonempty',
  });
});
it('enrolled target rejects legacy mode and missing marker rejects explicit mode', async () => {
  const { STAGED_PROOF_VERSION } = await import('./staged-scan-proof.ts');
  const f = db(),
    base = f.c.query.getMockImplementation()!;
  f.c.query.mockImplementation(async (q, p) =>
    q.includes('FROM topic_generation_proof_contracts') ? [[{ proof_version: 'enrolled' }]] : base(q, p),
  );
  expect(await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, now })).toMatchObject({
    status: 'blocked',
    reason: 'proof-mode-required',
  });
  const g = db();
  expect(
    await runStagedScanBatch(g.pool, { runId: id, expectedCursor: 0 }, { enabled: true, proofMode: STAGED_PROOF_VERSION, now }),
  ).toMatchObject({ status: 'blocked', reason: 'missing-proof-marker' });
});
it('proof scan reads matcher input and fingerprints together; writes proof in index+cursor transaction', async () => {
  const { STAGED_PROOF_VERSION } = await import('./staged-scan-proof.ts'),
    { TOPIC_FINGERPRINT_VERSION } = await import('./provenance-fingerprint-sql.ts');
  const f = db(),
    base = f.c.query.getMockImplementation()!,
    selection = 'a'.repeat(64);
  f.c.query.mockImplementation(async (q, p) => {
    if (q.includes('FROM topic_generation_proof_contracts'))
      return [
        [
          {
            proof_version: STAGED_PROOF_VERSION,
            fingerprint_version: TOPIC_FINGERPRINT_VERSION,
            status: 'staging',
            scan_contract_version: 'scan-v2',
            manifest_sha256: pins.manifestSha256,
            policy_version: pins.policyVersion,
            selection_id: selection,
            matcher_version: pins.matcherVersion,
            cleanup_version: pins.cleanupVersion,
          },
        ],
      ];
    if (q.includes('FROM topic_staged_scan_runs')) {
      const s = JSON.parse(String((await base(q, p))[0][0].state_json));
      s.selectionId = selection;
      return [[{ state_json: JSON.stringify(s) }]];
    }
    if (q.includes('FROM topic_snapshots')) {
      const r = await base(q, p);
      r[0][0].selection_id = selection;
      return r;
    }
    if (q.includes('metadata_fingerprint')) {
      f.queries.push(q);
      return [
        [
          {
            id: 1,
            blog_id: 1,
            url: 'https://x.example/post',
            title: 'safe',
            title_bytes: 4,
            summary_hash: null,
            content_hash: 'b'.repeat(64),
            published_at: null,
            blog_url: 'https://x.example/',
            blog_status: 'verified',
            blog_owner_id: 1,
            post_id: null,
            body_blog_id: null,
            metadata_fingerprint: 'c'.repeat(64),
            body_fingerprint: 'd'.repeat(64),
          },
        ],
      ];
    }
    return base(q, p);
  });
  const r = await runStagedScanBatch(f.pool, { runId: id, expectedCursor: 0 }, { enabled: true, proofMode: STAGED_PROOF_VERSION, now });
  expect(r).toMatchObject({ status: 'scanned-as-of', titleOnly: 1, canVerify: false });
  const proof = f.writes.find((x) => x.q.startsWith('INSERT INTO topic_index_proofs'));
  expect(proof?.p[9]).toBe('title-only');
  expect(proof?.p[11]).toBe(null);
  expect(
    f.queries
      .filter((q) => q.includes('metadata_fingerprint'))
      .every((q) => q.includes('CASE WHEN') && q.includes('body_text') && q.includes('topic-post-fingerprint-v1')),
  ).toBe(true);
  expect(f.queries.find((q) => q.includes('metadata_fingerprint') && q.includes('FOR UPDATE'))).toBeDefined();
  expect(f.queries.some((q) => q.includes('SELECT source FROM topic_current') && q.includes('FOR UPDATE'))).toBe(true);
  const deleteProof = f.writes.findIndex((x) => x.q.startsWith('DELETE FROM topic_index_proofs')),
    deleteIndex = f.writes.findIndex((x) => x.q.startsWith('DELETE FROM topic_post_indexes_v3'));
  expect(deleteProof).toBeLessThan(deleteIndex);
  const insertProof = f.writes.findIndex((x) => x.q.startsWith('INSERT INTO topic_index_proofs')),
    stateUpdate = f.writes.findIndex((x) => x.q.includes('SET state_json'));
  expect(insertProof).toBeLessThan(stateUpdate);
});
