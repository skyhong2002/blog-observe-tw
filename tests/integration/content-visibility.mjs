/** Public-content revocation acceptance. Fixtures are forbidden outside disposable 18169 databases. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
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
    titles: [`${marker} private-article`, `${marker} unaffected-article`],
    slugs: [`${marker}-source-a`, `${marker}-source-b`],
    blogKeys: [`${marker}-blog-a`, `${marker}-blog-b`],
    topicKeys: [`${marker}-shared`, `${marker}-a-only`],
    topicIds: [digest(`${marker}-shared`), digest(`${marker}-a-only`)],
    tagId: 0,
    tagSlug: `${marker}-native`,
  };
  try {
    for (let i = 0; i < 2; i++) {
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
    return fixture;
  } catch (error) {
    await cleanupContentVisibility(pool, fixture);
    throw error;
  }
}

export async function mutateContentVisibility(pool, fixture, action) {
  assertEphemeralDatabase(pool);
  if (action === 'hide') await pool.execute("UPDATE blogs SET status='seed' WHERE id=?", [fixture.blogs[0]]);
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
  if (fixture.posts.length) await pool.query('DELETE FROM posts WHERE id IN (?)', [fixture.posts]);
  if (fixture.blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [fixture.blogs]);
}

/** Safe for root's final Next/gateway pair: only local HTTP accepted; no production host option. */
export function visibilityHttpGet(origin, path) {
  const base = new URL(origin);
  assert.equal(base.protocol, 'http:');
  assert.equal(base.hostname, '127.0.0.1');
  assert.ok(path.startsWith('/') && !path.startsWith('//'));
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, base), { method: 'GET', timeout: 10000 }, (res) => {
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
  const post = (name, path, unaffected = true) => ({ name, path, postId: f.posts[0], before: f.titles[0], absent: f.titles[0], unaffected: unaffected ? f.titles[1] : null, on: ['hide', 'delete'] });
  const blog = (name, path, unaffected = true) => ({ name, path, before: f.slugs[0], absent: f.slugs[0], unaffected: unaffected ? f.slugs[1] : null, on: ['hide'] });
  return [
    post('legacy-overview', '/api/overview'),
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
    { name: 'blog-page-registry', path: `/api/pages/blogs/${f.blogKeys[0]}`, before: f.blogKeys[0], absent: f.blogKeys[0], on: ['hide'] },
    { name: 'topic-page-registry', path: `/api/pages/topics/${f.topicKeys[1]}`, before: f.topicKeys[1], absent: f.topicKeys[1], on: ['hide', 'delete'] },
    { name: 'blogs-sitemap', path: '/sitemaps/blogs.xml', before: f.blogKeys[0], absent: f.blogKeys[0], unaffected: f.blogKeys[1], on: ['hide'] },
    { name: 'topics-sitemap', path: '/sitemaps/topics.xml', before: f.topicKeys[1], absent: f.topicKeys[1], unaffected: f.topicKeys[0], on: ['hide', 'delete'] },
  ];
}

export async function runContentVisibilityIntegration(pool) {
  assertEphemeralDatabase(pool);
  const oldFlag = process.env.BLOG_TOPIC_HISTORY_READ_ENABLED;
  process.env.BLOG_TOPIC_HISTORY_READ_ENABLED = 'true';
  const fixture = await seedContentVisibility(pool);
  const config = loadConfig({ BLOG_DB_URL: process.env.BLOG_DB_URL, BLOG_UI_ORIGIN: 'http://127.0.0.1:9' });
  let app;
  const measurements = [];
  try {
    app = await buildApp(config, { store: { pool } });
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const targets = probes(fixture);
    for (let round = 0; round < 2; round++)
      for (const p of targets) {
        const r = await visibilityHttpGet(origin, p.path);
        assert.equal(r.status, 200, `warm ${p.name}`);
        assert.ok(r.body.includes(p.before), `warm missing ${p.name}`);
        if (p.postId) assert.ok(containsArticleId(r.body, p.postId), `warm missing article ID ${p.name}`);
        assert.match(r.cacheControl, /(?:^|,)\s*no-store(?:,|$)/, `warm ${p.name} must bypass cache`);
        if (p.unaffected) assert.ok(r.body.includes(p.unaffected), `warm unaffected missing ${p.name}`);
      }
    for (const action of ['hide', 'delete']) {
      const changedAt = await mutateContentVisibility(pool, fixture, action);
      const pending = new Map(targets.filter((p) => p.on.includes(action)).map((p) => [p.name, p]));
      while (pending.size && performance.now() - changedAt < 60_000) {
        for (const [name, p] of pending) {
          const response = await visibilityHttpGet(origin, p.path);
          assert.ok([200, 404, 410].includes(response.status), `${action} ${name} unexpected HTTP ${response.status}`);
          if (response.body.includes(p.absent) || containsArticleId(response.body, p.postId)) continue;
          if (p.unaffected) {
            assert.equal(response.status, 200, `${action} ${name} removed unaffected container`);
            assert.ok(response.body.includes(p.unaffected), `${action} ${name} removed unaffected item`);
          }
          // No cache layer may add a freshness/stale allowance beyond the removal deadline.
          assert.match(response.cacheControl, /(?:^|,)\s*no-store(?:,|$)/, `${action} ${name} must bypass shared/browser cache`);
          measurements.push({ action, layer: name, elapsedMs: Math.ceil(performance.now() - changedAt), status: response.status, cacheControl: response.cacheControl });
          pending.delete(name);
        }
        if (pending.size) await delay(1000);
      }
      assert.equal(pending.size, 0, `visibility deadline exceeded: ${[...pending.keys()].join(',')}`);
      if (action === 'hide') {
        await mutateContentVisibility(pool, fixture, 'restore');
        const restored = await visibilityHttpGet(origin, `/api/topics/${encodeURIComponent(`tag:${fixture.topicIds[0]}`)}?days=90`);
        assert.equal(restored.status, 200);
        assert.ok(restored.body.includes(fixture.titles[0]), 'restored evidence must recover without a negative cache');
        // Warm every deletion probe again after restoring A. A cached masked response must not make deletion falsely pass.
        for (const p of targets.filter((p) => p.on.includes('delete'))) {
          const rewarmed = await visibilityHttpGet(origin, p.path);
          assert.equal(rewarmed.status, 200, `restored ${p.name}`);
          assert.ok(rewarmed.body.includes(p.before), `restored ${p.name} did not recover`);
          if (p.postId) assert.ok(containsArticleId(rewarmed.body, p.postId), `restored ${p.name} missing article ID`);
        }
      }
    }
    return { isolatedPort: 18169, transport: 'real-loopback-http', warmedTwice: true, measurements, maxElapsedMs: Math.max(...measurements.map((m) => m.elapsedMs)), unmeasuredLayers: ['Next SSR/RSC preview requires final build', 'Cloudflare cannot front this private isolated fixture'] };
  } finally {
    await app?.close();
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
    const message = typeof error?.message === 'string' && /^(warm |warm missing |warm unaffected |hide |delete |visibility deadline|restored )/.test(error.message) ? error.message : undefined;
    console.error(JSON.stringify({ passed: false, phase, code: /^[A-Z_0-9]{1,60}$/.test(error?.code || '') ? error.code : 'VISIBILITY_TEST_FAILED', message }));
    process.exitCode = 1;
  } finally {
    await store?.close();
    if (created) await control.query(`DROP DATABASE \`${name}\``);
    await control?.end();
  }
}
