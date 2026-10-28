import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../tests/integration/guard.mjs';
import { loadBlogQueue } from './blog-suggestions.ts';
import { recordCandidateCheck } from './crawl/candidate-promotion.ts';
import { runReaderReviewBatch } from './crawl/candidate-review.ts';
import { validateCandidate } from './crawl/candidate-validation.ts';
import { registerSiteClaimRoutes } from './site-claims.ts';
import { accountEvidenceFor } from './site-identity.ts';

export async function runSiteClaimsIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  let assertions = 0;
  const check = (value: unknown, message: string) => {
    assert.ok(value, message);
    assertions++;
  };
  const ids: number[] = [];
  for (const n of [1, 2]) {
    const [row] = await pool.execute<import('mysql2/promise').ResultSetHeader>(
      "INSERT INTO users(google_sub,email,name,created_at,last_login_at) VALUES (?,?,'Private name',UTC_TIMESTAMP(),UTC_TIMESTAMP())",
      [`claim-test-${n}`, `claim-${n}@example.test`],
    );
    ids.push(row.insertId);
  }
  let userId: number | null = ids[0];
  let time = new Date();
  const home = 'https://claims-integration.test/';
  const pages: Record<string, string> = {};
  const crawl = {
    delayMs: 250,
    resolveHost: async () => ['93.184.216.34'],
    fetcher: async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      const page = pages[url];
      return new Response(page || null, {
        status: page ? 200 : 404,
        headers: { 'content-type': url.endsWith('/feed/') ? 'application/rss+xml' : 'text/html' },
      });
    },
  };
  function publication(url: string, description = 'Notes on books and software.') {
    pages[url] =
      `<title>Integration Notes</title><meta name="description" content="${description}"><link rel="alternate" type="application/rss+xml" href="${url}feed/">`;
    pages[`${url}feed/`] =
      `<rss><channel><title>A different feed title</title><link>${url}</link><item><title>A note</title><link>${url}post/</link><guid>${url}post/</guid></item></channel></rss>`;
  }
  const app = Fastify();
  registerSiteClaimRoutes(app, {
    pool,
    publicOrigin: 'https://weblog.tw',
    now: () => time,
    crawl,
    requireUser: async (request, reply) => {
      const actor = request.headers['x-fixture-user'] ? Number(request.headers['x-fixture-user']) : userId;
      if (!actor) {
        reply.code(401).send({ error: 'login required' });
        return null;
      }
      return { id: actor } as never;
    },
  });
  const post = (path: string, payload: object = {}, origin = 'https://weblog.tw') =>
    app.inject({ method: 'POST', url: `/api/me/sites${path}`, headers: { origin }, payload });
  const create = (url = home, method = 'meta') => post('/claims', { url, method, relationship: 'both', confirm: true });
  try {
    check((await create()).statusCode === 200, 'challenge created');
    const challenge = (await create()).json();
    check(challenge.token.length >= 40 && !JSON.stringify(challenge).includes('Private name'), 'unguessable private-account-free token');
    check((await post('/claims', { url: home, method: 'meta', relationship: 'both' })).statusCode === 400, 'declaration required');
    check(
      (await post('/claims', { url: home, method: 'meta', confirm: true, relationship: 'both' }, 'https://evil.test')).statusCode === 403,
      'CSRF blocked',
    );
    userId = null;
    check((await create()).statusCode === 401, 'login required');
    userId = ids[1];
    check((await post(`/claims/${challenge.id}/verify`)).statusCode === 404, 'cannot verify another account challenge');
    userId = ids[0];
    publication(home);
    check((await post(`/claims/${challenge.id}/verify`)).statusCode === 422, 'missing marker rejected');
    check((await post(`/claims/${challenge.id}/verify`)).statusCode === 429, 'verification attempts cooled down');
    time = new Date(time.getTime() + 61000);
    pages[home] += `<meta name="weblog-verification" content="${challenge.token}">`;
    // The HTML tag belongs in head; the generated fixture contains head-only elements, so the parser keeps it there.
    const verified = await post(`/claims/${challenge.id}/verify`);
    check(verified.statusCode === 200 && verified.json().verified === true, 'control proof verified');
    const evidence = await accountEvidenceFor(pool, home);
    check(evidence?.kind === 'claim' && evidence.userId === userId, 'claim has account provenance');
    userId = ids[1];
    check((await create()).statusCode === 409, 'existing verified manager cannot be replaced');
    const foreignList = (await app.inject('/api/me/sites')).json();
    check(!JSON.stringify(foreignList).includes(challenge.token), 'private claims not exposed to other accounts');
    userId = ids[0];
    const mine = await app.inject('/api/me/sites');
    check(mine.headers['cache-control'] === 'private, no-store', 'private list never shared-cached');
    check(!JSON.stringify(mine.json()).includes('@example.test'), 'list has no email');
    const [[candidate]] = await pool.query<RowDataPacket[]>('SELECT * FROM discovery_candidates WHERE url=?', [home]);
    const validated = await validateCandidate(candidate as never, { ...crawl, accountEvidence: evidence });
    check(validated.eligible && !validated.personalEvidence?.personal, 'verified claim replaces self-description threshold');
    check((await post(`/claims/${challenge.id}/revoke`)).json().revoked, 'own claim can be revoked');
    check((await recordCandidateCheck(pool, validated, true)).status === 'candidate', 'revoked proof cannot approve a cached check');
    check((await accountEvidenceFor(pool, home)) === undefined, 'revoked proof is not selected');
    const recommended = await post('/recommend', { url: home, confirm: true, reason: 'Long-time reader' });
    check(recommended.statusCode === 200, 'signed-in recommendation recorded');
    const pendingQueue = await loadBlogQueue(pool, { q: 'claims-integration.test' });
    check(pendingQueue.states.waiting === 1 && pendingQueue.items[0].reason === null, 'pending public queue hides obsolete failure reason');
    const recommendedEvidence = await accountEvidenceFor(pool, home);
    check(recommendedEvidence?.kind === 'recommendation', 'recommendation remains distinct from claim');
    check((await post('/recommend', { url: home })).statusCode === 400, 'recommendation needs explicit confirmation');
    const before = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) n FROM site_recommendations WHERE user_id=? AND home_key IS NOT NULL',
      [userId],
    );
    await post('/recommend', { url: home, confirm: true });
    const after = await pool.query<RowDataPacket[]>(
      'SELECT COUNT(*) n FROM site_recommendations WHERE user_id=? AND home_key IS NOT NULL',
      [userId],
    );
    check(before[0][0].n === after[0][0].n, 'duplicate recommendation is idempotent');
    const batch = await runReaderReviewBatch(pool, { apply: true, maxDurationMs: 30000, ...crawl });
    check(batch.processed === 1, 'reader review processed outside weekly gate');
    const [[request]] = await pool.query<RowDataPacket[]>('SELECT status FROM site_review_requests WHERE candidate_id=?', [candidate.id]);
    check(request.status === 'completed', 'reader receives completion');
    const [[admitted]] = await pool.query<RowDataPacket[]>('SELECT status FROM discovery_candidates WHERE id=?', [candidate.id]);
    check(admitted.status === 'approved', 'recommended same-site feed with different title admitted');
    check((await loadBlogQueue(pool, { q: 'claims-integration.test' })).states.listed === 1, 'public queue reports completed admission');
    const [[reco]] = await pool.query<RowDataPacket[]>('SELECT id FROM site_recommendations WHERE user_id=? LIMIT 1', [userId]);
    await post(`/recommendations/${reco.id}/revoke`);
    const [[stillListed]] = await pool.query<RowDataPacket[]>('SELECT status FROM discovery_candidates WHERE id=?', [candidate.id]);
    check(stillListed.status === 'approved', 'revoking recommendation does not delist');
    // A claim never overrides clear organizational evidence or an existing exclusion.
    const organization = 'https://claims-company.test/';
    publication(organization, '企業官方 公司官網');
    const proposed = await post('/recommend', { url: organization, confirm: true });
    check(proposed.statusCode === 200, 'recommendation can be received without claiming acceptance');
    const [[company]] = await pool.query<RowDataPacket[]>('SELECT * FROM discovery_candidates WHERE url=?', [organization]);
    const companyCheck = await validateCandidate(company as never, {
      ...crawl,
      accountEvidence: await accountEvidenceFor(pool, organization),
    });
    check(!companyCheck.eligible, 'recommendation never overrides explicit corporate evidence');
    await pool.query("UPDATE discovery_candidates SET status='rejected' WHERE id=?", [company.id]);
    check((await post('/recheck', { url: organization })).statusCode === 409, 'rejected decisions preserved');
    check((await create('https://medium.com/@someone')).statusCode === 422, 'platform claims require a dedicated adapter');
    // Rechecks do not gain ownership and are limited independently of verification.
    const retryHome = 'https://claims-retry.test/';
    await post('/recheck', { url: retryHome });
    const [[retry]] = await pool.query<RowDataPacket[]>('SELECT id FROM discovery_candidates WHERE url=?', [retryHome]);
    await pool.query("UPDATE site_review_requests SET status='completed',processed_at=? WHERE candidate_id=?", [time, retry.id]);
    check((await post('/recheck', { url: retryHome })).statusCode === 429, 'completed review has an hour cooldown');
    for (let n = 0; n < 5; n++) await post('/recommend', { url: `https://claims-quota-${n}.test/`, confirm: true });
    check(
      (await post('/recommend', { url: 'https://claims-quota-last.test/', confirm: true })).statusCode === 429,
      'daily recommendation limit enforced',
    );
    const raceHome = 'https://claims-concurrent.test/';
    userId = ids[0];
    const a = (await create(raceHome)).json();
    userId = ids[1];
    const b = (await create(raceHome)).json();
    publication(raceHome);
    pages[raceHome] += `<meta name="weblog-verification" content="${a.token}"><meta name="weblog-verification" content="${b.token}">`;
    const concurrent = await Promise.all(
      [a, b].map((claim, index) =>
        app.inject({
          method: 'POST',
          url: `/api/me/sites/claims/${claim.id}/verify`,
          headers: { origin: 'https://weblog.tw', 'x-fixture-user': String(ids[index]) },
        }),
      ),
    );
    check(
      concurrent
        .map((r) => r.statusCode)
        .sort()
        .join(',') === '200,409',
      'competing verified claims serialize without stealing',
    );
    const [[owners]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM site_claims WHERE home_url=? AND status='verified'", [
      raceHome,
    ]);
    check(Number(owners.n) === 1, 'one active verified manager per publication');
    userId = ids[0];
    const manualHome = 'https://claims-manual.test/';
    await post('/recheck', { url: manualHome });
    const [[manualCandidate]] = await pool.query<RowDataPacket[]>('SELECT id FROM discovery_candidates WHERE url=?', [manualHome]);
    await pool.execute(
      `INSERT INTO discovery_candidate_audits(candidate_id,action,previous_status,next_status,source_type,source_actor_id,note,occurred_at,created_at)
      VALUES (?,'verify','candidate','candidate','manual',?,'manual hold',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
      [manualCandidate.id, userId],
    );
    check((await post('/recheck', { url: manualHome })).statusCode === 409, 'manual hold never requeued');
    await pool.execute(
      "INSERT INTO discovery_candidates(url,name,source_type,source_evidence,status,discovered_at) VALUES ('https://claims-excluded.test/','Excluded','owner-exclusion','{}','rejected',UTC_TIMESTAMP())",
    );
    check((await create('https://claims-excluded.test/')).statusCode === 409, 'owner exclusion cannot be claimed');
    const expiring = (await create('https://claims-expiring.test/')).json();
    time = new Date(time.getTime() + 86400001);
    check((await post(`/claims/${expiring.id}/verify`)).statusCode === 409, 'expired challenge rejected');
    return { assertions };
  } finally {
    await app.close();
  }
}
