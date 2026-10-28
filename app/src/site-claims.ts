import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { SessionUser } from './auth/google-login.ts';
import { suggestionHome, suggestionState } from './blog-suggestions.ts';
import type { FeedCrawlerOptions } from './crawl/feed.ts';
import { type ClaimMethod, claimFileUrl, homeKey, verifySiteClaim } from './site-identity.ts';

export const RECOMMENDATIONS_DAILY = 5;
export const REVIEW_COOLDOWN_MS = 3600_000;
class SiteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}
const fail = (status: number, code: string): never => {
  throw new SiteError(status, code);
};
const bodyOf = (request: FastifyRequest) =>
  (request.body && typeof request.body === 'object' ? request.body : {}) as Record<string, unknown>;
function homeOf(value: unknown) {
  const home = suggestionHome(value);
  return 'home' in home ? home.home : fail(400, 'invalid_home');
}
const idOf = (value: unknown) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : fail(400, 'invalid_id');
};
async function audit(c: PoolConnection, home: string, userId: number, action: string, evidence: object, now: Date) {
  await c.execute('INSERT INTO site_identity_audits(home_key,user_id,action,evidence,created_at) VALUES (?,?,?,?,?)', [
    homeKey(home),
    userId,
    action,
    JSON.stringify(evidence),
    now,
  ]);
}
async function transaction<T>(pool: Pool, userId: number, fn: (c: PoolConnection) => Promise<T>) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    // Serialize each account's rate checks and writes. Different accounts serialize on the candidate below.
    const [[user]] = await c.query<RowDataPacket[]>('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
    if (!user) fail(401, 'login_required');
    const value = await fn(c);
    await c.commit();
    return value;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
/** Preserve historical URLs, rejected identities, owner exclusions and every explicit human decision. */
async function candidateFor(c: PoolConnection, home: string, now: Date) {
  const u = new URL(home);
  const host = u.hostname.replace(/^www\./, '');
  const [[excluded]] = await c.query<RowDataPacket[]>(
    "SELECT id FROM discovery_candidates WHERE source_type='owner-exclusion' AND REPLACE(LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(url,'/',3),'/',-1)),'www.','')=? LIMIT 1",
    [host],
  );
  if (excluded) fail(409, 'owner_excluded');
  const state = await suggestionState(c, home);
  if (state.state === 'rejected' || state.state === 'unlisted') fail(409, 'decision_preserved');
  const path = `${host}${u.pathname.replace(/\/$/, '')}${u.search}`;
  const urls = ['https://', 'http://'].flatMap((scheme) =>
    ['', 'www.'].flatMap((www) => [`${scheme}${www}${path}`, `${scheme}${www}${path}/`]),
  );
  const [existing] = await c.query<RowDataPacket[]>(
    "SELECT id,status FROM discovery_candidates WHERE url IN (?) ORDER BY status='rejected' DESC,id LIMIT 1 FOR UPDATE",
    [urls],
  );
  let id = Number(existing[0]?.id || 0);
  if (!id) {
    await c.execute(
      "INSERT IGNORE INTO discovery_candidates(url,name,source_type,source_url,source_evidence,status,discovered_at) VALUES (?,NULL,'reader-suggestion','/api/me/sites','{}','candidate',?)",
      [home, now],
    );
    const [[row]] = await c.query<RowDataPacket[]>('SELECT id,status FROM discovery_candidates WHERE url=? FOR UPDATE', [home]);
    id = Number(row.id);
  }
  const [[manual]] = await c.query<RowDataPacket[]>(
    "SELECT id FROM discovery_candidate_audits WHERE candidate_id=? AND (source_type IN ('manual','human-review','admin') OR source_actor_id IS NOT NULL) LIMIT 1",
    [id],
  );
  if (existing[0]?.status === 'rejected' || (manual && existing[0]?.status !== 'approved')) fail(409, 'decision_preserved');
  return id;
}
async function enqueue(c: PoolConnection, candidateId: number, userId: number, now: Date, required = false) {
  const [[candidate]] = await c.query<RowDataPacket[]>('SELECT status FROM discovery_candidates WHERE id=? FOR UPDATE', [candidateId]);
  if (candidate?.status !== 'candidate') return { status: 'listed' };
  const [[row]] = await c.query<RowDataPacket[]>('SELECT status,requested_at FROM site_review_requests WHERE candidate_id=? FOR UPDATE', [
    candidateId,
  ]);
  if (row?.status === 'pending') return { status: 'pending', requestedAt: row.requested_at };
  if (row && now.getTime() - new Date(row.requested_at).getTime() < REVIEW_COOLDOWN_MS) {
    if (required) fail(429, 'review_cooldown');
    return { status: 'cooldown', requestedAt: row.requested_at };
  }
  const [[count]] = await c.query<RowDataPacket[]>(
    "SELECT COUNT(*) n FROM site_identity_audits WHERE user_id=? AND action='review.request' AND created_at>=?",
    [userId, new Date(now.getTime() - 86400000)],
  );
  if (Number(count.n) >= 10) {
    if (required) fail(429, 'review_daily_limit');
    return { status: 'daily_limit' };
  }
  await c.execute(
    "INSERT INTO site_review_requests(candidate_id,user_id,status,requested_at) VALUES (?,?,'pending',?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id),status='pending',requested_at=VALUES(requested_at),processed_at=NULL,result=NULL",
    [candidateId, userId, now],
  );
  const [[site]] = await c.query<RowDataPacket[]>('SELECT url FROM discovery_candidates WHERE id=?', [candidateId]);
  await audit(c, String(site.url), userId, 'review.request', { candidateId }, now);
  return { status: 'pending', requestedAt: now };
}

type Options = {
  pool: Pool;
  publicOrigin: string;
  requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null>;
  now?: () => Date;
  crawl?: FeedCrawlerOptions;
};
export function registerSiteClaimRoutes(app: FastifyInstance, options: Options) {
  const { pool } = options;
  const now = options.now ?? (() => new Date());
  const handle =
    (fn: (request: FastifyRequest, user: SessionUser) => Promise<unknown>, mutation = true) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('cache-control', 'private, no-store');
      if (mutation && request.headers.origin !== options.publicOrigin) return reply.code(403).send({ error: 'same_origin_required' });
      const user = await options.requireUser(request, reply);
      if (!user) return reply;
      try {
        return await fn(request, user);
      } catch (error) {
        if (error instanceof SiteError) return reply.code(error.status).send({ error: error.code });
        request.log.error({ code: 'site_request_failed' }, 'site identity request failed');
        return reply.code(503).send({ error: 'sites_unavailable' });
      }
    };
  app.get(
    '/api/me/sites',
    handle(async (_request, user) => {
      const [claims] = await pool.query<RowDataPacket[]>(
        `SELECT s.id,s.home_url home,s.method,s.relationship,s.status,s.expires_at expiresAt,s.verified_at verifiedAt,CASE WHEN s.status='pending' THEN s.token ELSE NULL END token,
       d.status candidateStatus,JSON_UNQUOTE(JSON_EXTRACT(d.source_evidence,'$.automaticReview.reason')) reason,
       r.status reviewStatus,r.requested_at requestedAt,r.processed_at processedAt,
       b.slug,b.name,b.last_crawl_success_at lastCrawlSuccessAt
       FROM site_claims s LEFT JOIN discovery_candidates d ON d.id=s.candidate_id
       LEFT JOIN site_review_requests r ON r.candidate_id=d.id
       LEFT JOIN blogs b ON b.id=JSON_EXTRACT(d.source_evidence,'$.automaticReview.blogId') AND b.status='verified'
       WHERE s.user_id=? ORDER BY s.id DESC LIMIT 100`,
        [user.id],
      );
      const [recommendations] = await pool.query<RowDataPacket[]>(
        `SELECT s.id,s.home_url home,s.reason,s.status,s.created_at createdAt,d.status candidateStatus,
       r.status reviewStatus,r.requested_at requestedAt,r.processed_at processedAt,
       JSON_UNQUOTE(JSON_EXTRACT(d.source_evidence,'$.automaticReview.reason')) reviewReason
       FROM site_recommendations s LEFT JOIN discovery_candidates d ON d.id=s.candidate_id
       LEFT JOIN site_review_requests r ON r.candidate_id=d.id WHERE s.user_id=? ORDER BY s.id DESC LIMIT 100`,
        [user.id],
      );
      const [requests] = await pool.query<RowDataPacket[]>(
        `SELECT r.candidate_id id,d.url home,r.status,r.status reviewStatus,r.requested_at requestedAt,
         r.processed_at processedAt,r.result,d.status candidateStatus,
         JSON_UNQUOTE(JSON_EXTRACT(d.source_evidence,'$.automaticReview.reason')) reviewReason
         FROM site_review_requests r JOIN discovery_candidates d ON d.id=r.candidate_id
         WHERE r.user_id=? ORDER BY r.requested_at DESC LIMIT 100`,
        [user.id],
      );
      return { claims, recommendations, requests };
    }, false),
  );
  app.post(
    '/api/me/sites/recommend',
    { bodyLimit: 2048 },
    handle(async (request, user) => {
      const body = bodyOf(request),
        home = homeOf(body.url),
        at = now();
      if (body.confirm !== true) fail(400, 'recommendation_confirmation_required');
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length > 500) fail(400, 'reason_too_long');
      return transaction(pool, user.id, async (c) => {
        const candidateId = await candidateFor(c, home, at);
        const [[existing]] = await c.query<RowDataPacket[]>(
          'SELECT id,status,reason FROM site_recommendations WHERE user_id=? AND home_key=? FOR UPDATE',
          [user.id, homeKey(home)],
        );
        if (existing?.status !== 'active') {
          const [[count]] = await c.query<RowDataPacket[]>(
            "SELECT COUNT(*) n FROM site_identity_audits WHERE user_id=? AND action='recommendation.create' AND created_at>=?",
            [user.id, new Date(at.getTime() - 86400000)],
          );
          if (Number(count.n) >= RECOMMENDATIONS_DAILY) fail(429, 'recommendation_daily_limit');
          await c.execute(
            "INSERT INTO site_recommendations(home_key,home_url,user_id,candidate_id,reason,created_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE status='active',reason=VALUES(reason),created_at=VALUES(created_at)",
            [homeKey(home), home, user.id, candidateId, reason, at],
          );
          await audit(c, home, user.id, 'recommendation.create', { candidateId, reason }, at);
        } else if (reason && existing.reason !== reason) {
          await c.execute('UPDATE site_recommendations SET reason=? WHERE id=?', [reason, existing.id]);
          await audit(c, home, user.id, 'recommendation.update', { id: existing.id, reason }, at);
        }
        return { home, review: await enqueue(c, candidateId, user.id, at) };
      });
    }),
  );
  app.post(
    '/api/me/sites/recheck',
    { bodyLimit: 2048 },
    handle(async (request, user) => {
      const home = homeOf(bodyOf(request).url),
        at = now();
      return transaction(pool, user.id, async (c) => ({
        home,
        review: await enqueue(c, await candidateFor(c, home, at), user.id, at, true),
      }));
    }),
  );
  app.post(
    '/api/me/sites/claims',
    { bodyLimit: 2048 },
    handle(async (request, user) => {
      const body = bodyOf(request),
        home = homeOf(body.url),
        method = body.method as ClaimMethod,
        at = now();
      if (!['meta', 'file', 'about'].includes(method)) fail(400, 'invalid_method');
      if (!['author', 'manager', 'both'].includes(String(body.relationship))) fail(400, 'invalid_relationship');
      if (body.confirm !== true) fail(400, 'site_declaration_required');
      // Path platforms need platform-specific proof adapters; generic text or files must never grant their account space.
      if (
        new URL(home).search ||
        /^(?:medium\.com|vocus\.cc|blog\.udn\.com|matters\.(?:town|news)|hackmd\.io|note\.(?:com|mu)|substack\.com|home\.gamer\.com\.tw)$/.test(
          new URL(home).hostname,
        )
      )
        fail(422, 'platform_verification_unsupported');
      return transaction(pool, user.id, async (c) => {
        const candidateId = await candidateFor(c, home, at);
        const [[owner]] = await c.query<RowDataPacket[]>(
          "SELECT id,user_id FROM site_claims WHERE home_key=? AND status='verified' FOR UPDATE",
          [homeKey(home)],
        );
        if (owner) fail(409, Number(owner.user_id) === user.id ? 'already_verified' : 'site_already_claimed');
        const [[count]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM site_claims WHERE user_id=? AND created_at>=?', [
          user.id,
          new Date(at.getTime() - 86400000),
        ]);
        if (Number(count.n) >= 10) fail(429, 'claim_daily_limit');
        const token = `wt_${randomBytes(32).toString('base64url')}`;
        const expiresAt = new Date(at.getTime() + 86400000);
        const [insert] = await c.execute<ResultSetHeader>(
          'INSERT INTO site_claims(home_key,home_url,user_id,candidate_id,method,relationship,token,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
          [homeKey(home), home, user.id, candidateId, method, String(body.relationship), token, expiresAt, at],
        );
        await audit(c, home, user.id, 'claim.create', { claimId: insert.insertId, method, relationship: body.relationship }, at);
        return {
          id: insert.insertId,
          home,
          method,
          token,
          expiresAt,
          marker: method === 'meta' ? `<meta name="weblog-verification" content="${token}">` : `weblog-verification: ${token}`,
          fileUrl: method === 'file' ? claimFileUrl(home, token) : null,
        };
      });
    }),
  );
  app.post(
    '/api/me/sites/claims/:id/verify',
    { bodyLimit: 2048 },
    handle(async (request, user) => {
      const id = idOf((request.params as { id: string }).id),
        at = now();
      // Reserve a verification attempt before network I/O; no transaction stays open during fetch.
      const claim = await transaction(pool, user.id, async (c) => {
        const [[row]] = await c.query<RowDataPacket[]>('SELECT * FROM site_claims WHERE id=? AND user_id=? FOR UPDATE', [id, user.id]);
        if (!row) fail(404, 'claim_not_found');
        if (row.status === 'verified') return row;
        if (row.status !== 'pending' || new Date(row.expires_at) <= at) fail(409, 'claim_expired');
        if (row.last_attempt_at && at.getTime() - new Date(row.last_attempt_at).getTime() < 60000) fail(429, 'verification_cooldown');
        const [[attempts]] = await c.query<RowDataPacket[]>(
          "SELECT COUNT(*) n FROM site_identity_audits WHERE user_id=? AND action='claim.attempt' AND created_at>=?",
          [user.id, new Date(at.getTime() - 86400000)],
        );
        if (Number(attempts.n) >= 30) fail(429, 'verification_daily_limit');
        await c.execute('UPDATE site_claims SET last_attempt_at=? WHERE id=?', [at, id]);
        await audit(c, String(row.home_url), user.id, 'claim.attempt', { claimId: id }, at);
        return row;
      });
      if (claim.status === 'verified') return { verified: true };
      let proof: Awaited<ReturnType<typeof verifySiteClaim>> = null;
      try {
        proof = await verifySiteClaim(String(claim.home_url), String(claim.token), claim.method as ClaimMethod, {
          timeoutMs: 6000,
          ...options.crawl,
        });
      } catch {
        fail(422, 'verification_fetch_failed');
      }
      if (!proof) return fail(422, 'verification_marker_not_found');
      const verifiedProof = proof;
      return transaction(pool, user.id, async (c) => {
        const home = String(claim.home_url);
        const candidateId = await candidateFor(c, home, now());
        const [[current]] = await c.query<RowDataPacket[]>('SELECT * FROM site_claims WHERE id=? AND user_id=? FOR UPDATE', [id, user.id]);
        if (current?.status === 'verified') return { verified: true };
        if (current?.status !== 'pending' || new Date(current.expires_at) <= now()) fail(409, 'claim_expired');
        const [[owner]] = await c.query<RowDataPacket[]>("SELECT id FROM site_claims WHERE home_key=? AND status='verified' FOR UPDATE", [
          homeKey(home),
        ]);
        if (owner) fail(409, 'site_already_claimed');
        await c.execute("UPDATE site_claims SET status='verified',verified_at=?,proof_url=?,proof_sha256=? WHERE id=?", [
          now(),
          verifiedProof.proofUrl,
          verifiedProof.sha256,
          id,
        ]);
        await audit(
          c,
          home,
          user.id,
          'claim.verify',
          { claimId: id, proofUrl: verifiedProof.proofUrl, sha256: verifiedProof.sha256 },
          now(),
        );
        return { verified: true, home, review: await enqueue(c, candidateId, user.id, now()) };
      });
    }),
  );
  app.post(
    '/api/me/sites/:kind/:id/revoke',
    { bodyLimit: 2048 },
    handle(async (request, user) => {
      const { kind, id: rawId } = request.params as { kind: string; id: string };
      const id = idOf(rawId),
        at = now();
      const table = kind === 'claims' ? 'site_claims' : kind === 'recommendations' ? 'site_recommendations' : fail(404, 'not_found');
      return transaction(pool, user.id, async (c) => {
        const [[row]] = await c.query<RowDataPacket[]>(`SELECT home_url,status FROM ${table} WHERE id=? AND user_id=? FOR UPDATE`, [
          id,
          user.id,
        ]);
        if (!row) fail(404, 'not_found');
        if (row.status !== 'revoked') {
          await c.execute(`UPDATE ${table} SET status='revoked' WHERE id=? AND user_id=?`, [id, user.id]);
          await audit(c, String(row.home_url), user.id, `${kind === 'claims' ? 'claim' : 'recommendation'}.revoke`, { id }, at);
        }
        return { revoked: true };
      });
    }),
  );
}
