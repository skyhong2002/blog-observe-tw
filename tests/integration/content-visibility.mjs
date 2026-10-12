/** Public-content revocation acceptance. Fixtures are forbidden outside disposable 18169 databases. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { pathToFileURL } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../../app/src/db/schema.ts';
import { hashToken } from '../../app/src/auth/google-login.ts';
import { buildApp } from '../../app/src/app.js';
import { loadConfig } from '../../app/src/config.js';
import { digest, MATCHER_VERSION } from '../../app/src/topics/policy.ts';
import { assertEphemeralDatabase } from './guard.mjs';

export async function seedContentVisibility(pool) {
  assertEphemeralDatabase(pool);
  const marker = `visibility-${randomBytes(6).toString('hex')}`;
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  const published = new Date(now.getTime() - 3600_000);
  const fixture = {
    marker,
    blogs: [],
    posts: [],
    titles: [`${marker} private-article`, `${marker} unaffected-article`, `${marker} unaffected-target`],
    slugs: [`${marker}-source-a`, `${marker}-source-b`, `${marker}-source-c`],
    blogKeys: [`${marker}-blog-a`, `${marker}-blog-b`, `${marker}-blog-c`],
    topicKeys: [`${marker}-shared`, `${marker}-a-only`],
    topicIds: [digest(`${marker}-shared`), digest(`${marker}-a-only`)],
    tagId: 0,
    tagSlug: `${marker}-native`,
  };
  try {
    for (let i = 0; i < 3; i++) {
      const [blog] = await pool.execute(
        "INSERT INTO blogs(slug,name,url,status,discovered_at,last_published_at) VALUES(?,?,?,'verified',?,?)",
        [fixture.slugs[i], fixture.slugs[i], `https://${fixture.slugs[i]}.example/`, now, published],
      );
      fixture.blogs.push(blog.insertId);
      const hash = digest(`${marker}-${i}`);
      const [post] = await pool.execute(
        'INSERT INTO posts(blog_id,guid,url,title,summary,content_hash,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        [blog.insertId, `${marker}-${i}`, `https://${fixture.slugs[i]}.example/post`, fixture.titles[i], 'Public fixture summary', hash, published, now, now],
      );
      fixture.posts.push(post.insertId);
      for (const key of [fixture.blogKeys[i], fixture.slugs[i]])
        await pool.execute("INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES('blog',?,?,?)", [key, String(blog.insertId), now]);
      await pool.execute("INSERT INTO public_page_routes(kind,entity_id,canonical_key,created_at) VALUES('blog',?,?,?)", [String(blog.insertId), fixture.blogKeys[i], now]);
    }
    const snapshot = randomUUID();
    for (let t = 0; t < 2; t++) {
      await pool.execute(
        "INSERT INTO topic_pages(canonical_id,label,normalized_label,state,first_snapshot_id,last_snapshot_id,first_observed_at,last_observed_at,last_article_at,updated_at) VALUES(?,?,?,'active',?,?,?,?,?,?)",
        [fixture.topicIds[t], fixture.topicKeys[t], fixture.topicKeys[t], snapshot, snapshot, now, now, published, now],
      );
      for (const key of [fixture.topicKeys[t], `tag:${fixture.topicIds[t]}`])
        await pool.execute("INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES('topic',?,?,?)", [key, fixture.topicIds[t], now]);
      await pool.execute("INSERT INTO public_page_routes(kind,entity_id,canonical_key,created_at) VALUES('topic',?,?,?)", [fixture.topicIds[t], fixture.topicKeys[t], now]);
      for (const i of t === 0 ? [0, 1] : [0])
        await pool.execute(
          "INSERT INTO topic_article_evidence(canonical_id,post_id,source,state,source_snapshot_id,post_hash,matcher_version,first_observed_at,last_observed_at,checked_at,published_at) VALUES(?,?,'title','confirmed',?,?,?,?,?,?,?)",
          [fixture.topicIds[t], fixture.posts[i], snapshot, digest(`${marker}-${i}`), MATCHER_VERSION, now, now, now, published],
        );
    }
    const [tag] = await pool.execute(
      "INSERT INTO tags(slug,label,normalized_label,status,visibility,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,'active','public',?,?,?,?)",
      [fixture.tagSlug, fixture.tagSlug, fixture.tagSlug, now, now, now, now],
    );
    fixture.tagId = tag.insertId;
    for (const postId of fixture.posts)
      await pool.execute('INSERT INTO post_tags(post_id,tag_id,first_seen_at,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?)', [postId, fixture.tagId, now, now, now, now]);
    // A→B disappears with A; B→C proves an unrelated public edge remains.
    for (const i of [0, 1]) {
      await pool.execute(
        "INSERT INTO relation_observations(post_id,blog_id,status,parser_version,observed_at,last_success_at,next_attempt_at,published_at) VALUES(?,?,'ok','visibility-fixture',?,?,?,?)",
        [fixture.posts[i], fixture.blogs[i], now, now, now, published],
      );
      await pool.execute(
        "INSERT INTO relation_links(source_post_id,source_blog_id,ordinal,target_url,target_blog_id,target_post_id,anchor_text,context,location,observed_at,resolution_checked_at) VALUES(?,?,0,?,?,?,?,'fixture','body',?,?)",
        [fixture.posts[i], fixture.blogs[i], `https://${fixture.slugs[i + 1]}.example/post`, fixture.blogs[i + 1], fixture.posts[i + 1], fixture.slugs[i + 1], now, now],
      );
    }
    return fixture;
  } catch (error) {
    await cleanupContentVisibility(pool, fixture);
    throw error;
  }
}

export async function mutateContentVisibility(pool, fixture, action) {
  assertEphemeralDatabase(pool);
  if (['hide', 'seed', 'rejected', 'moved'].includes(action))
    await pool.execute('UPDATE blogs SET status=? WHERE id=?', [action === 'hide' ? 'seed' : action, fixture.blogs[0]]);
  else if (action === 'restore') await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [fixture.blogs[0]]);
  else if (action === 'delete') await pool.execute('DELETE FROM posts WHERE id=?', [fixture.posts[0]]);
  else throw Error('invalid_fixture_action');
  return performance.now();
}

export async function cleanupContentVisibility(pool, fixture) {
  assertEphemeralDatabase(pool);
  if (fixture.tagId) {
    await pool.execute('DELETE FROM post_tags WHERE tag_id=?', [fixture.tagId]);
    await pool.execute('DELETE FROM tags WHERE id=?', [fixture.tagId]);
  }
  for (const table of ['public_page_routes', 'public_route_keys']) {
    await pool.query(`DELETE FROM ${table} WHERE kind='topic' AND entity_id IN (?)`, [fixture.topicIds]);
    if (fixture.blogs.length) await pool.query(`DELETE FROM ${table} WHERE kind='blog' AND entity_id IN (?)`, [fixture.blogs.map(String)]);
  }
  await pool.query('DELETE FROM topic_article_evidence WHERE canonical_id IN (?)', [fixture.topicIds]);
  await pool.query('DELETE FROM topic_pages WHERE canonical_id IN (?)', [fixture.topicIds]);
  if (fixture.posts.length) {
    await pool.query('DELETE FROM relation_links WHERE source_post_id IN (?)', [fixture.posts]);
    await pool.query('DELETE FROM relation_observations WHERE post_id IN (?)', [fixture.posts]);
    await pool.query('DELETE FROM posts WHERE id IN (?)', [fixture.posts]);
  }
  if (fixture.blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [fixture.blogs]);
}

/** Safe for root's final Next/gateway pair: only local HTTP accepted; no production host option. */
export function visibilityHttpGet(origin, path, headers = {}) {
  const base = new URL(origin);
  assert.equal(base.protocol, 'http:');
  assert.equal(base.hostname, '127.0.0.1');
  assert.ok(path.startsWith('/') && !path.startsWith('//'));
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, base), { method: 'GET', timeout: 10000, headers }, (res) => {
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) res.destroy(Error('visibility_response_too_large'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8'), cacheControl: String(res.headers['cache-control'] || '') }));
    });
    req.on('timeout', () => req.destroy(Error('visibility_http_timeout')));
    req.on('error', reject);
    req.end();
  });
}

function containsArticleId(body, postId) {
  if (!postId) return false;
  let parsed;
  try { parsed = JSON.parse(body); } catch { return false; }
  const visit = (node) => {
    if (!node || typeof node !== 'object') return false;
    if (Number(node.postId) === postId || Number(node.sourcePostId) === postId) return true;
    if (Number(node.id) === postId && ('title' in node || 'guid' in node)) return true;
    return Object.values(node).some(visit);
  };
  return visit(parsed);
}

function probes(f) {
  const topic = encodeURIComponent(`tag:${f.topicIds[0]}`);
  const post = (name, path, unaffected = true) => ({ name, path, postId: f.posts[0], before: f.titles[0], absent: f.titles[0], unaffected: unaffected ? f.titles[1] : null, on: ['seed', 'rejected', 'moved', 'delete'] });
  const blog = (name, path, unaffected = true) => ({ name, path, before: f.slugs[0], absent: f.slugs[0], unaffected: unaffected ? f.slugs[1] : null, on: ['seed', 'rejected', 'moved'] });
  return [
    post('legacy-overview', '/api/overview'),
    { ...blog('legacy-relations', '/api/relations?days=90'), on: ['seed', 'rejected', 'moved', 'delete'] },
    { ...blog('v1-relations', '/api/v1/relations?hours=2160'), on: ['seed', 'rejected', 'moved', 'delete'] },
    blog('legacy-blog-relations', `/api/blogs/${f.slugs[0]}/relations?days=90`, false),
    blog('v1-blog-relations', `/api/v1/blogs/${f.slugs[0]}/relations?hours=2160`, false),
    { ...post('reader-rss', '/me/feed.xml'), postId: null, authenticated: true },
    blog('legacy-catalog', `/api/catalog?q=${f.marker}`),
    blog('legacy-blog-list', '/api/blogs?limit=200'),
    post('legacy-blog-detail', `/api/blogs/${f.slugs[0]}`, false),
    post('legacy-search', `/api/search?q=${f.marker}`),
    post('legacy-native-tag', `/api/tags/${f.tagSlug}`),
    post('legacy-topic-detail', `/api/topics/${topic}?days=90`),
    post('v1-articles', `/api/v1/articles?q=${f.marker}&hours=2160&limit=100`),
    blog('v1-blog-list', `/api/v1/blogs?q=${f.marker}&limit=100`),
    blog('v1-blog-detail', `/api/v1/blogs/${f.slugs[0]}`, false),
    post('v1-blog-articles', `/api/v1/blogs/${f.slugs[0]}/articles?hours=2160`, false),
    post('v1-topic-detail', `/api/v1/topics/${topic}?hours=2160`),
    { name: 'blog-page-registry', path: `/api/pages/blogs/${f.blogKeys[0]}`, before: f.blogKeys[0], absent: f.blogKeys[0], on: ['seed', 'rejected', 'moved'] },
    { name: 'topic-page-registry', path: `/api/pages/topics/${f.topicKeys[1]}`, before: f.topicKeys[1], absent: f.topicKeys[1], on: ['seed', 'rejected', 'moved', 'delete'] },
    { name: 'blogs-sitemap', path: '/sitemaps/blogs.xml', before: f.blogKeys[0], absent: f.blogKeys[0], unaffected: f.blogKeys[1], on: ['seed', 'rejected', 'moved'] },
    { name: 'topics-sitemap', path: '/sitemaps/topics.xml', before: f.topicKeys[1], absent: f.topicKeys[1], unaffected: f.topicKeys[0], on: ['seed', 'rejected', 'moved', 'delete'] },
  ];
}

export async function runContentVisibilityIntegration(pool) {
  assertEphemeralDatabase(pool);
  const [[statusColumn]] = await pool.query("SHOW COLUMNS FROM blogs LIKE 'status'");
  assert.match(String(statusColumn.Type), /^varchar\(32\)$/i, 'fixture requires blogs.status varchar(32)');
  const oldFlag = process.env.BLOG_TOPIC_HISTORY_READ_ENABLED;
  process.env.BLOG_TOPIC_HISTORY_READ_ENABLED = 'true';
  const fixture = await seedContentVisibility(pool);
  // This session exists only inside the disposable database; never output its token or secret.
  const session = randomBytes(32).toString('base64url');
  const secret = randomBytes(48).toString('base64url');
  const config = loadConfig({
    BLOG_DB_URL: process.env.BLOG_DB_URL,
    BLOG_UI_ORIGIN: 'http://127.0.0.1:9',
    BLOG_GOOGLE_CLIENT_ID: 'isolated-visibility-fixture',
    BLOG_GOOGLE_CLIENT_SECRET: 'isolated-unused-fixture',
    BLOG_SESSION_SECRET: secret,
  });
  let app;
  let userId = 0;
  const measurements = [];
  const unaffectedChecks = [];
  try {
    const now = new Date();
    const [user] = await pool.execute('INSERT INTO users(google_sub,email,created_at,last_login_at) VALUES(?,?,?,?)',
      [fixture.marker, `${fixture.marker}@example.invalid`, now, now]);
    userId = user.insertId;
    await pool.execute('INSERT INTO user_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',
      [hashToken(session, secret), userId, now, new Date(now.getTime() + 3600_000)]);
    for (const blogId of fixture.blogs)
      await pool.execute('INSERT INTO user_follows(user_id,blog_id,created_at) VALUES(?,?,?)', [userId, blogId, now]);
    app = await buildApp(config, { store: { pool, db: drizzle(pool, { schema, mode: 'default' }) } });
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const targets = probes(fixture);
    for (const [phaseIndex, action] of ['seed', 'rejected', 'moved', 'delete'].entries()) {
      // Independent anonymous clients avoid the real 60/minute API quota across four test phases.
      // The same client/URL warms and reads after each mutation; no authentication/cache-busting query on public probes.
      const anonymousHeaders = { 'cf-connecting-ip': `192.0.2.${phaseIndex + 1}` };
      const read = (p) => visibilityHttpGet(origin, p.path, { ...anonymousHeaders, ...(p.authenticated ? { cookie: `blog_session=${session}` } : {}) });
      const rssAnonymous = await visibilityHttpGet(origin, '/me/feed.xml', anonymousHeaders);
      assert.equal(rssAnonymous.status, 401, 'RSS is reader-private, not a public endpoint');
      assert.match(rssAnonymous.cacheControl, /no-store/);
      for (let round = 0; round < 2; round++) {
        for (const p of targets) {
          const r = await read(p);
          assert.equal(r.status, 200, `warm ${action} ${p.name}`);
          assert.ok(r.body.includes(p.before), `warm missing ${action} ${p.name}`);
          if (p.postId) assert.ok(containsArticleId(r.body, p.postId), `warm missing article ID ${action} ${p.name}`);
          assert.match(r.cacheControl, /(?:^|,)\s*no-store(?:,|$)/, `warm ${action} ${p.name} must bypass cache`);
          if (p.unaffected) assert.ok(r.body.includes(p.unaffected), `warm unaffected missing ${action} ${p.name}`);
          if (['legacy-relations', 'v1-relations'].includes(p.name)) {
            const edges = JSON.parse(r.body).edges;
            for (const i of [0, 1])
              assert.ok(edges.some((e) => e.sourceBlogId === fixture.blogs[i] && e.targetBlogId === fixture.blogs[i + 1] && e.count > 0), `warm missing relation ${p.name}`);
          }
        }
      }
      const changedAt = await mutateContentVisibility(pool, fixture, action);
      // No polling, retries, grace period, or cache invalidation: the FIRST read after commit must be clean.
      for (const p of targets.filter((p) => p.on.includes(action))) {
        const response = await read(p);
        assert.ok([200, 404, 410].includes(response.status), `${action} ${p.name} unexpected HTTP ${response.status}`);
        assert.ok(!response.body.includes(p.absent), `${action} ${p.name} first read leaked removed text`);
        assert.ok(!containsArticleId(response.body, p.postId), `${action} ${p.name} first read leaked removed article ID`);
        if (p.unaffected) {
          assert.equal(response.status, 200, `${action} ${p.name} removed unaffected container`);
          assert.ok(response.body.includes(p.unaffected), `${action} ${p.name} removed unaffected item`);
        }
        if (['legacy-relations', 'v1-relations'].includes(p.name)) {
          const edges = JSON.parse(response.body).edges;
          assert.ok(!edges.some((e) => e.sourceBlogId === fixture.blogs[0] || e.targetBlogId === fixture.blogs[0]), `${action} ${p.name} retained A relation IDs`);
          assert.ok(edges.some((e) => e.sourceBlogId === fixture.blogs[1] && e.targetBlogId === fixture.blogs[2] && e.count > 0), `${action} ${p.name} removed B-C relation`);
        }
        assert.match(response.cacheControl, /(?:^|,)\s*no-store(?:,|$)/, `${action} ${p.name} must bypass shared/browser cache`);
        measurements.push({ action, layer: p.name, reader: p.authenticated ? 'authenticated-reader' : 'anonymous', firstRead: true,
          batchElapsedMs: Math.ceil(performance.now() - changedAt), status: response.status, cacheControl: response.cacheControl });
      }
      const intact = await visibilityHttpGet(origin, `/api/blogs/${fixture.slugs[1]}`, anonymousHeaders);
      assert.equal(intact.status, 200);
      assert.ok(intact.body.includes(fixture.titles[1]), `${action} unaffected B article missing`);
      const ledger = await pool.query('SELECT state FROM topic_article_evidence WHERE post_id=?', [fixture.posts[0]]);
      assert.ok(ledger[0].every((row) => row.state === 'confirmed'), 'visibility reads must not permanently revoke ledger evidence');
      unaffectedChecks.push({ action, blogB: true, sharedTopic: true, unrelatedRelation: true, ledgerUnmodified: true });
      if (action !== 'delete') {
        await mutateContentVisibility(pool, fixture, 'restore');
        const restored = await visibilityHttpGet(origin, `/api/topics/${encodeURIComponent(`tag:${fixture.topicIds[0]}`)}?days=90`, anonymousHeaders);
        assert.equal(restored.status, 200);
        assert.ok(restored.body.includes(fixture.titles[0]), 'restored evidence must recover on the next read');
      }
    }
    return { isolatedPort: 18169, blogStatusType: statusColumn.Type, transport: 'real-loopback-http', warmedTwicePerMutation: true,
      requirement: 'first anonymous read after mutation commit; no retry or grace period', measurements, unaffectedChecks,
      maxBatchElapsedMs: Math.max(...measurements.map((m) => m.batchElapsedMs)),
      rss: { anonymous: '401/no-store', reader: 'separate authenticated fixture; not a public feed' },
      moved: 'No explicit relocation target exists in this fixture; old data must disappear. Alias-to-public-target behavior belongs to redirect tests.',
      unmeasuredLayers: ['Next HTML/RSC covered by root preview', 'Cloudflare cannot front this private isolated fixture'] };
  } finally {
    await app?.close();
    if (userId) {
      await pool.execute('DELETE FROM user_follows WHERE user_id=?', [userId]);
      await pool.execute('DELETE FROM user_sessions WHERE user_id=?', [userId]);
      await pool.execute('DELETE FROM users WHERE id=?', [userId]);
    }
    await cleanupContentVisibility(pool, fixture);
    if (oldFlag === undefined) delete process.env.BLOG_TOPIC_HISTORY_READ_ENABLED;
    else process.env.BLOG_TOPIC_HISTORY_READ_ENABLED = oldFlag;
  }
}

// Standalone targeted runner. It always creates/drops a fresh disposable database; never uses the env's database.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { lstat, readdir, readFile } = await import('node:fs/promises');
  const { basename, resolve } = await import('node:path');
  const { parseEnv } = await import('node:util');
  const { default: mysql } = await import('mysql2/promise');
  const { createDb, parseDbUrl } = await import('../../app/src/db/client.ts');
  const name = `blog_observe_integration_${randomBytes(12).toString('hex')}`;
  let control;
  let store;
  let created = false;
  let phase = 'config';
  try {
    assert.equal(process.argv.length, 4);
    assert.equal(process.argv[2], '--env-file');
    const file = resolve(process.argv[3]);
    assert.ok(!['.env', '.env.production'].includes(basename(file)));
    const stat = await lstat(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o077) && stat.uid === process.getuid());
    const url = new URL(parseEnv(await readFile(file, 'utf8')).BLOG_DB_URL);
    assert.equal(url.protocol, 'mysql:');
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(url.port, '18169');
    assert.equal(url.search + url.hash, '');
    control = await mysql.createConnection({ ...parseDbUrl(url.href), database: undefined, charset: 'utf8mb4' });
    await control.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    url.pathname = `/${name}`;
    process.env.BLOG_DB_URL = url.href;
    store = createDb(url.href, { poolSize: 4 });
    phase = 'migrations';
    for (const sql of (await readFile(new URL('../../db/001_init.sql', import.meta.url), 'utf8')).split(';').map((s) => s.trim()).filter(Boolean)) await store.pool.query(sql);
    const dir = new URL('../../app/src/db/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.startsWith('0000_')).sort())
      for (const sql of (await readFile(new URL(file, dir), 'utf8')).split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean)) await store.pool.query(sql);
    globalThis.fetch = async () => { throw Error('external_network_forbidden'); };
    phase = 'content-visibility';
    console.log(JSON.stringify({ passed: true, result: await runContentVisibilityIntegration(store.pool) }));
  } catch (error) {
    const message = typeof error?.message === 'string' && /^(warm |warm missing |warm unaffected |seed |rejected |moved |hide |delete |visibility deadline|restored )/.test(error.message) ? error.message : undefined;
    console.error(JSON.stringify({ passed: false, phase, code: /^[A-Z_0-9]{1,60}$/.test(error?.code || '') ? error.code : 'VISIBILITY_TEST_FAILED', message }));
    process.exitCode = 1;
  } finally {
    await store?.close();
    if (created) await control.query(`DROP DATABASE \`${name}\``);
    await control?.end();
  }
}
