import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { CLEANUP_VERSION } from './matching-body.ts';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { TOPIC_FINGERPRINT_VERSION } from './provenance-fingerprint-sql.ts';
import { type InspectorInput, inspectStagedProof, stagedProofInspectorQueryForTests } from './staged-proof-inspector.ts';
import { STAGED_PROOF_VERSION } from './staged-scan-proof.ts';

const input: InspectorInput = {
  enabled: true,
  target: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  postIds: [2, 1],
  pins: {
    manifestSha256: 'a'.repeat(64),
    policyVersion: POLICY_VERSION,
    selectionId: 'b'.repeat(64),
    matcherVersion: MATCHER_VERSION,
    cleanupVersion: CLEANUP_VERSION,
    proofVersion: STAGED_PROOF_VERSION,
    fingerprintVersion: TOPIC_FINGERPRINT_VERSION,
  },
};
const rows = () => [
  { postId: 1, generationValid: 1, titleFresh: 1, bodyFresh: 0 },
  { postId: 2, generationValid: 1, titleFresh: 1, bodyFresh: 1 },
];
function db(returned: unknown = rows()) {
  const c = { query: vi.fn(async () => [returned]), release: vi.fn(), destroy: vi.fn() };
  const pool = { pool: { config: { connectionLimit: 2 } }, getConnection: vi.fn(async () => c) } as unknown as Pool;
  return { pool, c };
}
describe('private bounded proof inspector, no publicB0 claim', () => {
  it('default disabled zeroSQL and no capabilities/hash/body/URLs/terms in DTO', async () => {
    const f = db();
    expect(await inspectStagedProof(f.pool)).toEqual({ status: 'disabled', items: [] });
    expect(f.pool.getConnection).not.toHaveBeenCalled();
    const out = await inspectStagedProof(f.pool, input);
    expect(out).toEqual({
      status: 'ok',
      items: [
        { postId: 2, titleFresh: true, bodyFresh: true, reason: 'fresh' },
        { postId: 1, titleFresh: true, bodyFresh: false, reason: 'title-only-or-body-stale' },
      ],
    });
    expect(f.c.query).toHaveBeenCalledOnce();
    expect(JSON.stringify(out)).not.toMatch(/fingerprint|hash|body_text|url|term|canVerify|publish/);
  });
  it('uses native signal brand/getter/event methods despite hostile own shadows; next read remains fresh', async () => {
    const f = db();
    const controller = new AbortController();
    const shadow = vi.fn(() => {
      throw Error('private-shadow');
    });
    Object.defineProperties(controller.signal, {
      aborted: { get: shadow },
      addEventListener: { value: shadow },
      removeEventListener: { value: shadow },
    });
    expect((await inspectStagedProof(f.pool, input, { signal: controller.signal })).status).toBe('ok');
    expect(shadow).not.toHaveBeenCalled();
    controller.abort();
    expect(await inspectStagedProof(f.pool, input, { signal: controller.signal })).toEqual({
      status: 'deferred',
      reason: 'deadline',
      items: [],
    });
    expect((await inspectStagedProof(f.pool, input)).status).toBe('ok');
    expect(f.c.release).toHaveBeenCalledTimes(2);
  });
  it('rejects unbranded signal before admission and leaves later C independent', async () => {
    const f = db();
    const fake = Object.create(AbortSignal.prototype) as AbortSignal;
    expect(await inspectStagedProof(f.pool, input, { signal: fake })).toEqual({ status: 'blocked', reason: 'opaque-invalid', items: [] });
    expect(f.pool.getConnection).not.toHaveBeenCalled();
    expect((await inspectStagedProof(f.pool, input)).status).toBe('ok');
    const query = stagedProofInspectorQueryForTests(input).sql;
    for (const field of ['body_fingerprint', 'body_content_hash', 'body_revision', 'body_obtained_at', 'source_kind'])
      expect(query).toContain(`q.${field} IS NULL`);
    expect(query).toContain('i.body_hash IS NULL');
  });
  it('strict input IDs/versions/unknown/accessors/proxy checked without invoking', async () => {
    const f = db();
    let calls = 0;
    for (const bad of [
      { ...input, postIds: [] },
      { ...input, postIds: Array.from({ length: 51 }, (_, i) => i + 1) },
      { ...input, postIds: [1, 1] },
      { ...input, postIds: [NaN] },
      { ...input, target: 'x OR 1=1' },
      { ...input, pins: { ...input.pins, proofVersion: 'unknown' } },
      { ...input, rawbody: 'private' },
      Object.defineProperty({ ...input }, 'target', {
        get() {
          calls++;
          return input.target;
        },
      }),
      new Proxy(input, {
        getPrototypeOf() {
          calls++;
          throw Error('proxy');
        },
      }),
    ])
      expect(await inspectStagedProof(f.pool, bad)).toMatchObject({ status: 'blocked', reason: 'opaque-invalid' });
    expect(calls).toBe(0);
    expect(f.pool.getConnection).not.toHaveBeenCalled();
  });
  it('sparse/accessor IDs and rawcontrol coercion rejected without side effects', async () => {
    const f = db();
    let calls = 0;
    const ids = Object.defineProperty([1], '0', {
      get() {
        calls++;
        return 1;
      },
    });
    expect(await inspectStagedProof(f.pool, { ...input, postIds: ids })).toMatchObject({ status: 'blocked' });
    expect(
      await inspectStagedProof(f.pool, input, {
        maxDurationMs: {
          valueOf() {
            calls++;
            return 1;
          },
        } as never,
      }),
    ).toMatchObject({ status: 'blocked' });
    expect(calls).toBe(0);
  });
  it('SQL has fixed aliases, bounded derivedgeneration, no rawbody/URL projection and exact parameter count', () => {
    const q = stagedProofInspectorQueryForTests(input);
    expect(q.sql.match(/\?/g)?.length).toBe(q.values.length);
    expect(q.sql).toContain('LIMIT 1');
    expect(q.sql).toContain('4194304');
    expect(q.sql).toContain('NOT EXISTS(SELECT 1 FROM topic_current WHERE snapshot_id=t.id)');
    expect(q.sql).toContain('UTC_TIMESTAMP(6)');
    expect(q.sql).toContain('$.cleanupVersion');
    expect(q.sql).toContain('cb.post_id IS NOT NULL');
    expect(q.sql).toContain('q.body_fingerprint IS NOT NULL');
    expect(q.sql).not.toContain('FOR UPDATE');
    expect(q.sql).not.toMatch(/GET_LOCK|UPDATE |DELETE |INSERT /);
    expect(q.values).toContain(input.target);
    expect(q.values.slice(-8)).toEqual([
      input.target,
      input.pins.proofVersion,
      input.pins.fingerprintVersion,
      input.pins.policyVersion,
      input.pins.selectionId,
      input.pins.matcherVersion,
      input.pins.cleanupVersion,
      input.pins.manifestSha256,
    ]);
  });
  it('global invalid returns blocked empty, individual masked uniformly unavailable', async () => {
    const f = db(rows().map((r) => ({ ...r, generationValid: 0 })));
    expect(await inspectStagedProof(f.pool, input)).toEqual({ status: 'blocked', reason: 'opaque-invalid', items: [] });
    const g = db(rows().map((r) => ({ ...r, titleFresh: 0, bodyFresh: 0 })));
    expect((await inspectStagedProof(g.pool, input)).items.every((r) => r.reason === 'unavailable')).toBe(true);
  });
  it('row count/shape/IDs/bytes/getters cannot return partial results', async () => {
    let calls = 0;
    for (const raw of [
      [...rows(), rows()[0]],
      [rows()[0]],
      rows().map((r) => ({ ...r, url: 'secret'.repeat(20000) })),
      [{ ...rows()[0], postId: 99 }, rows()[1]],
      [rows()[0], rows()[0]],
      rows().map((r) => ({ ...r, titleFresh: 0, bodyFresh: 1 })),
      [
        Object.defineProperty({ ...rows()[0] }, 'titleFresh', {
          get() {
            calls++;
            return 1;
          },
        }),
        rows()[1],
      ],
    ]) {
      const f = db(raw);
      expect(await inspectStagedProof(f.pool, input)).toMatchObject({ status: 'blocked', items: [] });
    }
    expect(calls).toBe(0);
  });
  it('driver errors never leak message and owned connection destroyed', async () => {
    const f = db();
    f.c.query.mockRejectedValue(Error('SECRET_SQL_BODY_PASSWORD'));
    const out = await inspectStagedProof(f.pool, input);
    expect(out).toEqual({ status: 'deferred', reason: 'local-db-unavailable', items: [] });
    expect(JSON.stringify(out)).not.toContain('SECRET');
    expect(f.c.destroy).toHaveBeenCalledOnce();
  });
  it('samepool A pending → mutation → B busy → A ends → C independent fresh, not B0 concurrent success', async () => {
    const f = db();
    let seen!: () => void;
    const observed = new Promise<void>((r) => {
      seen = r;
    });
    let release!: (v: unknown[]) => void;
    f.c.query.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
          seen();
        }),
    );
    const A = inspectStagedProof(f.pool, input);
    await observed;
    const B = await inspectStagedProof(f.pool, input);
    expect(B).toEqual({ status: 'busy', items: [] });
    release([rows()]);
    expect((await A).status).toBe('ok');
    f.c.query.mockResolvedValueOnce([rows().map((r) => ({ ...r, titleFresh: 0, bodyFresh: 0 }))]);
    const C = await inspectStagedProof(f.pool, input);
    expect(C.items.every((x) => !x.titleFresh)).toBe(true);
    expect(f.c.query).toHaveBeenCalledTimes(2);
  });
  it('pending acquisition abort returns promptly, retains slot till late release, no lateSQL', async () => {
    let release!: (v: unknown) => void;
    const f = db(),
      abort = new AbortController();
    (f.pool.getConnection as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const A = inspectStagedProof(f.pool, input, { signal: abort.signal });
    await Promise.resolve();
    abort.abort();
    expect(await A).toMatchObject({ status: 'deferred', reason: 'deadline' });
    expect(await inspectStagedProof(f.pool, input)).toMatchObject({ status: 'busy' });
    release(f.c);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect(f.c.query).not.toHaveBeenCalled();
    expect(f.c.release).toHaveBeenCalledOnce();
  });
  it('read deadline destroys onlyownedc and retains admission until uncancellable query settles', async () => {
    vi.useFakeTimers();
    const f = db();
    let release!: (v: unknown[]) => void;
    f.c.query.mockImplementationOnce(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    const A = inspectStagedProof(f.pool, input, { maxDurationMs: 5 });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(6);
    expect(await A).toMatchObject({ reason: 'deadline' });
    expect(f.c.destroy).toHaveBeenCalledOnce();
    expect(await inspectStagedProof(f.pool, input)).toMatchObject({ status: 'busy' });
    release([rows()]);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    expect((await inspectStagedProof(f.pool, input)).status).toBe('ok');
    vi.useRealTimers();
  });
});
