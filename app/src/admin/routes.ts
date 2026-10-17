import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { validatedOverride } from '../ai/contracts.ts';
import { readCookie, SESSION_COOKIE } from '../auth/google-login.ts';
import { recordCandidateCheck } from '../crawl/candidate-promotion.ts';
import { budgetedCandidateFetcher } from '../crawl/candidate-review.ts';
import { type DiscoveryCandidate, validateCandidate } from '../crawl/candidate-validation.ts';
import { robotsFor, robotsStatuses } from '../crawl/robots-observations.ts';
import { createTagSimilarSitesClient, normalizeSimilarDomain } from '../crawl/similarweb-client.ts';
import { cooldownUntil, mysqlSimilarwebStore } from '../crawl/similarweb-sync.ts';
import { invalidateRelationCache } from '../relations/routes.ts';
import { adminAccounts } from './accounts.ts';
import { adminBlogs } from './blogs.ts';
import { type AdminOptions, csrfToken, installAdminGuard } from './guard.ts';
import { type AdminActor, isAdmin, requireAdminTransaction, writeAudit } from './identity.ts';
import { beginIntent, digest, executeIntentWork, finishIntent, recordExternalOutcome } from './intent.ts';

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const id = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
const note = (v: unknown) => (typeof v === 'string' && v.length <= 500 ? v : '');
const invalid = () => {
  throw Object.assign(Error('invalid_admin_input'), { statusCode: 400 });
};
export const relationFingerprint = (postId: number, url: string, location: string) => digest(JSON.stringify([postId, url, location]));
export function registerAdminRoutes(app: FastifyInstance, config: AdminOptions) {
  installAdminGuard(app, config);
  const actor = async (req: FastifyRequest): Promise<AdminActor> => {
    const user = await config.login.currentUser(req);
    if (!user?.sub || !(await isAdmin(config.pool, user, config.adminEmails)))
      throw Object.assign(Error('admin_required'), { statusCode: 403 });
    return { id: user.id, sub: user.sub };
  };
  const transaction = async <T>(admin: AdminActor, work: (c: PoolConnection) => Promise<T>) => {
    const c = await config.pool.getConnection();
    try {
      await c.beginTransaction();
      await requireAdminTransaction(c, admin, config.adminEmails);
      const out = await work(c);
      await c.commit();
      return out;
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  };
  const mutate = async (
    req: FastifyRequest,
    action: string,
    payload: unknown,
    work: (admin: AdminActor, intentId: string) => Promise<unknown>,
    network = false,
  ) => {
    const admin = await actor(req);
    const intent = await beginIntent(config.pool, admin, config.adminEmails, req.headers['idempotency-key'], action, payload, network);
    if (intent.prior) {
      if (intent.status !== 'done') throw Object.assign(Error(`intent_${intent.status}`), { statusCode: 409 });
      return intent.result;
    }
    return executeIntentWork(
      () => work(admin, intent.id),
      (value, state) => finishIntent(config.pool, intent.id, value, state),
    );
  };
  app.get('/api/admin/session', async (req) => {
    const admin = await actor(req);
    const session = readCookie(req, SESSION_COOKIE)!;
    return { user: { id: admin.id, role: 'admin' }, csrfToken: csrfToken(session, config.sessionSecret) };
  });
  app.get('/api/admin/discovery', async (req) => {
    const q = object(req.query),
      search = typeof q.q === 'string' ? q.q.trim().slice(0, 150) : '',
      status = ['candidate', 'approved', 'rejected'].includes(String(q.status)) ? String(q.status) : 'candidate';
    const cursor = Number(q.cursor || 0),
      limit = Math.min(100, Math.max(1, Number(q.limit) || 50));
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isInteger(limit)) invalid();
    const [rows] = await config.pool.query<RowDataPacket[]>(
      "SELECT id,url,name,source_type sourceType,source_url sourceUrl,source_evidence sourceEvidence,status,discovered_at discoveredAt FROM discovery_candidates WHERE status=? AND id>? AND (?='' OR name LIKE ? OR url LIKE ?) ORDER BY id LIMIT ?",
      [status, cursor, search, `%${search}%`, `%${search}%`, limit + 1],
    );
    const candidates = rows.slice(0, limit);
    const robots = await robotsStatuses(
      config.pool,
      candidates.map((c) => c.url),
    ).catch(() => new Map());
    return {
      candidates: candidates.map((c) => ({ ...c, robots: robotsFor(robots, c.url) })),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
      status,
    };
  });
  app.post('/api/admin/discovery/review', async (req) => {
    const b = object(req.body);
    const ids = Array.isArray(b.ids) ? [...new Set(b.ids.map(id))] : [];
    const action = String(b.action || '');
    if (!ids.length || ids.length > 25 || ids.includes(null) || !['verify', 'approve', 'reject'].includes(action)) invalid();
    const payload = { ids, action, note: note(b.note) };
    return mutate(
      req,
      'discovery.review',
      payload,
      async (admin) => {
        const results = [];
        const deadline = Date.now() + 120000;
        let stopped = false;
        const assert = async () => {
          if (!(await isAdmin(config.pool, admin, config.adminEmails)))
            throw Object.assign(Error('admin_access_revoked'), { statusCode: 403 });
        };
        const fetcher = budgetedCandidateFetcher(
          config.pool,
          { ...config.crawlOptions, userAgent: config.userAgent },
          assert,
          deadline,
          () => {
            stopped = true;
          },
        );
        for (const candidateId of ids) {
          if (Date.now() >= deadline) {
            results.push({ id: candidateId, status: 'deferred' });
            continue;
          }
          const [[candidate]] = await config.pool.query<RowDataPacket[]>('SELECT * FROM discovery_candidates WHERE id=?', [candidateId]);
          if (!candidate) {
            results.push({ id: candidateId, status: 'not_found' });
            continue;
          }
          if (action === 'reject') {
            results.push(
              await transaction(admin, async (c) => {
                const [[row]] = await c.query<RowDataPacket[]>('SELECT status FROM discovery_candidates WHERE id=? FOR UPDATE', [
                  candidateId,
                ]);
                if (!row) return { id: candidateId, status: 'not_found' };
                if (row.status !== 'candidate') return { id: candidateId, status: 'decision-changed' };
                await c.execute("UPDATE discovery_candidates SET status='rejected' WHERE id=?", [candidateId]);
                await c.execute(
                  "INSERT INTO discovery_candidate_audits(candidate_id,action,previous_status,next_status,source_type,source_actor_id,note,occurred_at,created_at) VALUES (?,'reject',?,'rejected','human-review',?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())",
                  [candidateId, row.status, admin.id, payload.note],
                );
                await writeAudit(
                  c,
                  admin.id,
                  'candidate.reject',
                  'candidate',
                  String(candidateId),
                  { status: row.status },
                  { status: 'rejected' },
                  payload.note,
                );
                return { id: candidateId, status: 'rejected' };
              }),
            );
            continue;
          }
          const check = await validateCandidate({ ...candidate, status: 'candidate' } as DiscoveryCandidate, {
            ...config.crawlOptions,
            fetcher,
            userAgent: config.userAgent,
            timeoutMs: 6000,
            delayMs: 1200,
          });
          if (stopped) {
            results.push({ id: candidateId, status: 'deferred' });
            break;
          }
          if (action === 'verify') check.eligible = false;
          results.push(
            await recordCandidateCheck(config.pool, check, true, { actor: admin, emails: config.adminEmails, note: payload.note }),
          );
        }
        return { results };
      },
      action !== 'reject',
    );
  });
  app.post('/api/admin/ai-override', async (req) => {
    const b = object(req.body),
      entityId = id(b.entityId);
    if (!entityId || !((b.entityType === 'blog' && b.task === 'profile') || (b.entityType === 'post' && b.task === 'topics'))) invalid();
    const result = validatedOverride(b.result);
    if (!result) invalid();
    const payload = { entityType: String(b.entityType), entityId, task: String(b.task), result, note: note(b.note) };
    return mutate(req, 'ai.override', payload, (admin) =>
      transaction(admin, async (c) => {
        const [[entity]] = await c.query<RowDataPacket[]>(
          `SELECT id FROM ${payload.entityType === 'blog' ? 'blogs' : 'posts'} WHERE id=?`,
          [entityId],
        );
        if (!entity) invalid();
        const [[prior]] = await c.query<RowDataPacket[]>(
          'SELECT result_json FROM ai_overrides WHERE entity_type=? AND entity_id=? AND task=? FOR UPDATE',
          [payload.entityType, entityId, payload.task],
        );
        await c.execute(
          'INSERT INTO ai_overrides(entity_type,entity_id,task,result_json,actor,note,updated_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE result_json=VALUES(result_json),actor=VALUES(actor),note=VALUES(note),updated_at=VALUES(updated_at)',
          [payload.entityType, entityId, payload.task, JSON.stringify(result), `admin:${admin.id}`, payload.note],
        );
        await writeAudit(
          c,
          admin.id,
          'ai.override',
          payload.entityType,
          String(entityId),
          prior
            ? { resultHash: digest(typeof prior.result_json === 'string' ? prior.result_json : JSON.stringify(prior.result_json)) }
            : null,
          { task: payload.task, resultHash: digest(JSON.stringify(result)) },
          payload.note,
        );
        return { ok: true };
      }),
    );
  });
  app.post('/api/admin/tags', async (req) => {
    const b = object(req.body),
      blogId = id(b.blogId),
      label = typeof b.label === 'string' ? b.label.trim().normalize('NFKC') : '';
    if (!blogId || !label || label.length > 100 || /[\p{Cc}\p{Cf}]/u.test(label) || !['set', 'remove'].includes(String(b.action)))
      invalid();
    const payload = { blogId, label, action: String(b.action), note: note(b.note) };
    return mutate(req, 'tags.manual', payload, (admin) =>
      transaction(admin, async (c) => {
        const [[blog]] = await c.query<RowDataPacket[]>('SELECT id FROM blogs WHERE id=?', [blogId]);
        if (!blog) invalid();
        const slug = `manual-${digest(label.toLowerCase()).slice(0, 40)}`;
        await c.execute(
          "INSERT INTO tags(slug,label,normalized_label,kind,visibility,status,source_type,source_actor_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,'topic','public','active','manual',?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",
          [slug, label, label.toLowerCase(), admin.id],
        );
        const [[tag]] = await c.query<RowDataPacket[]>('SELECT id FROM tags WHERE slug=?', [slug]);
        const [[prior]] = await c.query<RowDataPacket[]>('SELECT status FROM blog_tags WHERE blog_id=? AND tag_id=? FOR UPDATE', [
          blogId,
          tag.id,
        ]);
        await c.execute(
          "INSERT INTO blog_tags(blog_id,tag_id,role,status,source_type,source_actor_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,'identity',?,'manual',?,UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP(),UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE status=VALUES(status),source_actor_id=VALUES(source_actor_id),updated_at=VALUES(updated_at)",
          [blogId, tag.id, payload.action === 'set' ? 'active' : 'rejected', admin.id],
        );
        await writeAudit(
          c,
          admin.id,
          'tags.manual',
          'blog',
          String(blogId),
          prior ? { tagId: tag.id, status: prior.status } : null,
          { tagId: tag.id, status: payload.action },
          payload.note,
        );
        return { ok: true, tagId: tag.id };
      }),
    );
  });
  app.get('/api/admin/relations', async (req) => {
    const q = object(req.query),
      postId = Number(q.sourcePostId || 0),
      cursor = String(q.cursor || '0:0');
    if (!Number.isSafeInteger(postId) || postId < 0 || !/^\d{1,10}:\d{1,10}$/.test(cursor)) invalid();
    const [afterPost, afterOrdinal] = cursor.split(':').map(Number);
    const [rows] = await config.pool.query<RowDataPacket[]>(
      'SELECT l.source_post_id sourcePostId,l.ordinal,l.target_url targetUrl,l.location,l.anchor_text anchorText,l.context contextSnippet,COALESCE(o.hidden,FALSE) hidden FROM relation_links l LEFT JOIN admin_relation_overrides o ON o.source_post_id=l.source_post_id AND o.target_url_hash=SHA2(l.target_url,256) AND BINARY o.target_url=BINARY l.target_url AND o.location=l.location WHERE (l.source_post_id>? OR l.source_post_id=? AND l.ordinal>?) AND (?=0 OR l.source_post_id=?) ORDER BY l.source_post_id,l.ordinal LIMIT 51',
      [afterPost, afterPost, afterOrdinal, postId, postId],
    );
    return {
      items: rows.slice(0, 50).map((r) => ({
        ...r,
        id: `${r.sourcePostId}:${r.ordinal}`,
        fingerprint: relationFingerprint(r.sourcePostId, r.targetUrl, r.location),
      })),
      nextCursor: rows.length > 50 ? `${rows[49].sourcePostId}:${rows[49].ordinal}` : null,
    };
  });
  app.post('/api/admin/relations', async (req) => {
    const b = object(req.body);
    if (typeof b.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(b.fingerprint) || typeof b.hidden !== 'boolean' || !note(b.reason))
      invalid();
    const sourcePostId = id(b.sourcePostId),
      targetUrl = typeof b.targetUrl === 'string' ? b.targetUrl : '',
      location = String(b.location || '');
    if (
      !sourcePostId ||
      targetUrl.length > 2048 ||
      !['body', 'sidebar', 'blogroll', 'comment'].includes(location) ||
      relationFingerprint(sourcePostId, targetUrl, location) !== b.fingerprint
    )
      invalid();
    const payload = { fingerprint: String(b.fingerprint), sourcePostId, targetUrl, location, hidden: b.hidden, reason: note(b.reason) };
    return mutate(req, 'relations.visibility', payload, async (admin) => {
      const result = await transaction(admin, async (c) => {
        const [links] = await c.query<RowDataPacket[]>(
          'SELECT source_post_id,target_url,location FROM relation_links WHERE source_post_id=? AND BINARY target_url=BINARY ? AND location=? LIMIT 1',
          [payload.sourcePostId, payload.targetUrl, payload.location],
        );
        const row = links[0];
        if (!row) invalid();
        const [[prior]] = await c.query<RowDataPacket[]>('SELECT hidden FROM admin_relation_overrides WHERE fingerprint=? FOR UPDATE', [
          payload.fingerprint,
        ]);
        await c.execute(
          'INSERT INTO admin_relation_overrides(fingerprint,source_post_id,target_url_hash,target_url,location,hidden,reason,actor_user_id,updated_at) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE hidden=VALUES(hidden),reason=VALUES(reason),actor_user_id=VALUES(actor_user_id),updated_at=VALUES(updated_at)',
          [
            payload.fingerprint,
            row.source_post_id,
            digest(row.target_url),
            row.target_url,
            row.location,
            payload.hidden,
            payload.reason,
            admin.id,
          ],
        );
        await writeAudit(
          c,
          admin.id,
          'relations.visibility',
          'relation',
          payload.fingerprint,
          prior ? { hidden: Boolean(prior.hidden) } : null,
          { hidden: payload.hidden },
          payload.reason,
        );
        return { ok: true };
      });
      await invalidateRelationCache(config.pool);
      return result;
    });
  });
  app.post('/api/admin/similarweb', async (req) => {
    const b = object(req.body),
      domain = typeof b.domain === 'string' ? normalizeSimilarDomain(b.domain) : null,
      kind = b.kind;
    if (!domain || !['traffic', 'similar_sites'].includes(String(kind))) invalid();
    if (!config.similarEnabled) throw Object.assign(Error('similarweb_disabled'), { statusCode: 409 });
    const payload = { domain: domain!, kind: kind as 'traffic' | 'similar_sites' };
    return mutate(
      req,
      'similarweb.submit',
      payload,
      async (admin, intentId) => {
        const store = mysqlSimilarwebStore(config.pool);
        if (!(await store.acquire())) return { status: 'busy' };
        try {
          const now = new Date();
          if (!(await store.verifiedDomains([payload.domain])).length) invalid();
          if (!(await store.beginRound(now))) return { status: 'scheduled_or_cooldown' };
          if (!(await store.reservePoll(payload.domain, now))) return { status: 'pending' };
          if (!(await store.reserveSubmission(payload.domain, payload.kind, now))) return { status: 'daily_limit_or_already_submitted' };
          if (!(await isAdmin(config.pool, admin, config.adminEmails)))
            throw Object.assign(Error('admin_access_revoked'), { statusCode: 403 });
          await transaction(admin, (c) =>
            writeAudit(c, admin.id, 'similarweb.submit.reserved', 'domain', payload.domain, null, { intentId, kind: payload.kind }),
          );
          let revoked = false;
          const client = createTagSimilarSitesClient({
            fetcher: async (input, init) => {
              if (!(await isAdmin(config.pool, admin, config.adminEmails))) {
                revoked = true;
                throw Error('admin_access_revoked');
              }
              return fetch(input, init);
            },
          });
          const result = await client.submit(payload.domain, payload.kind);
          if (revoked) throw Object.assign(Error('admin_access_revoked'), { statusCode: 403 });
          await recordExternalOutcome(config.pool, intentId, admin, payload.domain, result.status);
          await store.recordResult(payload.domain, result, new Date());
          if (['blocked', 'auth', 'error'].includes(result.status)) await store.cooldown(cooldownUntil(new Date(), result.nextAttemptAt));
          return { status: result.status };
        } finally {
          await store.release();
        }
      },
      true,
    );
  });
  // Whole tables for /admin/accounts/ and /admin/blogs/; both are small, so the browser sorts and filters.
  app.get('/api/admin/accounts', async (req) => {
    await actor(req);
    return adminAccounts(config.pool, config.adminEmails);
  });
  app.get('/api/admin/blogs', async (req) => {
    await actor(req);
    return adminBlogs(config.pool);
  });
  app.get('/api/admin/audits', async (req) => {
    const q = object(req.query),
      cursor = Number(q.cursor || 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) invalid();
    // Newest first, with who acted and which blog it was; the `.intent` bookkeeping rows beside each write are left out.
    const [rows] = await config.pool.query<RowDataPacket[]>(
      `SELECT a.id,a.actor_user_id actorUserId,u.name actorName,u.email actorEmail,a.action,a.entity_type entityType,a.entity_id entityId,
         b.name entityName,b.slug entitySlug,a.before_json beforeJson,a.after_json afterJson,a.note,a.created_at createdAt
       FROM admin_audits a LEFT JOIN users u ON u.id=a.actor_user_id
       LEFT JOIN blogs b ON a.entity_type='blog' AND b.id=CAST(a.entity_id AS UNSIGNED)
       WHERE (?=0 OR a.id<?) AND a.action NOT LIKE '%.intent' ORDER BY a.id DESC LIMIT 101`,
      [cursor, cursor],
    );
    return { items: rows.slice(0, 100), nextCursor: rows.length > 100 ? rows[99].id : null };
  });
}
