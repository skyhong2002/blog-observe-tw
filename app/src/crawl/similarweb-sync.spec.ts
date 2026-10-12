import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import type { SimilarWebResult, TagRequestKind, TagSimilarSitesClient, TagSimilarSitesPayload } from './similarweb.ts';
import {
  candidateObservation,
  cooldownUntil,
  kindsToSubmit,
  mysqlSimilarwebStore,
  publicTagEvidence,
  SIMILARWEB_POLL_MS,
  type SyncDomain,
  type SyncStore,
  submissionReservation,
  syncSimilarweb,
  taipeiBudgetDay,
} from './similarweb-sync.ts';

const NOW = new Date('2026-10-12T12:00:00Z');
const DOMAIN = 'writer.net';
const payload = (domain = DOMAIN): TagSimilarSitesPayload => ({
  domain,
  source: 'similarweb-extension',
  fetchedAt: NOW.toISOString(),
  requests: [{ kind: 'similar_sites', status: 'ok', requestedAt: NOW.toISOString(), attempts: 1, nextAttemptAt: null }],
  traffic: { monthly: [{ month: '2026-09', visits: 123 }], globalRank: null, countryRank: null, category: null, topCountries: [] },
  similarSites: ['other-writer.net'],
});
const ready = (domain = DOMAIN): SimilarWebResult => ({
  enabled: true,
  domain,
  status: 'ready',
  candidates: ['other-writer.net'],
  fetchedAt: NOW.toISOString(),
  sourceEvidence: payload(domain),
});
const state = (domain = DOMAIN): SyncDomain => ({ domain, submittedKinds: {}, lastResultFetchedAt: null, lastAppliedFingerprint: null });
const noRequest = (domain = DOMAIN): SimilarWebResult => ({ enabled: true, domain, status: 'not-requested', candidates: [] });
const nullPool = null as unknown as Pool;

/** Durable in-memory backend, shared across manager invocations (including restarts). */
class MemoryStore implements SyncStore {
  held = false;
  nextRound = 0;
  blockedUntil = 0;
  used = 0;
  day = taipeiBudgetDay(NOW);
  approved = [DOMAIN];
  states = new Map<string, SyncDomain>();
  nextPoll = new Map<string, number>();
  records: SimilarWebResult[] = [];
  async acquire() {
    if (this.held) return false;
    this.held = true;
    return true;
  }
  async release() {
    this.held = false;
  }
  async beginRound(now: Date) {
    if (now.getTime() < Math.max(this.nextRound, this.blockedUntil)) return false;
    this.nextRound = now.getTime() + SIMILARWEB_POLL_MS;
    return true;
  }
  async verifiedDomains(domains: string[]) {
    return this.approved.filter((d) => domains.includes(d));
  }
  async reservePoll(domain: string, now: Date) {
    if ((this.nextPoll.get(domain) ?? 0) > now.getTime()) return null;
    this.nextPoll.set(domain, now.getTime() + SIMILARWEB_POLL_MS);
    const current = this.states.get(domain) ?? state(domain);
    this.states.set(domain, current);
    return current;
  }
  async reserveSubmission(domain: string, kind: TagRequestKind, now: Date) {
    const current = this.states.get(domain) ?? state(domain);
    const reserved = submissionReservation(
      { budgetDay: this.day, submittedCount: this.used, cooldownUntil: new Date(this.blockedUntil) },
      current.submittedKinds,
      kind,
      now,
    );
    if (!reserved) return false;
    this.day = reserved.budgetDay;
    this.used = reserved.submittedCount;
    current.submittedKinds = reserved.submittedKinds;
    this.states.set(domain, current);
    return true;
  }
  async recordResult(_domain: string, result: SimilarWebResult) {
    this.records.push(result);
    return 0;
  }
  async cooldown(until: Date) {
    this.blockedUntil = Math.max(this.blockedUntil, until.getTime());
  }
}
const client = (): TagSimilarSitesClient => ({
  getResult: vi.fn(async (domain: string): Promise<SimilarWebResult> => noRequest(domain)),
  submit: vi.fn(async (domain: string): Promise<SimilarWebResult> => ({ enabled: true, domain, status: 'pending', candidates: [] })),
});

describe('Similarweb durable decisions', () => {
  it('reserves at most 30 POSTs, counts kinds individually and resets only at Taipei midnight', () => {
    const before = new Date('2026-10-12T15:59:59Z'),
      after = new Date('2026-10-12T16:00:00Z');
    let control = { budgetDay: taipeiBudgetDay(before), submittedCount: 0, cooldownUntil: null };
    for (let i = 0; i < 30; i++) {
      const r = submissionReservation(control, {}, 'traffic', before);
      expect(r).not.toBeNull();
      control = { ...control, submittedCount: r!.submittedCount };
    }
    expect(submissionReservation(control, {}, 'similar_sites', before)).toBeNull();
    expect(submissionReservation(control, {}, 'similar_sites', after)).toMatchObject({ budgetDay: '2026-10-13', submittedCount: 1 });
    expect(submissionReservation({ ...control, cooldownUntil: new Date('2026-10-13T00:00:00Z') }, {}, 'traffic', after)).toBeNull();
    expect(submissionReservation({ ...control, submittedCount: 0 }, { traffic: before.toISOString() }, 'traffic', after)).toBeNull();
    expect(submissionReservation({ ...control, submittedCount: 0 }, { traffic: 'corrupt' }, 'traffic', after)).toBeNull();
  });
  it('does not resubmit pending/no-data work or reservations younger than 30 days', () => {
    for (const status of ['pending', 'no-data'] as const) {
      const r = ready();
      r.status = status;
      r.sourceEvidence!.requests[0].status = status;
      // traffic is absent, so only its first submission is needed.
      expect(kindsToSubmit(state(), r, NOW)).toEqual(['traffic']);
    }
    const old = new Date(NOW.getTime() - 31 * 86400000).toISOString();
    const r = ready();
    r.fetchedAt = old;
    r.sourceEvidence!.fetchedAt = old;
    r.sourceEvidence!.requests[0].requestedAt = old;
    expect(kindsToSubmit(state(), r, NOW)).toEqual(['traffic', 'similar_sites']);
    expect(
      kindsToSubmit({ ...state(), submittedKinds: { traffic: NOW.toISOString(), similar_sites: NOW.toISOString() } }, noRequest(), NOW),
    ).toEqual([]);
  });
  it('treats null-fetchedAt no-data as terminal and preserves traffic without creating candidates', () => {
    const r = ready();
    r.status = 'no-data';
    r.fetchedAt = null;
    r.sourceEvidence!.fetchedAt = null;
    r.sourceEvidence!.requests[0].status = 'no-data';
    expect(candidateObservation(DOMAIN, r)).toBeNull();
    expect(kindsToSubmit(state(), r, NOW)).toEqual(['traffic']);
    expect(publicTagEvidence(r.sourceEvidence!).traffic?.monthly[0].visits).toBe(123);
  });
  it('uses order-independent replay fingerprints, while preserving distinct source domains', () => {
    const a = ready();
    a.sourceEvidence!.similarSites = ['b-blog.net', 'a-blog.net', 'b-blog.net'];
    const b = ready();
    b.sourceEvidence!.similarSites = ['a-blog.net', 'b-blog.net'];
    expect(candidateObservation(DOMAIN, a)?.fingerprint).toBe(candidateObservation(DOMAIN, b)?.fingerprint);
    expect(candidateObservation('another.net', a)?.fingerprint).not.toBe(candidateObservation(DOMAIN, a)?.fingerprint);
    expect(candidateObservation(DOMAIN, { ...a, status: 'blocked' })).toBeNull();
  });
  it('strips token/Set-Cookie/unknown nested fields at the persistence boundary', () => {
    const raw = payload() as TagSimilarSitesPayload & Record<string, unknown>;
    raw.token = 'secret';
    raw['Set-Cookie'] = 'cookie';
    Object.assign(raw.requests[0], { authorization: 'Bearer secret' });
    Object.assign(raw.traffic!.monthly[0], { headers: { authorization: 'secret' } });
    const serialized = JSON.stringify(publicTagEvidence(raw));
    expect(serialized).not.toMatch(/secret|Set-Cookie|authorization|headers|token/);
    expect(() => publicTagEvidence({ ...raw, similarSites: ['x'.repeat(65536)] })).toThrow('persistence limit');
  });
});

describe('Similarweb manager', () => {
  it('does no I/O when disabled or no client is supplied', async () => {
    expect((await syncSimilarweb(nullPool, [])).status).toBe('disabled');
    expect((await syncSimilarweb(nullPool, [], { enabled: true })).status).toBe('awaiting-contract');
  });
  it('respects the advisory owner, 6-hour polling and reservations across repeated invocations', async () => {
    const store = new MemoryStore(),
      api = client();
    store.held = true;
    expect((await syncSimilarweb(nullPool, [DOMAIN], { enabled: true, client: api, store, now: NOW })).status).toBe('locked');
    expect(api.getResult).not.toHaveBeenCalled();
    store.held = false;
    await syncSimilarweb(nullPool, [DOMAIN, 'unapproved.net'], { enabled: true, client: api, store, now: NOW });
    expect(api.submit).toHaveBeenCalledTimes(2);
    expect(store.used).toBe(2);
    expect(store.held).toBe(false);
    expect(
      (await syncSimilarweb(nullPool, [DOMAIN], { enabled: true, client: api, store, now: new Date(NOW.getTime() + 3600000) })).status,
    ).toBe('waiting');
    await syncSimilarweb(nullPool, [DOMAIN], { enabled: true, client: api, store, now: new Date(NOW.getTime() + SIMILARWEB_POLL_MS) });
    expect(api.getResult).toHaveBeenCalledTimes(2);
    expect(api.submit).toHaveBeenCalledTimes(2);
  });
  it('reserves before the failing POST and stops every subsequent domain until the longest cooldown', async () => {
    const store = new MemoryStore(),
      api = client();
    store.approved = [DOMAIN, 'next-blog.net'];
    const next = new Date(NOW.getTime() + 12 * 3600000).toISOString();
    api.submit = vi.fn(async (domain: string): Promise<SimilarWebResult> => {
      expect(store.used).toBe(1);
      return { enabled: true, domain, status: 'blocked', nextAttemptAt: next, candidates: [] };
    });
    const result = await syncSimilarweb(nullPool, store.approved, { enabled: true, client: api, store, now: NOW });
    expect(result.status).toBe('blocked');
    expect(api.getResult).toHaveBeenCalledTimes(1);
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(store.blockedUntil).toBe(Date.parse(next));
    expect(store.used).toBe(1);
    expect(store.held).toBe(false);
    expect(
      (await syncSimilarweb(nullPool, store.approved, { enabled: true, client: api, store, now: new Date(NOW.getTime() + 6 * 3600000) }))
        .status,
    ).toBe('waiting');
    expect(cooldownUntil(NOW, null).getTime()).toBe(NOW.getTime() + SIMILARWEB_POLL_MS);
  });
  it('stops the whole round on disguised auth 404 and releases its lock on thrown failures', async () => {
    const store = new MemoryStore(),
      api = client();
    store.approved = [DOMAIN, 'next-blog.net'];
    api.getResult = vi.fn(
      async (domain: string): Promise<SimilarWebResult> => ({ enabled: true, domain, status: 'auth', httpStatus: 404, candidates: [] }),
    );
    expect((await syncSimilarweb(nullPool, store.approved, { enabled: true, client: api, store, now: NOW })).status).toBe('auth');
    expect(api.getResult).toHaveBeenCalledTimes(1);
    expect(api.submit).not.toHaveBeenCalled();
    expect(store.held).toBe(false);
    const fresh = new MemoryStore();
    api.getResult = vi.fn(async () => {
      throw new Error('failure');
    });
    await expect(syncSimilarweb(nullPool, [DOMAIN], { enabled: true, client: api, store: fresh, now: NOW })).rejects.toThrow('failure');
    expect(fresh.held).toBe(false);
  });
  it('stops at the daily cap before making a 31st POST', async () => {
    const store = new MemoryStore(),
      api = client();
    store.used = 29;
    expect((await syncSimilarweb(nullPool, [DOMAIN], { enabled: true, client: api, store, now: NOW })).status).toBe('daily-limit');
    expect(api.submit).toHaveBeenCalledTimes(1);
    expect(store.used).toBe(30);
  });
});

function sqlHarness({ fingerprint = null as string | null, failAudit = false, acquired = 1 } = {}) {
  const operations: Array<{ sql: string; values: unknown[] }> = [];
  let selectedFingerprint = fingerprint;
  const connection = {
    query: vi.fn(async (sql: string, values: unknown[] = []): Promise<Array<Array<Record<string, unknown>>>> => {
      operations.push({ sql, values });
      if (sql.includes('GET_LOCK')) return [[{ acquired }]];
      if (sql.includes('last_result_fetched_at'))
        return [[{ last_result_fetched_at: null, last_applied_fingerprint: selectedFingerprint }]];
      if (sql.includes('SELECT id,status')) return [[{ id: 17, status: 'rejected' }]];
      if (sql.includes('SELECT id FROM discovery_candidates')) return [[{ id: 17 }]];
      return [[]];
    }),
    execute: vi.fn(async (sql: string, values: unknown[] = []) => {
      operations.push({ sql, values });
      if (sql.includes('INSERT INTO discovery_candidate_audits') && failAudit) throw new Error('audit unavailable');
      if (sql.includes('SET last_applied_fingerprint')) selectedFingerprint = String(values[0]);
      return [{ affectedRows: 0 }];
    }),
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(),
    destroy: vi.fn(),
  };
  const pool = { getConnection: vi.fn(async () => connection) } as unknown as Pool;
  return { store: mysqlSimilarwebStore(pool), operations, connection };
}

describe('SQL persistence transaction boundary', () => {
  it('appends provenance for an existing rejected candidate without changing the decision, then skips replay', async () => {
    const h = sqlHarness();
    await h.store.acquire();
    await h.store.recordResult(DOMAIN, ready(), NOW);
    await h.store.recordResult(DOMAIN, ready(), NOW);
    const audits = h.operations.filter((o) => o.sql.includes('INSERT INTO discovery_candidate_audits'));
    expect(audits).toHaveLength(1);
    expect(audits[0].values.slice(0, 5)).toEqual([17, 'discovered', 'rejected', 'rejected', 'similarweb-similar-sites']);
    const evidence = JSON.parse(String(audits[0].values[6]));
    expect(evidence.rawTagResponse.traffic.monthly[0].visits).toBe(123);
    expect(evidence.fetchedAt).toBe(NOW.toISOString());
    expect(evidence.relationship.scope).toBe('domain-only');
    expect(h.operations.some((o) => o.sql.includes('UPDATE discovery_candidates'))).toBe(false);
    expect(h.operations.some((o) => o.sql.includes('INSERT IGNORE'))).toBe(false);
    await h.store.release();
    expect(h.connection.query).toHaveBeenLastCalledWith('SELECT RELEASE_LOCK(?)', ['blog_observe:similarweb-sync:v1']);
    expect(h.connection.release).toHaveBeenCalledTimes(1);
  });
  it('rolls back audit failure without advancing the replay checkpoint', async () => {
    const h = sqlHarness({ failAudit: true });
    await h.store.acquire();
    await expect(h.store.recordResult(DOMAIN, ready(), NOW)).rejects.toThrow('audit unavailable');
    expect(h.connection.rollback).toHaveBeenCalledTimes(1);
    expect(h.connection.commit).not.toHaveBeenCalled();
    expect(h.operations.some((o) => o.sql.includes('SET last_applied_fingerprint'))).toBe(false);
    await h.store.release();
  });
  it('releases a refused advisory connection without touching domain state', async () => {
    const h = sqlHarness({ acquired: 0 });
    expect(await h.store.acquire()).toBe(false);
    await h.store.release();
    expect(h.connection.release).toHaveBeenCalledTimes(1);
    expect(h.connection.execute).not.toHaveBeenCalled();
  });
  it('destroys rather than pools a connection when releasing its advisory lock fails', async () => {
    const h = sqlHarness();
    await h.store.acquire();
    h.connection.query.mockRejectedValueOnce(new Error('socket failed'));
    await expect(h.store.release()).rejects.toThrow('socket failed');
    expect(h.connection.destroy).toHaveBeenCalledTimes(1);
    expect(h.connection.release).not.toHaveBeenCalled();
    await h.store.release();
    expect(h.connection.destroy).toHaveBeenCalledTimes(1);
  });
  it('persists no-data traffic and excludes transport secrets from all written JSON', async () => {
    const h = sqlHarness();
    await h.store.acquire();
    const result = ready();
    result.status = 'no-data';
    result.sourceEvidence!.requests[0].status = 'no-data';
    Object.assign(result.sourceEvidence!, { token: 'DO_NOT_SAVE', 'Set-Cookie': 'DO_NOT_SAVE' });
    await h.store.recordResult(DOMAIN, result, NOW);
    const write = h.operations.find((o) => o.sql.includes('SET result='));
    expect(write).toBeDefined();
    expect(JSON.parse(String(write!.values[0])).traffic.monthly[0].visits).toBe(123);
    expect(JSON.stringify(h.operations)).not.toContain('DO_NOT_SAVE');
    expect(h.operations.some((o) => o.sql.includes('INSERT INTO discovery_candidates'))).toBe(false);
    await h.store.release();
  });
  it('keeps multiple discovery origins for the same existing candidate', async () => {
    const h = sqlHarness();
    await h.store.acquire();
    await h.store.recordResult(DOMAIN, ready(), NOW);
    await h.store.recordResult('another.net', ready('another.net'), NOW);
    const audits = h.operations.filter((o) => o.sql.includes('INSERT INTO discovery_candidate_audits'));
    expect(audits).toHaveLength(2);
    expect(audits.map((o) => o.values[0])).toEqual([17, 17]);
    expect(audits.map((o) => JSON.parse(String(o.values[6])).domain)).toEqual([DOMAIN, 'another.net']);
    await h.store.release();
  });
  it('dedupes platform provider requests without changing distinct blog identities', async () => {
    const h = sqlHarness();
    await h.store.acquire();
    h.connection.query.mockResolvedValueOnce([
      [
        { canonical_host: 'medium.com', url: 'https://medium.com/@one' },
        { canonical_host: 'medium.com', url: 'https://medium.com/@two' },
        { canonical_host: 'wrong.net', url: 'https://different.net' },
      ],
    ]);
    expect(await h.store.verifiedDomains(['medium.com', 'wrong.net', 'unapproved.net'])).toEqual(['medium.com']);
    expect(h.connection.query).toHaveBeenLastCalledWith('SELECT canonical_host,url FROM blogs WHERE status="verified" AND url IS NOT NULL');
    expect(h.connection.execute).not.toHaveBeenCalled();
    await h.store.release();
  });
});
