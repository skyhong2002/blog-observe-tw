import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { invalidateTopicCache, registerTopicRoutes } from './routes.ts';
import { SOURCE } from './snapshot-client.ts';
import { syncVocabulary } from './sync.ts';
import { TAG_NORMALIZATION } from './tag-normalization.ts';
import { TagArticleSource, TagSourceSchemaError } from './tag-source.ts';

/** Destructive fixture cleanup is restricted to the isolated integration server. Never run against production. */
export async function runTopicsQualityIntegration(pool: Pool) {
  const port = (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port;
  assert.equal(port, 18169, 'clone-only topics integration');
  const original = (await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]))[0][0]?.snapshot_id;
  const [[active]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM topic_window_runs WHERE status IN ('scanning','ready')");
  assert.equal(Number(active.n), 0, 'fixture requires no unfinished sync');
  const failedId = randomUUID(),
    successId = randomUUID();
  const blogIds: number[] = [];
  let tagId: number | undefined;
  let now = new Date('2036-05-07T12:00:00.000Z');
  const since = new Date(now.getTime() - 86400000).toISOString(),
    until = now.toISOString();
  const window = { since, until };
  const storedWindow = [since, until];
  const budgetDay = since.slice(0, 10);
  const usedDay = until.slice(0, 10);
  const createRun = async (id: string) =>
    pool.execute('INSERT INTO topic_window_runs(id,since_at,until_at,created_at,updated_at) VALUES (?,?,?,?,?)', [
      id,
      ...storedWindow,
      now,
      now,
    ]);
  const app = Fastify();
  let queries = 0;
  const statements: string[] = [];
  const counted = new Proxy(pool, {
    get(target, key) {
      if (key === 'query')
        return (...args: unknown[]) => {
          queries++;
          statements.push(String(args[0]));
          return Reflect.apply(target.query, target, args);
        };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    // A real transport-shaped 503 after page one must preserve its checkpoint and last-good
    // pointer, defer once, and make no request during cooldown. No external network is used.
    const originalFetch = globalThis.fetch;
    let diagnosticId: string | undefined;
    let wireCalls = 0;
    const publishedAt = new Date(now.getTime() - 60000).toISOString();
    const checkpoint = `${Date.parse(publishedAt)}_998866`;
    try {
      globalThis.fetch = async () => {
        wireCalls++;
        if (wireCalls === 1)
          return Response.json({
            query: window,
            articles: [{ id: 998866, media: 'fixture', publishedAt, tags: ['暫時失敗'] }],
            nextCursor: checkpoint,
          });
        return new Response('private upstream details', { status: 503 });
      };
      const deferred = await syncVocabulary(pool, { enabled: true, now: () => now, window, maxPages: 2 });
      assert.equal(deferred.status, 'deferred');
      assert.equal('deferredReason' in deferred && deferred.deferredReason, 'upstream-http-503');
      assert.ok('version' in deferred && deferred.version);
      diagnosticId = String('version' in deferred ? deferred.version : '');
      assert.equal(wireCalls, 2);
      const [[checkpointRow]] = await pool.query<RowDataPacket[]>(
        'SELECT `cursor`,pages,status,next_attempt_at FROM topic_window_runs WHERE id=?',
        [diagnosticId],
      );
      assert.equal(checkpointRow.cursor, checkpoint);
      assert.equal(Number(checkpointRow.pages), 1);
      assert.equal(checkpointRow.status, 'scanning');
      assert.equal(new Date(checkpointRow.next_attempt_at).getTime(), now.getTime() + 15 * 60000);
      const [[unchanged]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
      assert.equal(unchanged?.snapshot_id, original);
      const cooling = await syncVocabulary(pool, { enabled: true, now: () => now, window });
      assert.equal(cooling.status, 'deferred');
      assert.equal(wireCalls, 2);
    } finally {
      globalThis.fetch = originalFetch;
      if (diagnosticId) {
        await pool.execute('DELETE FROM topic_window_articles WHERE run_id=?', [diagnosticId]);
        await pool.execute('DELETE FROM topic_window_runs WHERE id=?', [diagnosticId]);
      }
    }
    await createRun(failedId);
    const failed = await syncVocabulary(pool, {
      enabled: true,
      now: () => now,
      source: {
        page: async () => {
          throw new TagSourceSchemaError('fixture schema');
        },
      },
    });
    assert.equal(failed.status, 'failed-schema');
    let attempts = 0;
    const skipped = await syncVocabulary(pool, {
      enabled: true,
      now: () => now,
      source: {
        page: async () => {
          attempts++;
          throw Error('must not fetch during global backoff');
        },
      },
    });
    assert.equal(skipped.status, 'deferred');
    assert.equal(attempts, 0);
    const [[status]] = await pool.query<RowDataPacket[]>('SELECT status,next_attempt_at FROM topic_window_runs WHERE id=?', [failedId]);
    assert.equal(status.status, 'failed-schema');
    assert.equal(new Date(status.next_attempt_at).getTime() - now.getTime(), 3600000);
    now = new Date(now.getTime() + 2 * 3600000);
    await createRun(successId);
    const source = new TagArticleSource(async () =>
      Response.json({
        query: window,
        articles: [
          {
            id: 998877,
            media: 'fixture',
            publishedAt: new Date(Date.parse(until) - 60000).toISOString(),
            tags: ['quality-fixture', '\u2060旅行\u2060', 'bad\u0000tag', {}, ''],
          },
        ],
        nextCursor: null,
      }),
    );
    const success = await syncVocabulary(pool, { enabled: true, now: () => now, source });
    assert.equal(success.status, 'published');
    const [[snapshot]] = await pool.query<RowDataPacket[]>('SELECT manifest FROM topic_snapshots WHERE id=?', [successId]);
    const manifest = typeof snapshot.manifest === 'string' ? JSON.parse(snapshot.manifest) : snapshot.manifest;
    assert.equal(manifest.invalidTagCount, 3);
    assert.equal(manifest.normalizedTagCount, 1);
    assert.equal(manifest.tagNormalization, TAG_NORMALIZATION);
    assert.equal(manifest.total, 2);
    assert.equal(manifest.coverage, 'observed-article-window');
    const live = new Date();
    for (let i = 0; i < 2; i++) {
      const [r] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)", [
        `topic-quality-${successId}-${i}`,
        `品質測試${i}`,
        `https://quality${i}.example/`,
        live,
      ]);
      blogIds.push(r.insertId);
    }
    const [t] = await pool.execute<ResultSetHeader>(
      "INSERT INTO tags(slug,label,normalized_label,status,source_type,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,? ,?,'active','manual',?,?,?,?)",
      [`quality-${successId}`, '品質標籤', '品質標籤', live, live, live, live],
    );
    tagId = t.insertId;
    for (const [i, blogIndex, daysAgo, origin] of [
      [0, 0, 0, 'crawler'],
      [1, 0, 0, 'crawler'],
      [2, 1, 0, 'crawler'],
      [3, 1, 100, 'crawler'],
      [4, 1, 0, 'manual'],
    ] as const) {
      const [p] = await pool.execute<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
        [
          blogIds[blogIndex],
          `quality-${successId}-${i}`,
          `https://quality${blogIndex}.example/${i}`,
          '品質文章',
          new Date(live.getTime() - 1000 - daysAgo * 86400000),
          live,
        ],
      );
      await pool.execute(
        'INSERT INTO post_tags(post_id,tag_id,source_type,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        [p.insertId, tagId, origin, live, live, live, live],
      );
    }
    registerTopicRoutes(app, counted);
    const concurrent = await Promise.all(Array.from({ length: 12 }, () => app.inject('/api/topics?days=7')));
    for (const r of concurrent) assert.equal(r.statusCode, 200, r.body);
    const firstQueries = queries;
    assert.ok(firstQueries <= 8, `cold singleflight queried ${firstQueries} times`);
    await app.inject('/api/topics?days=7');
    assert.equal(queries, firstQueries);
    const result = concurrent[0].json();
    const topic = result.items.find((x: { id: string }) => x.id === `rss:${tagId}`);
    assert.equal(topic, undefined, 'feed categories must not create a parallel ranking dictionary');
    const nativeDetail = await app.inject(`/api/topics/rss:${tagId}?days=7`);
    assert.equal(nativeDetail.statusCode, 200);
    assert.equal(nativeDetail.json().topic.excludedReason, 'not-in-tag-vocabulary');
    assert.deepEqual(nativeDetail.json().blogs, []);
    assert.equal(result.vocabulary.invalidTagCount, 3);
    assert.equal(result.cacheSeconds, 120);
    const profile = await app.inject(`/api/blogs/topic-quality-${successId}-0/topics?days=7`);
    assert.equal(profile.statusCode, 200, profile.body);
    assert.equal(
      profile.json().items.find((x: { id: string }) => x.id === `rss:${tagId}`),
      undefined,
    );
    assert.ok(
      statements.some((sql) => sql.startsWith('WITH scoped_posts') && sql.includes('AND b.slug=?), evidence')),
      'blog scope must be inside pre-union source',
    );
    invalidateTopicCache(counted);
    await app.inject('/api/topics?days=7');
    assert.ok(queries > firstQueries);
    return {
      badTagsSkipped: 3,
      upstream503CheckpointPreserved: true,
      safeDeferredReason: true,
      normalizedTags: 1,
      schemaRunTerminated: true,
      globalBackoffMs: 3600000,
      coldSqlQueries: firstQueries,
      concurrentRequests: 12,
      ttlSeconds: 120,
      nativeProvenancePreserved: true,
      scopeFiltered: true,
    };
  } finally {
    await app.close();
    if (original) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [original, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    if (blogIds.length) {
      await pool.query('DELETE pt FROM post_tags pt JOIN posts p ON p.id=pt.post_id WHERE p.blog_id IN (?)', [blogIds]);
      await pool.query('DELETE FROM posts WHERE blog_id IN (?)', [blogIds]);
      await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogIds]);
    }
    if (tagId) await pool.execute('DELETE FROM tags WHERE id=?', [tagId]);
    for (const table of [
      'topic_term_aliases_v3',
      'topic_canonical_terms_v3',
      'topic_terms',
      'topic_snapshots',
      'topic_window_articles',
      'topic_window_runs',
    ]) {
      const key = ['topic_terms', 'topic_term_aliases_v3', 'topic_canonical_terms_v3'].includes(table)
        ? 'snapshot_id'
        : table === 'topic_window_articles'
          ? 'run_id'
          : 'id';
      await pool.query(`DELETE FROM ${table} WHERE ${key} IN (?)`, [[failedId, successId]]);
    }
    await pool.execute("DELETE FROM work_budgets WHERE day IN (?,?) AND scope LIKE 'topics:%'", [budgetDay, usedDay]);
  }
}
