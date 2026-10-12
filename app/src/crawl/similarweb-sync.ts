import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { SimilarWebOptions, SimilarWebResult, TagRequestKind, TagSimilarSitesPayload } from './similarweb.ts';
import { normalizeSimilarDomain } from './similarweb-client.ts';

export const SIMILARWEB_POLL_MS = 6 * 3_600_000;
export const SIMILARWEB_REFRESH_MS = 30 * 86_400_000;
export const SIMILARWEB_DAILY_POSTS = 30;
const LOCK = 'blog_observe:similarweb-sync:v1';
const CONTROL = 'tag-api';
const KINDS: TagRequestKind[] = ['traffic', 'similar_sites'];
export type SyncDomain = {
  domain: string;
  submittedKinds: Partial<Record<TagRequestKind, string>>;
  lastResultFetchedAt: Date | null;
  lastAppliedFingerprint: string | null;
};
export type SyncStore = {
  acquire(): Promise<boolean>;
  release(): Promise<void>;
  beginRound(now: Date): Promise<boolean>;
  verifiedDomains(domains: string[]): Promise<string[]>;
  reservePoll(domain: string, now: Date): Promise<SyncDomain | null>;
  reserveSubmission(domain: string, kind: TagRequestKind, now: Date): Promise<boolean>;
  recordResult(domain: string, result: SimilarWebResult, now: Date): Promise<number>;
  cooldown(until: Date): Promise<void>;
};
export type SyncOptions = SimilarWebOptions & { now?: Date; store?: SyncStore };
export const taipeiBudgetDay = (now: Date) => new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
const time = (value?: string | Date | null) => (value ? new Date(value).getTime() : 0);
export function cooldownUntil(now: Date, next?: string | null) {
  return new Date(Math.max(now.getTime() + SIMILARWEB_POLL_MS, Number.isFinite(time(next)) ? time(next) : 0));
}

/** Pending/blocked work belongs to tag. Terminal results refresh only after 30 days. */
export function kindsToSubmit(state: SyncDomain, result: SimilarWebResult, now: Date): TagRequestKind[] {
  if (!['not-requested', 'ready', 'pending', 'no-data'].includes(result.status)) return [];
  return KINDS.filter((kind) => {
    if (
      state.submittedKinds[kind] &&
      (!Number.isFinite(time(state.submittedKinds[kind])) || now.getTime() - time(state.submittedKinds[kind]) < SIMILARWEB_REFRESH_MS)
    )
      return false;
    const request = result.sourceEvidence?.requests.find((entry) => entry.kind === kind);
    if (!request) return true;
    if (request.status === 'pending' || request.status === 'blocked') return false;
    // tag cannot refresh a terminal failure with no fetchedAt. Do not keep
    // resubmitting it; no-data remains a normal, visible outcome.
    return (
      !!result.fetchedAt &&
      now.getTime() - time(result.fetchedAt) > SIMILARWEB_REFRESH_MS &&
      now.getTime() - time(request.requestedAt) > SIMILARWEB_REFRESH_MS
    );
  });
}

export function candidateObservation(domain: string, result: SimilarWebResult) {
  const raw = result.sourceEvidence;
  if (result.status !== 'ready' || !raw?.fetchedAt || !raw.requests.some((r) => r.kind === 'similar_sites' && r.status === 'ok'))
    return null;
  const candidates = [
    ...new Set(raw.similarSites.map(normalizeSimilarDomain).filter((host): host is string => !!host && host !== domain)),
  ].sort();
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ domain, fetchedAt: raw.fetchedAt, candidates }))
    .digest('hex');
  return { raw, candidates, fingerprint };
}
/** A second allowlist at the persistence boundary: never serialize transport metadata. */
export function publicTagEvidence(raw: TagSimilarSitesPayload): TagSimilarSitesPayload {
  const clean: TagSimilarSitesPayload = {
    domain: raw.domain,
    source: raw.source,
    fetchedAt: raw.fetchedAt,
    requests: raw.requests.map(({ kind, status, requestedAt, attempts, nextAttemptAt }) => ({
      kind,
      status,
      requestedAt,
      attempts,
      nextAttemptAt,
    })),
    similarSites: [...raw.similarSites],
    traffic: raw.traffic
      ? {
          monthly: raw.traffic.monthly.map(({ month, visits }) => ({ month, visits })),
          globalRank: raw.traffic.globalRank,
          countryRank: raw.traffic.countryRank ? { code: raw.traffic.countryRank.code, rank: raw.traffic.countryRank.rank } : null,
          category: raw.traffic.category,
          topCountries: raw.traffic.topCountries.map(({ code, share }) => ({ code, share })),
        }
      : null,
  };
  if (Buffer.byteLength(JSON.stringify(clean)) > 64 * 1024) throw new Error('Similarweb evidence exceeds persistence limit');
  return clean;
}

export function submissionReservation(
  control: { budgetDay: string; submittedCount: number; cooldownUntil: Date | null },
  submitted: SyncDomain['submittedKinds'],
  kind: TagRequestKind,
  now: Date,
) {
  if (time(control.cooldownUntil) > now.getTime()) return null;
  const day = taipeiBudgetDay(now);
  const used = control.budgetDay === day ? control.submittedCount : 0;
  if (!Number.isInteger(used) || used < 0 || used >= SIMILARWEB_DAILY_POSTS) return null;
  if (submitted[kind] && (!Number.isFinite(time(submitted[kind])) || now.getTime() - time(submitted[kind]) < SIMILARWEB_REFRESH_MS))
    return null;
  return { budgetDay: day, submittedCount: used + 1, submittedKinds: { ...submitted, [kind]: now.toISOString() } };
}
const json = <T>(value: unknown, fallback: T): T =>
  value == null ? fallback : typeof value === 'string' ? (JSON.parse(value) as T) : (value as T);

/** The pool stays blog-only. One dedicated connection owns the advisory lock. */
export function mysqlSimilarwebStore(pool: Pool): SyncStore {
  let connection: PoolConnection | null = null;
  const conn = () => {
    if (!connection) throw new Error('Similarweb sync lock is not held');
    return connection;
  };
  const transaction = async <T>(run: (db: PoolConnection) => Promise<T>) => {
    const db = conn();
    await db.beginTransaction();
    try {
      const result = await run(db);
      await db.commit();
      return result;
    } catch (error) {
      try {
        await db.rollback();
      } catch {
        db.destroy();
        connection = null;
      }
      throw error;
    }
  };
  return {
    async acquire() {
      connection = await pool.getConnection();
      try {
        const [[row]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS acquired', [LOCK]);
        if (Number(row.acquired) === 1) return true;
        connection.release();
        connection = null;
        return false;
      } catch (error) {
        connection?.destroy();
        connection = null;
        throw error;
      }
    },
    async release() {
      if (!connection) return;
      const db = connection;
      connection = null;
      try {
        await db.query('SELECT RELEASE_LOCK(?)', [LOCK]);
        db.release();
      } catch (error) {
        // Never return a possibly lock-owning socket to the pool. Closing it
        // lets MariaDB release session locks even after a transport failure.
        db.destroy();
        throw error;
      }
    },
    async beginRound(now) {
      await conn().execute(
        'INSERT INTO similarweb_control (id,budget_day,submitted_count,next_round_at) VALUES (?,?,0,?) ON DUPLICATE KEY UPDATE id=id',
        [CONTROL, taipeiBudgetDay(now), now],
      );
      return transaction(async (db) => {
        const [[row]] = await db.query<RowDataPacket[]>(
          'SELECT next_round_at,cooldown_until FROM similarweb_control WHERE id=? FOR UPDATE',
          [CONTROL],
        );
        if (time(row.next_round_at) > now.getTime() || time(row.cooldown_until) > now.getTime()) return false;
        await db.execute('UPDATE similarweb_control SET next_round_at=? WHERE id=?', [
          new Date(now.getTime() + SIMILARWEB_POLL_MS),
          CONTROL,
        ]);
        return true;
      });
    },
    async verifiedDomains(domains) {
      const requested = new Set(domains.map(normalizeSimilarDomain).filter(Boolean));
      const [rows] = await conn().query<RowDataPacket[]>(
        'SELECT canonical_host,url FROM blogs WHERE status="verified" AND url IS NOT NULL',
      );
      // This groups provider requests, never blog/author identities or URL rows.
      const verified = rows.flatMap((row) => {
        try {
          const url = new URL(String(row.url));
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return [];
          // Path-based platforms commonly contain @author. Normalize only
          // their hostname for provider queries; retain the full blog URL.
          const host = normalizeSimilarDomain(url.hostname);
          const canonical = normalizeSimilarDomain(String(row.canonical_host ?? ''));
          return host && host === canonical && requested.has(host) ? [host] : [];
        } catch {
          return [];
        }
      });
      return [...new Set(verified)].sort();
    },
    async reservePoll(domain, now) {
      await conn().execute(
        'INSERT INTO similarweb_domains (domain,submitted_kinds,next_poll_at,updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE domain=domain',
        [domain, '{}', now, now],
      );
      return transaction(async (db) => {
        const [[row]] = await db.query<RowDataPacket[]>('SELECT * FROM similarweb_domains WHERE domain=? FOR UPDATE', [domain]);
        if (time(row.next_poll_at) > now.getTime()) return null;
        await db.execute('UPDATE similarweb_domains SET last_polled_at=?,next_poll_at=?,updated_at=? WHERE domain=?', [
          now,
          new Date(now.getTime() + SIMILARWEB_POLL_MS),
          now,
          domain,
        ]);
        return {
          domain,
          submittedKinds: json(row.submitted_kinds, {}),
          lastResultFetchedAt: row.last_result_fetched_at,
          lastAppliedFingerprint: row.last_applied_fingerprint,
        };
      });
    },
    async reserveSubmission(domain, kind, now) {
      return transaction(async (db) => {
        const [[control]] = await db.query<RowDataPacket[]>('SELECT * FROM similarweb_control WHERE id=? FOR UPDATE', [CONTROL]);
        const [[row]] = await db.query<RowDataPacket[]>('SELECT submitted_kinds FROM similarweb_domains WHERE domain=? FOR UPDATE', [
          domain,
        ]);
        const reserved = submissionReservation(
          { budgetDay: control.budget_day, submittedCount: Number(control.submitted_count), cooldownUntil: control.cooldown_until },
          json<SyncDomain['submittedKinds']>(row.submitted_kinds, {}),
          kind,
          now,
        );
        if (!reserved) return false;
        // Durable before POST: a failed/ambiguous send still consumes the cap.
        await db.execute('UPDATE similarweb_control SET budget_day=?,submitted_count=? WHERE id=?', [
          reserved.budgetDay,
          reserved.submittedCount,
          CONTROL,
        ]);
        await db.execute('UPDATE similarweb_domains SET submitted_kinds=?,last_submitted_at=?,updated_at=? WHERE domain=?', [
          JSON.stringify(reserved.submittedKinds),
          now,
          now,
          domain,
        ]);
        return true;
      });
    },
    async recordResult(domain, result, now) {
      return transaction(async (db) => {
        const [[row]] = await db.query<RowDataPacket[]>(
          'SELECT last_result_fetched_at,last_applied_fingerprint FROM similarweb_domains WHERE domain=? FOR UPDATE',
          [domain],
        );
        const raw = result.sourceEvidence ? publicTagEvidence(result.sourceEvidence) : undefined;
        const fetchedAt = raw?.fetchedAt ? new Date(raw.fetchedAt) : null;
        const stale = raw && time(fetchedAt) < time(row.last_result_fetched_at);
        await db.execute(
          'UPDATE similarweb_domains SET last_error_code=?,next_poll_at=GREATEST(next_poll_at,COALESCE(?,next_poll_at)),updated_at=? WHERE domain=?',
          [
            ['error', 'auth', 'config', 'blocked'].includes(result.status) ? (result.errorCode ?? result.status) : null,
            result.nextAttemptAt ? new Date(result.nextAttemptAt) : null,
            now,
            domain,
          ],
        );
        if (raw && !stale)
          await db.execute('UPDATE similarweb_domains SET result=?,last_result_fetched_at=? WHERE domain=?', [
            JSON.stringify(raw),
            fetchedAt,
            domain,
          ]);
        const observation = stale ? null : candidateObservation(domain, { ...result, sourceEvidence: raw });
        if (!observation || observation.fingerprint === row.last_applied_fingerprint) return 0;
        let inserted = 0;
        for (const candidate of observation.candidates) {
          const url = `https://${candidate}`;
          const sourceUrl = `similarweb://${domain}`;
          const evidence = JSON.stringify({
            source: 'similarweb-similar-sites',
            domain,
            fetchedAt: observation.raw.fetchedAt,
            discoveredAt: now.toISOString(),
            discoveryPath: `${domain} -> ${candidate}`,
            relationship: { from: domain, to: candidate, kind: 'similar-site', scope: 'domain-only' },
            rawTagResponse: observation.raw,
          });
          const [existing] = await db.query<RowDataPacket[]>(
            'SELECT id FROM discovery_candidates WHERE url=? AND source_type=? FOR UPDATE',
            [url, 'similarweb-similar-sites'],
          );
          await db.execute(
            'INSERT INTO discovery_candidates (url,name,source_type,source_url,source_evidence,discovered_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',
            [url, candidate, 'similarweb-similar-sites', sourceUrl, evidence, now],
          );
          inserted += existing.length ? 0 : 1;
          const [[candidateRow]] = await db.query<RowDataPacket[]>(
            'SELECT id,status FROM discovery_candidates WHERE url=? AND source_type=? FOR UPDATE',
            [url, 'similarweb-similar-sites'],
          );
          await db.execute(
            'INSERT INTO discovery_candidate_audits (candidate_id,action,previous_status,next_status,source_type,source_url,source_evidence,occurred_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            [
              candidateRow.id,
              'discovered',
              candidateRow.status,
              candidateRow.status,
              'similarweb-similar-sites',
              sourceUrl,
              evidence,
              fetchedAt,
              now,
            ],
          );
        }
        await db.execute('UPDATE similarweb_domains SET last_applied_fingerprint=? WHERE domain=?', [observation.fingerprint, domain]);
        return inserted;
      });
    },
    async cooldown(until) {
      await conn().execute(
        'UPDATE similarweb_control SET cooldown_until=GREATEST(COALESCE(cooldown_until,?),?),next_round_at=GREATEST(next_round_at,?) WHERE id=?',
        [until, until, until, CONTROL],
      );
    },
  };
}

/** Schedule/budget manager. Only the injected tag client is allowed network I/O. */
export async function syncSimilarweb(pool: Pool, domains: string[], options: SyncOptions = {}) {
  if (!options.enabled || !options.client)
    return { source: 'similarweb-similar-sites', status: options.enabled ? 'awaiting-contract' : 'disabled', results: [] };
  const clock = () => options.now ?? new Date();
  const store = options.store ?? mysqlSimilarwebStore(pool);
  if (!(await store.acquire())) return { source: 'similarweb-similar-sites', status: 'locked', results: [] };
  const results: Array<{ domain: string; status: SimilarWebResult['status']; inserted: number; submitted: TagRequestKind[] }> = [];
  let status = 'complete';
  try {
    if (!(await store.beginRound(clock()))) return { source: 'similarweb-similar-sites', status: 'waiting', results };
    const approved = await store.verifiedDomains(domains);
    domainLoop: for (const domain of approved) {
      const state = await store.reservePoll(domain, clock());
      if (!state) continue;
      const result = await options.client.getResult(domain);
      const inserted = await store.recordResult(domain, result, clock());
      const entry = { domain, status: result.status, inserted, submitted: [] as TagRequestKind[] };
      results.push(entry);
      if (['blocked', 'auth', 'config', 'error'].includes(result.status)) {
        await store.cooldown(cooldownUntil(clock(), result.nextAttemptAt));
        status = result.status;
        break;
      }
      for (const kind of kindsToSubmit(state, result, clock())) {
        if (!(await store.reserveSubmission(domain, kind, clock()))) {
          status = 'daily-limit';
          break domainLoop;
        }
        const submitted = await options.client.submit(domain, kind);
        entry.submitted.push(kind);
        if (['blocked', 'auth', 'config', 'error'].includes(submitted.status)) {
          await store.recordResult(domain, submitted, clock());
          await store.cooldown(cooldownUntil(clock(), submitted.nextAttemptAt));
          status = submitted.status;
          break domainLoop;
        }
      }
    }
    return { source: 'similarweb-similar-sites', status, results };
  } finally {
    await store.release();
  }
}
