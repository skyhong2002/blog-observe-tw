/** Deterministic post-commit visibility acceptance. No sleeps, polling, retries or TTL grace. */
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/mysql2';
import { buildApp } from '../../app/src/app.js';
import { loadConfig } from '../../app/src/config.js';
import * as schema from '../../app/src/db/schema.ts';
import { TopicResponseCache } from '../../app/src/topics/cache.ts';
import { cleanupContentVisibility, seedContentVisibility, visibilityHttpGet } from './content-visibility.mjs';
import { assertEphemeralDatabase } from './guard.mjs';

const moduleRoot = fileURLToPath(new URL('../../', import.meta.url));
/** Source-only fingerprint; excludes configuration, review packets, secrets and generated build output. */
export async function barrierSourceTreeHash() {
  const hash = createHash('sha256');
  async function walk(directory) {
    for (const entry of (await readdir(new URL(directory, moduleRootURL), { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = directory + entry.name;
      if (entry.isDirectory()) {
        if (path !== 'app/src/db/migrations/meta') await walk(path + '/');
      } else if (entry.isFile() && /\.(?:js|mjs|ts|json|sql)$/.test(entry.name)) {
        hash.update(path + '\0');
        hash.update(await readFile(new URL(path, moduleRootURL)));
        hash.update('\0');
      }
    }
  }
  const moduleRootURL = new URL('../../', import.meta.url);
  await walk('app/src/');
  await walk('app/data/');
  return hash.digest('hex');
}

function safeProvenance(input) {
  assert.match(input?.releaseSHA ?? '', /^[a-f0-9]{40}$/, 'releaseSHA required');
  assert.match(input?.sourceTreeHash ?? '', /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/, 'sourceTreeHash required');
  assert.ok(
    input.nextBuildId === null || /^[a-zA-Z0-9_-]{1,200}$/.test(input.nextBuildId),
    'Next BUILD_ID or explicit API-only null required',
  );
  return {
    releaseSHA: input.releaseSHA,
    nextBuildId: input.nextBuildId,
    sourceTreeHash: input.sourceTreeHash,
    sourceTreeHashAlgorithm: input.sourceTreeHash.length === 40 ? 'git-tree-sha1' : 'runtime-source-sha256',
  };
}

/** Proxy intercepts the real SELECT result before handing it to its loader, never merely onSend. */
function observedPool(pool, context, event, current) {
  const wrap = (target) =>
    new Proxy(target, {
      get(object, key) {
        if (key === 'getConnection') return async () => wrap(await object.getConnection());
        if (key === 'query' || key === 'execute')
          return async (...args) => {
            const result = await object[key](...args);
            const info = context.getStore();
            const state = current();
            if (state && /^\s*(?:SELECT|WITH)\b/i.test(String(args[0]))) {
              const rows = Array.isArray(result[0]) ? result[0] : [];
              const queryHash = createHash('sha256').update(String(args[0]).replace(/\s+/g, ' ').trim()).digest('hex');
              event('sql-result', {
                requestId: info?.id ?? null,
                requestStartedSequence: info?.sequence ?? null,
                requestPath: info?.path ?? null,
                correlation: info?.correlation ?? null,
                queryHash,
                rows: rows.length,
              });
              if (!state.claimed && state.matches(String(args[0]), rows)) {
                state.matchCount++;
                if (state.matchCount === state.ordinal) {
                  state.claimed = true;
                  state.hit = event('A.sql-old-value-captured', {
                    requestId: info?.id ?? null,
                    queryClass: state.queryClass,
                    queryHash,
                    correlation: info?.correlation ?? null,
                    capturedResultHash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
                  });
                  state.entered.resolve();
                  await state.release.promise;
                  event('A.sql-result-released', { requestId: info?.id ?? null });
                }
              }
            }
            return result;
          };
        const value = Reflect.get(object, key, object);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
  return wrap(pool);
}

function surfaces(f, withWeb) {
  const articleRows = (_sql, rows) => rows.some((r) => r.title === f.titles[0] || r.postTitle === f.titles[0] || r.latestPostTitle === f.titles[0]);
  const relationRows = (sql, rows) => sql.includes('sourceBlogId') && rows.some((r) => Number(r.sourceBlogId) === f.blogs[0]);
  const topicRows = (sql, rows) => sql.includes("r.kind='topic'") && rows.some((r) => r.entity_id === f.topicIds[1]);
  const result = [
    { name: 'api-overview', path: '/api/overview', matches: articleRows, needle: f.titles[0], unaffected: f.titles[1] },
    {
      name: 'api-topic',
      path: `/api/topics/${encodeURIComponent('tag:' + f.topicIds[0])}?days=90`,
      matches: articleRows,
      needle: f.titles[0],
      unaffected: f.titles[1],
    },
    {
      name: 'api-relations',
      path: '/api/relations?days=90',
      matches: relationRows,
      needle: f.slugs[0],
      unaffected: f.slugs[1],
      graph: true,
    },
    // The first registry read is the preliminary counts lookup. The second feeds this XML's own loader.
    {
      name: 'blogs-sitemap',
      path: '/sitemaps/blogs.xml',
      matches: (sql, rows) => sql.includes("r.kind='blog'") && rows.some((r) => r.entity_id === String(f.blogs[0])),
      ordinal: 2,
      needle: f.blogKeys?.[0] ?? '',
      unaffected: f.blogKeys?.[1] ?? '',
      actions: ['hide', 'rejected', 'moved'],
    },
    {
      name: 'topics-sitemap',
      path: '/sitemaps/topics.xml',
      matches: topicRows,
      ordinal: 2,
      needle: f.topicKeys[1],
      unaffected: f.topicKeys[0],
    },
  ];
  if (withWeb)
    for (const variant of ['HTML', 'RSC'])
      for (const [name, path, matches, needle, unaffected] of [
        ['home', '/', articleRows, f.titles[0], f.titles[1]],
        ['topic', `/topics/${f.topicKeys[0]}/`, articleRows, f.titles[0], f.titles[1]],
        ['relations', '/relations/', relationRows, f.slugs[0], f.slugs[1]],
      ])
        result.push({
          name: `${variant}-${name}`,
          // Next validates _rsc against router headers. With only RSC:1 the stable hash is empty.
        path: path + (variant === 'RSC' ? '?_rsc=' : ''),
          matches,
          needle,
          unaffected,
          headers: variant === 'RSC' ? { RSC: '1' } : {},
          variant,
        });
  return result;
}

/** Root may import this module from the immutable release and supply verified BUILD_ID metadata.
 * With webPort, the already-running Next must use BLOG_GATEWAY_INTERNAL_URL=http://127.0.0.1:<gatewayPort>.
 * This function owns only its temporary gateway; it never starts/stops/builds the web service.
 */
export async function runVisibilityBarrierIntegration(pool, options) {
  assertEphemeralDatabase(pool);
  const provenance = safeProvenance(options.provenance);
  const webPort = options.webPort ?? null,
    gatewayPort = options.gatewayPort ?? 0;
  assert.ok(Number.isInteger(gatewayPort) && (gatewayPort === 0 || gatewayPort > 1024) && gatewayPort !== 18169 && gatewayPort !== 18160);
  if (webPort !== null) {
    assert.ok(Number.isInteger(webPort) && webPort > 1024 && webPort !== 18169 && webPort !== 18160 && webPort !== gatewayPort);
    assert.notEqual(provenance.nextBuildId, null, 'web proof requires actual BUILD_ID');
    assert.ok(Number.isSafeInteger(options.webPid) && options.webPid > 1, 'actual immutable Next process PID required');
    assert.equal(
      await readlink(`/proc/${options.webPid}/cwd`),
      await realpath(new URL('../../web/.next/standalone/web', import.meta.url)),
      'Next process must run from this immutable release',
    );
    const envBytes = await readFile(`/proc/${options.webPid}/environ`);
    const envValue = (name) =>
      envBytes
        .toString('utf8')
        .split('\0')
        .find((entry) => entry.startsWith(name + '='))
        ?.slice(name.length + 1);
    assert.equal(envValue('BLOG_GATEWAY_INTERNAL_URL'), `http://127.0.0.1:${gatewayPort}`, 'Next must read this isolated gateway');
    assert.equal(Number(envValue('PORT')), webPort, 'Next process port mismatch');
    const actual = (await readFile(new URL('../../web/.next/BUILD_ID', import.meta.url), 'utf8')).trim();
    assert.equal(actual, provenance.nextBuildId, 'release source BUILD_ID mismatch');
    assert.equal(
      (await readFile(new URL('../../web/.next/standalone/web/.next/BUILD_ID', import.meta.url), 'utf8')).trim(),
      actual,
      'standalone BUILD_ID mismatch',
    );
  }
  const oldFlag = process.env.BLOG_TOPIC_HISTORY_READ_ENABLED;
  process.env.BLOG_TOPIC_HISTORY_READ_ENABLED = 'true';
  const context = new AsyncLocalStorage();
  let active = null,
    sequence = 0,
    requestId = 0;
  const events = [],
    results = [];
  const event = (name, extra = {}) => {
    const e = { sequence: ++sequence, utc: new Date().toISOString(), event: name, scenario: active?.name ?? null, ...extra };
    events.push(e);
    assert.ok(events.length <= 20000, 'bounded event log');
    return e;
  };
  const wrapped = observedPool(pool, context, event, () => active);
  const config = loadConfig({
    BLOG_DB_URL: process.env.BLOG_DB_URL,
    BLOG_UI_ORIGIN: `http://127.0.0.1:${webPort ?? 9}`,
    BLOG_PUBLIC_ORIGIN: gatewayPort ? `http://127.0.0.1:${gatewayPort}` : 'http://127.0.0.1',
    BLOG_TOPIC_HISTORY_READ_ENABLED: 'true',
  });
  const app = await buildApp(config, { store: { pool: wrapped, db: drizzle(wrapped, { schema, mode: 'default' }) } });
  const originalEmit = app.server.emit;
  app.server.emit = function (name, ...args) {
    if (name !== 'request') return originalEmit.call(this, name, ...args);
    const req = args[0],
      id = ++requestId;
    const correlation = /^b0-\d+-(?:A|B)$/.test(String(req.headers['x-b0-correlation'] ?? '')) ? req.headers['x-b0-correlation'] : null;
    const e = event('request-start', { requestId: id, path: req.url, correlation });
    return context.run({ id, path: req.url, sequence: e.sequence, correlation }, () => originalEmit.call(this, name, ...args));
  };
  let origin, fixture;
  const runtimeSourceTreeHash = await barrierSourceTreeHash();
  if (provenance.sourceTreeHashAlgorithm === 'runtime-source-sha256')
    assert.equal(provenance.sourceTreeHash, runtimeSourceTreeHash, 'runtime source hash mismatch');
  const artifact = {
    provenance: {
      ...provenance,
      runtimeSourceTreeHash,
      moduleRoot,
      archiveVerification:
        provenance.sourceTreeHashAlgorithm === 'git-tree-sha1' ? 'external-wrapper-required' : 'runtime-source-hash-verified',
      webPid: webPort === null ? null : options.webPid,
    },
    scope: webPort === null ? 'real-db-api-only' : 'real-db-api-and-next-html-rsc',
    isolatedPorts: { database: 18169, gateway: null, web: webPort },
    instrumentation: {
      gateway: 'SQL result barrier + request AsyncLocalStorage',
      next: webPort === null ? 'none' : 'test-only correlation preload; no content/cache/SQL changes',
    },
    notApplicable: [
      {
        surface: 'blogs-sitemap',
        actions: ['future', 'delete'],
        reason: 'the blog remains public when only its article is future/deleted',
      },
    ],
    testedSurfaces: [],
    events,
    results,
    passed: false,
    sleepUsed: false,
    retriesUsed: false,
    ttlGraceUsed: false,
    buildPerformed: false,
    browserCount: 0,
  };
  const read = async (surface, side) => {
    const response = await visibilityHttpGet(origin, surface.path, { ...surface.headers, 'x-b0-correlation': `b0-${scenarioId}-${side}` });
    assert.ok(![301, 302, 303, 307, 308].includes(response.status), 'barrier fixture expected canonical URL');
    return response;
  };
  let scenarioId = 0;
  const originalGet = TopicResponseCache.prototype.get;
  if (options.negativeControlSharedRead) {
    // Test-only reenactment of the former per-instance same-key singleflight behavior.
    const pending = new WeakMap();
    TopicResponseCache.prototype.get = function (key, load) {
      let map = pending.get(this);
      if (!map) {
        map = new Map();
        pending.set(this, map);
      }
      if (map.has(key)) return map.get(key);
      const task = Promise.resolve()
        .then(load)
        .finally(() => map.delete(key));
      map.set(key, task);
      return task;
    };
    artifact.negativeControl = 'legacy-singleflight';
  }
  try {
    origin = await app.listen({ host: '127.0.0.1', port: gatewayPort });
    artifact.isolatedPorts.gateway = Number(new URL(origin).port);
    assert.notEqual(artifact.isolatedPorts.gateway, webPort);
    for (const action of options.negativeControlSharedRead ? ['hide'] : ['hide', 'rejected', 'moved', 'future', 'delete']) {
      // A new independent fixture per surface avoids restore/retry logic and preserves source provenance.
      const names = surfaces({ titles: ['', ''], slugs: ['', ''], blogs: [0], topicIds: ['', ''], topicKeys: ['', ''] }, webPort !== null)
        .filter((s) => !s.actions || s.actions.includes(action))
        .map((s) => s.name);
      for (const name of options.negativeControlSharedRead ? names.slice(0, 1) : names) {
        fixture = await seedContentVisibility(pool);
        const surface = surfaces(fixture, webPort !== null).find((s) => s.name === name);
        scenarioId++;
        active = {
          name: `${action}:${name}`,
          matches: surface.matches,
          ordinal: surface.ordinal ?? 1,
          matchCount: 0,
          claimed: false,
          queryClass: name,
          entered: Promise.withResolvers(),
          release: Promise.withResolvers(),
        };
        const [fixtureRows] = await pool.query('SELECT id,published_at FROM posts WHERE id IN (?) ORDER BY id', [fixture.posts]);
        event('fixture.seeded', {
          published: fixtureRows.map((r) => ({ postId: r.id, publishedAt: new Date(r.published_at).toISOString() })),
          expectedSourceBlogId: fixture.blogs[0],
          unaffectedSourceBlogId: fixture.blogs[1],
          unaffectedTargetBlogId: fixture.blogs[2],
        });
        event('A.start', { path: surface.path });
        const a = read(surface, 'A');
        // A completing before the SQL barrier proves the fixture did not exercise the race and is a failure.
        const tooEarly = a.then(() => {
          throw Error('A_completed_without_sql_barrier');
        });
        tooEarly.catch(() => {});
        try {
          await Promise.race([active.entered.promise, tooEarly]);
          assert.ok(active.hit, 'old SQL result is captured');
          const c = await pool.getConnection();
          try {
            await c.beginTransaction();
            event('mutation.begin');
            if (action === 'future')
              await c.execute('UPDATE posts SET published_at=? WHERE id=?', [new Date(Date.now() + 86400000), fixture.posts[0]]);
            else if (action === 'delete') await c.execute('DELETE FROM posts WHERE id=?', [fixture.posts[0]]);
            else await c.execute('UPDATE blogs SET status=? WHERE id=?', [action === 'hide' ? 'seed' : action, fixture.blogs[0]]);
            await c.commit();
          } catch (error) {
            await c.rollback();
            throw error;
          } finally {
            c.release();
          }
          const commit = event('mutation.commit-complete', { action });
          event('B.start', { path: surface.path });
          const b = await read(surface, 'B');
          const complete = event('B.complete', { status: b.status });
          assert.equal(b.status, 200, 'unaffected public container must remain 200');
          assert.match(b.cacheControl, /no-store/);
          assert.ok(!b.body.includes(surface.needle), 'B contains revoked fixture text');
          assert.ok(b.body.includes(surface.unaffected), 'B must still show unaffected fixture');
          assert.ok(
            events.some(
              (e) =>
                e.scenario === active.name &&
                e.event === 'sql-result' &&
                e.requestStartedSequence > commit.sequence &&
                e.sequence < complete.sequence &&
                e.correlation === `b0-${scenarioId}-B` &&
                e.queryHash === active.hit.queryHash,
            ),
            'B must perform a fresh SQL read after commit',
          );
          if (surface.graph) {
            const edges = JSON.parse(b.body).edges;
            assert.ok(!edges.some((e) => e.sourceBlogId === fixture.blogs[0] || e.targetBlogId === fixture.blogs[0]));
            assert.ok(edges.some((e) => e.sourceBlogId === fixture.blogs[1] && e.targetBlogId === fixture.blogs[2]));
          }
          event('A.release');
          active.release.resolve();
          const old = await a;
          event('A.complete', { status: old.status });
          assert.equal(old.status, 200, 'A must finish normally after barrier release');
          assert.ok(active.hit.sequence < commit.sequence && commit.sequence < complete.sequence);
          results.push({
            scenario: active.name,
            action,
            surface: name,
            status: b.status,
            oldReadSequence: active.hit.sequence,
            commitSequence: commit.sequence,
            bCompleteSequence: complete.sequence,
            aReleasedAfterB: true,
            noRemovedText: true,
            unaffectedPresent: true,
            cacheControl: b.cacheControl,
            responseSha256: createHash('sha256').update(b.body).digest('hex'),
          });
          if (!artifact.testedSurfaces.includes(name)) artifact.testedSurfaces.push(name);
        } catch (error) {
          artifact.failure = {
            scenario: active.name,
            reason:
              error.message === 'visibility_http_timeout' && events.some((e) => e.scenario === active.name && e.event === 'B.start')
                ? 'request_deadline_before_B_completion'
                : 'barrier_assertion_failed',
          };
          event('scenario.failed', artifact.failure);
          throw error;
        } finally {
          event('A.release-cleanup');
          active.release.resolve();
          await a.catch(() => {});
          active = null;
          await cleanupContentVisibility(pool, fixture);
          fixture = null;
        }
      }
    }
    artifact.passed = true;
    return artifact;
  } finally {
    TopicResponseCache.prototype.get = originalGet;
    app.server.emit = originalEmit;
    if (fixture) await cleanupContentVisibility(pool, fixture);
    if (oldFlag === undefined) delete process.env.BLOG_TOPIC_HISTORY_READ_ENABLED;
    else process.env.BLOG_TOPIC_HISTORY_READ_ENABLED = oldFlag;
    await app.close();
    artifact.finishedAt = new Date().toISOString();
    if (options.artifactPath) await writeFile(options.artifactPath, JSON.stringify(artifact, null, 2) + '\n', { mode: 0o600 });
  }
}
