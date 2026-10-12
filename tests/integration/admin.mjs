import { assertEphemeralDatabase } from './guard.mjs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../../app/src/db/schema.ts';
import { dbLoginStore } from '../../app/src/auth/store.ts';
import { hashToken, readCookie, SESSION_COOKIE } from '../../app/src/auth/google-login.ts';
import { registerAdminRoutes } from '../../app/src/admin/routes.ts';
import { beginIntent, recordExternalOutcome } from '../../app/src/admin/intent.ts';
import { isAdmin, requireAdminTransaction } from '../../app/src/admin/identity.ts';
export async function runAdminIntegration(pool) {
  assertEphemeralDatabase(pool);
  assert.equal(new URL(process.env.BLOG_DB_URL).port, '18169');
  assert.equal(new URL(process.env.BLOG_DB_URL).hostname, '127.0.0.1');
  assert.equal(pool.pool.config.connectionConfig.port, 18169);
  const db = { db: drizzle(pool, { schema, mode: 'default' }) },
    suffix = Date.now().toString(36),
    emails = new Set([`admin-${suffix}@example.invalid`]),
    secret = 'clone-admin-test-only-secret'.repeat(3),
    origin = 'https://blog.observe.tw';
  const users = [],
    blogs = [],
    posts = [],
    candidates = [],
    tags = [];
  const app = Fastify();
  let checks = 0;
  const check = (v, message) => {
    assert.ok(v, message);
    checks++;
  };
  const identity = { sub: `test-admin-${suffix}`, email: [...emails][0], name: 'Test admin', picture: null, emailVerified: true };
  const store = dbLoginStore(db.db, { pool, adminEmails: emails });
  const home = `https://admin-personal-${suffix}.example/`;
  const crawlOptions = {
    delayMs: 250,
    resolveHost: async () => ['93.184.216.34'],
    fetcher: async (input) => {
      const url = String(input);
      if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      if (url === home)
        return new Response(
          '<title>Quill Writer</title><meta name="description" content="My personal blog. About me: I am Quill Writer."><link rel="alternate" type="application/rss+xml" href="/feed/">',
          { headers: { 'content-type': 'text/html' } },
        );
      if (url === home + 'feed/')
        return new Response(
          `<rss><channel><title>Quill Writer</title><link>${home}</link><item><title>Reflection</title><guid>${home}post</guid><link>${home}post</link></item></channel></rss>`,
        );
      return new Response(null, { status: 404 });
    },
  };
  try {
    const uid = await store.upsertUser(identity, new Date());
    users.push(uid);
    check(await isAdmin(pool, { id: uid, sub: identity.sub }, emails), 'bootstrap pin');
    const other = await store.upsertUser({ ...identity, sub: `other-${suffix}` }, new Date());
    users.push(other);
    check(!(await isAdmin(pool, { id: other, sub: `other-${suffix}` }, emails)), 'sameemail diffsub denied');
    await pool.execute("UPDATE users SET role='reader' WHERE id=?", [uid]);
    await store.upsertUser(identity, new Date());
    check(!(await isAdmin(pool, { id: uid, sub: identity.sub }, emails)), 'revoked not regrant');
    await pool.execute("UPDATE users SET role='admin' WHERE id=?", [uid]);
    const cookie = `admin-session-${suffix}`,
      readerCookie = `reader-session-${suffix}`;
    await store.createSession(hashToken(cookie, secret), uid, new Date(Date.now() + 3600000));
    await store.createSession(hashToken(readerCookie, secret), other, new Date(Date.now() + 3600000));
    const login = {
      currentUser: async (req) => {
        const value = readCookie(req, SESSION_COOKIE);
        return value ? store.sessionUser(hashToken(value, secret), new Date()) : null;
      },
    };
    registerAdminRoutes(app, {
      pool,
      login,
      publicOrigin: origin,
      sessionSecret: secret,
      adminEmails: emails,
      similarEnabled: false,
      crawlOptions,
    });
    app.get('/admin', async () => ({ ok: true }));
    check((await app.inject('/admin')).statusCode === 302, 'anonymous admin redirect');
    check((await app.inject('/api/admin/session')).statusCode === 401, 'anonymous API denied');
    check((await app.inject({ url: '/admin', headers: { cookie: `blog_session=${readerCookie}` } })).statusCode === 403, 'reader denied');
    const session = await app.inject({ url: '/api/admin/session', headers: { cookie: `blog_session=${cookie}` } });
    check(session.statusCode === 200, 'admin session');
    check(session.headers['cache-control'] === 'no-store', 'no-store');
    const csrf = session.json().csrfToken;
    const headers = { cookie: `blog_session=${cookie}`, origin, 'x-blog-csrf': csrf };
    const post = (url, body, key = randomUUID()) =>
      app.inject({ method: 'POST', url, headers: { ...headers, 'idempotency-key': key }, payload: body });
    check(
      (await app.inject({ method: 'POST', url: '/api/admin/tags', headers: { cookie: `blog_session=${cookie}` }, payload: {} }))
        .statusCode === 403,
      'missingorigin denied',
    );
    emails.clear();
    check((await store.sessionUser(hashToken(cookie, secret), new Date())).role === 'reader', 'allowlist removal effective role');
    check((await app.inject({ url: '/api/admin/session', headers })).statusCode === 403, 'allowlist removal guard');
    emails.add(identity.email);
    const [blog] = await pool.execute(
      "INSERT INTO blogs(slug,name,url,status,status_label,discovered_at) VALUES (?,? ,?,'verified','fixture',UTC_TIMESTAMP())",
      [`admin-fixture-${suffix}`, 'Admin fixture', `https://parent-${suffix}.example/`],
    );
    blogs.push(blog.insertId);
    const key = randomUUID(),
      tagPayload = { blogId: blog.insertId, label: `Admin fixture ${suffix}`, action: 'set', note: 'fixture' };
    const tagged = await post('/api/admin/tags', tagPayload, key);
    check(tagged.statusCode === 200, tagged.body);
    tags.push(tagged.json().tagId);
    check((await post('/api/admin/tags', tagPayload, key)).statusCode === 200, 'idempotent repeat');
    check((await post('/api/admin/tags', { ...tagPayload, action: 'remove' }, key)).statusCode === 409, 'idempotency conflict');
    const [[intentAudit]] = await pool.query("SELECT COUNT(*) n FROM admin_audits WHERE actor_user_id=? AND action='tags.manual'", [uid]);
    check(intentAudit.n === 1, 'one mutation audit');

    const concurrentKey = randomUUID(),
      concurrentPayload = { ...tagPayload, label: `Concurrent ${suffix}` };
    const concurrent = await Promise.all([
      post('/api/admin/tags', concurrentPayload, concurrentKey),
      post('/api/admin/tags', concurrentPayload, concurrentKey),
    ]);
    check(
      concurrent.every((r) => [200, 409].includes(r.statusCode)),
      'concurrent same key no500',
    );
    const concurrentOk = concurrent.find((r) => r.statusCode === 200);
    check(Boolean(concurrentOk), 'one concurrent success');
    tags.push(concurrentOk.json().tagId);
    const [[concurrentAudit]] = await pool.query("SELECT COUNT(*) n FROM admin_audits WHERE actor_user_id=? AND action='tags.manual'", [
      uid,
    ]);
    check(concurrentAudit.n === 2, 'concurrent action exactly once');
    const override = { classification: 'uncertain', confidence: 0, quotedEvidence: [], bio: '管理者修訂簡介', topics: ['生活'] };
    check(
      (await post('/api/admin/ai-override', { entityType: 'blog', entityId: blog.insertId, task: 'profile', result: override }))
        .statusCode === 200,
      'AI override',
    );
    check(
      (await post('/api/admin/ai-override', { entityType: 'candidate', entityId: 1, task: 'classification', result: override }))
        .statusCode === 400,
      'classification override prohibited',
    );
    const [p] = await pool.execute('INSERT INTO posts(blog_id,guid,url,title,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP())', [
      blog.insertId,
      'fixture',
      `https://parent-${suffix}.example/post`,
      'fixture',
    ]);
    posts.push(p.insertId);
    await pool.execute(
      "INSERT INTO relation_links(source_post_id,source_blog_id,ordinal,target_url,anchor_text,context,location,observed_at,resolution_checked_at) VALUES (?,?,1,?,'Link','Context','body',UTC_TIMESTAMP(),UTC_TIMESTAMP())",
      [p.insertId, blog.insertId, 'https://target.example/中文/'],
    );
    const links = await app.inject({ url: `/api/admin/relations?sourcePostId=${p.insertId}`, headers });
    check(links.statusCode === 200, links.body);
    const link = links.json().items[0];
    check(Boolean(link.fingerprint), 'stable fingerprint');
    check((await post('/api/admin/relations', { ...link, hidden: true, reason: 'fixture' })).statusCode === 200, 'hide');
    check((await post('/api/admin/relations', { ...link, hidden: false, reason: 'restore' })).statusCode === 200, 'unhide');
    const [cand] = await pool.execute(
      "INSERT INTO discovery_candidates(url,name,source_type,source_evidence,status,discovered_at) VALUES (?,'Quill Writer','blogroll',?,'rejected',UTC_TIMESTAMP())",
      [home, JSON.stringify({ discoveryDepth: 1 })],
    );
    candidates.push(cand.insertId);
    await pool.execute(
      "INSERT INTO discovery_candidate_audits(candidate_id,action,source_type,occurred_at,created_at) VALUES (?,'reject','human-review',UTC_TIMESTAMP(),UTC_TIMESTAMP())",
      [cand.insertId],
    );
    const approval = await post('/api/admin/discovery/review', { ids: [cand.insertId], action: 'approve', note: 'explicit re-review' });
    check(approval.statusCode === 200, approval.body);
    check(approval.json().results[0].created, 'approved realverified prior rejected');
    blogs.push(approval.json().results[0].blogId);

    const rejectedApproved = await post('/api/admin/discovery/review', { ids: [cand.insertId], action: 'reject' });
    check(rejectedApproved.statusCode === 200, 'reject approved request');
    check(rejectedApproved.json().results[0].status === 'decision-changed', 'approved cannot reject');
    const [[stillApproved]] = await pool.query('SELECT status FROM discovery_candidates WHERE id=?', [cand.insertId]);
    check(stillApproved.status === 'approved', 'approved status retained');
    const list = await app.inject({ url: '/api/admin/discovery?q=Quill&status=approved', headers });
    check(list.statusCode === 200, list.body);
    check((await app.inject({ url: '/api/admin/audits', headers })).statusCode === 200, 'audit list');
    check(
      (await post('/api/admin/similarweb', { domain: 'example.com', kind: 'traffic' })).statusCode === 409,
      'disabled Similarweb no I/O',
    );

    const externalIntent = await beginIntent(
      pool,
      { id: uid, sub: identity.sub },
      emails,
      randomUUID(),
      'similarweb.submit',
      { domain: 'example.com', kind: 'traffic' },
      true,
    );
    await pool.execute("UPDATE users SET role='reader' WHERE id=?", [uid]);
    await recordExternalOutcome(pool, externalIntent.id, { id: uid, sub: identity.sub }, 'example.com', 'pending');
    const [[externalAudit]] = await pool.query(
      "SELECT COUNT(*) n FROM admin_audits WHERE actor_user_id=? AND action='similarweb.submit.outcome'",
      [uid],
    );
    check(externalAudit.n === 1, 'externally completed action audited after revocation');
    const [indexes] = await pool.query('SHOW INDEX FROM tags');
    check(!indexes.some((i) => i.Column_name === 'normalized_label' && i.Non_unique === 0), 'normalized label not unique');
    const [pins] = await pool.query('SHOW INDEX FROM admin_google_identities');
    check(
      ['user_id', 'email', 'google_sub'].every((field) => pins.some((i) => i.Column_name === field && i.Non_unique === 0)),
      'three pin unique constraints',
    );
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      await pool.execute("UPDATE users SET role='reader' WHERE id=?", [uid]);
      await assert.rejects(() => requireAdminTransaction(c, { id: uid, sub: identity.sub }, emails), /revoked/);
      checks++;
      await c.rollback();
    } finally {
      c.release();
    }
    check((await app.inject({ url: '/api/admin/session', headers })).statusCode === 403, 'revocation immediate with same cookie');
    const result = {
      checks,
      concurrentSameKeyExactlyOnce: true,
      externalResultAuditedAfterRevoke: true,
      approvedRejectPreserved: true,
      schemaAssumptionsChecked: true,
      bootstrapPinned: true,
      emailReuseDenied: true,
      revocationImmediate: true,
      allowlistFailClosed: true,
      csrf: true,
      idempotency: true,
      realCandidateApproval: true,
      unicodeRelationFingerprint: true,
      audit: true,
    };
    return result;
  } finally {
    await app.close();
    if (posts.length) {
      await pool.query('DELETE FROM admin_relation_overrides WHERE source_post_id IN (?)', [posts]);
      await pool.query('DELETE FROM relation_links WHERE source_post_id IN (?)', [posts]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    }
    if (blogs.length) {
      await pool.query("DELETE FROM ai_overrides WHERE entity_type='blog' AND entity_id IN (?)", [blogs]);
      await pool.query('DELETE FROM blog_tags WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM feed_sources WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM blog_urls WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM relation_publications WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
    }
    if (tags.length) await pool.query('DELETE FROM tags WHERE id IN (?)', [tags]);
    if (candidates.length) {
      await pool.query('DELETE FROM discovery_candidate_audits WHERE candidate_id IN (?)', [candidates]);
      await pool.query('DELETE FROM discovery_candidates WHERE id IN (?)', [candidates]);
    }
    if (users.length) {
      await pool.query('DELETE FROM admin_intents WHERE actor_user_id IN (?)', [users]);
      await pool.query('DELETE FROM admin_audits WHERE actor_user_id IN (?)', [users]);
      await pool.query('DELETE FROM admin_google_identities WHERE user_id IN (?)', [users]);
      await pool.query('DELETE FROM user_sessions WHERE user_id IN (?)', [users]);
      await pool.query('DELETE FROM users WHERE id IN (?)', [users]);
    }
  }
}
