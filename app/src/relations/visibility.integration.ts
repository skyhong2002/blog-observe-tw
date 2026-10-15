/** Destructive fixture test: caller must supply an isolated restored clone, never the live database. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { installPrivateCachePolicy } from '../cache-policy.ts';
import { HOME_MENTIONS_SQL, loadHomeMentions } from './home-feed.ts';
import { parseArticleLinks } from './parser.ts';
import { invalidateRelationCache, loadRelationCoverage, loadRelations, readRelationSnapshot, registerRelationRoutes } from './routes.ts';
import { loadAliases, saveObservation } from './store.ts';

export async function runRelationVisibilityIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const suffix = Date.now().toString(36);
  const now = new Date();
  const blogIds: number[] = [],
    postIds: number[] = [];
  const app = Fastify();
  let userId = 0,
    assertions = 0;
  const check = (value: unknown) => {
    try {
      assert.ok(value, `relation visibility assertion ${assertions + 1}`);
    } catch (error) {
      Error.captureStackTrace(error as Error, check);
      throw error;
    }
    assertions++;
  };
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  try {
    const [user] = await pool.query<ResultSetHeader>('INSERT INTO users (google_sub,email,created_at,last_login_at) VALUES (?,?,?,?)', [
      `relation-visibility-${suffix}`,
      `visibility-${suffix}@example.invalid`,
      now,
      now,
    ]);
    userId = user.insertId;
    for (const name of ['a', 'b', 'c']) {
      const [r] = await pool.query<ResultSetHeader>(
        "INSERT INTO blogs (slug,name,url,status,status_label,discovered_at) VALUES (?,?,?,'verified','fixture',?)",
        [`visibility-${name}-${suffix}`, `Visibility ${name}`, `https://${name}-${suffix}.example/`, now],
      );
      blogIds.push(r.insertId);
    }
    const [a, b, c] = blogIds;
    const aUrl = `https://a-${suffix}.example/`,
      bUrl = `https://b-${suffix}.example/`,
      cUrl = `https://c-${suffix}.example/`,
      unknown = `https://unknown-${suffix}.example/`;
    for (const [blogId, url] of [
      [a, aUrl + 'one'],
      [a, aUrl + 'two'],
      [b, bUrl + 'one'],
    ] as const) {
      const [r] = await pool.query<ResultSetHeader>(
        'INSERT INTO posts (blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?)',
        [blogId, url, url, 'Visibility fixture', now, now],
      );
      postIds.push(r.insertId);
    }
    const aliases = await loadAliases(pool);
    // Homepage citations need the link inside a sentence (home-feed.ts QUOTED_LINK); /relations counts any body link.
    const said = (link: string) => `<p>今天讀到 ${link} 寫的文章，裡面的想法讓我很有共鳴。</p>`;
    const aBody = `<article>${said(`<a href="${bUrl}one">B first</a>`)}${said(`<a href="${bUrl}one">B repeated</a>`)}${said(`<a href="${cUrl}">C</a>`)}${said(`<a href="${unknown}">Unknown</a>`)}<aside><a href="${bUrl}one">B sidebar</a></aside></article>`;
    const save = async (postId: number, blogId: number, url: string, body: string) =>
      saveObservation(
        pool,
        { id: postId, blog_id: blogId, url, blog_url: blogId === a ? aUrl : bUrl, published_at: now, depth: 0 },
        parseArticleLinks(body, url, blogId, aliases),
        new Response(body),
        now,
      );
    await save(postIds[0], a, aUrl + 'one', aBody);
    await save(postIds[1], a, aUrl + 'two', `<article>${said(`<a href="${bUrl}one">B</a>`)}</article>`);
    await save(postIds[2], b, bUrl + 'one', `<article>${said(`<a href="${aUrl}one">A</a>`)}</article>`);
    const homeInitial = await loadHomeMentions(pool, now);
    check(homeInitial.items.filter((row) => row.postId === postIds[0] && row.targetBlogId === b).length === 1);
    check(homeInitial.items.every((row) => row.location === 'body' && row.contextSource === 'body'));
    check(!homeInitial.items.some((row) => row.targetDomain === new URL(unknown).hostname));
    // Production home SQL, real commit/read barriers; never wait for sleep, retry, or TTL.
    const homeBarriers: string[][] = [];
    for (const mutation of ['seed', 'rejected', 'moved', 'future', 'delete', 'owner'] as const) {
      let arrived!: () => void, release!: () => void;
      let first = true;
      const held = new Promise<void>((r) => (release = r)),
        reached = new Promise<void>((r) => (arrived = r));
      const order: string[] = [];
      const wrapped = new Proxy(pool, {
        get(target, key) {
          if (key === 'query')
            return async (...args: unknown[]) => {
              const result = await Reflect.apply(target.query, target, args);
              if (first && args[0] === HOME_MENTIONS_SQL) {
                first = false;
                order.push('A-read');
                arrived();
                await held;
                order.push('A-release');
              }
              return result;
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as Pool;
      const oldRead = loadHomeMentions(wrapped, now);
      try {
        // Early SQL failure must reject rather than leave the fixture waiting forever.
        await Promise.race([
          reached,
          oldRead.then(() => {
            throw Error('home_barrier_not_reached');
          }),
        ]);
        const transaction = await pool.getConnection();
        try {
          await transaction.beginTransaction();
          if (mutation === 'seed' || mutation === 'rejected' || mutation === 'moved')
            await transaction.execute('UPDATE blogs SET status=? WHERE id=?', [mutation, b]);
          else if (mutation === 'future')
            await transaction.execute('UPDATE posts SET published_at=? WHERE id=?', [new Date(now.getTime() + 60_000), postIds[2]]);
          else if (mutation === 'owner') await transaction.execute('UPDATE posts SET blog_id=? WHERE id=?', [c, postIds[2]]);
          else await transaction.execute('DELETE FROM posts WHERE id=?', [postIds[2]]);
          await transaction.commit();
          order.push('commit');
        } catch (error) {
          await transaction.rollback();
          throw error;
        } finally {
          transaction.release();
        }
        const fresh = await loadHomeMentions(pool, now);
        order.push('B-complete');
        check(!fresh.items.some((row) => row.targetBlogId === b));
        check(fresh.items.some((row) => row.sourceBlogId === a && row.targetBlogId === c));
        release();
        check((await oldRead).items.some((row) => row.targetBlogId === b));
        order.push('A-complete');
        assert.deepEqual(order, ['A-read', 'commit', 'B-complete', 'A-release', 'A-complete']);
        homeBarriers.push([mutation, ...order]);
      } finally {
        release();
        // Drain A without letting a cleanup rejection skip restoration below;
        // the original failure already propagates through the try block/race.
        await oldRead.catch(() => {});
        await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [b]);
        if (mutation === 'delete') {
          await pool.execute('INSERT INTO posts (id,blog_id,guid,url,title,published_at,created_at) VALUES (?,?,?,?,?,?,?)', [
            postIds[2],
            b,
            bUrl + 'one',
            bUrl + 'one',
            'Visibility fixture',
            now,
            now,
          ]);
          // The deleted post's outgoing rows remain query-joined safely; restore its observation for the original fixture.
          await save(postIds[2], b, bUrl + 'one', `<article>${said(`<a href="${aUrl}one">A</a>`)}</article>`);
        } else await pool.execute('UPDATE posts SET blog_id=?,published_at=? WHERE id=?', [b, now, postIds[2]]);
      }
    }
    const override = async (postId: number, targetUrl: string, location: string, hidden: boolean) => {
      await pool.query(
        `INSERT INTO admin_relation_overrides (fingerprint,source_post_id,target_url_hash,target_url,location,hidden,reason,actor_user_id,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE hidden=VALUES(hidden),updated_at=VALUES(updated_at)`,
        [
          hash(JSON.stringify([postId, targetUrl, location])),
          postId,
          hash(targetUrl),
          targetUrl,
          location,
          hidden,
          'fixture',
          userId,
          new Date(),
        ],
      );
      await invalidateRelationCache(pool);
    };
    const edge = (dto: Awaited<ReturnType<typeof loadRelations>>, source: number, target: number) =>
      dto.edges.find((e) => e.sourceBlogId === source && e.targetBlogId === target);
    await invalidateRelationCache(pool);
    await registerRelationRoutes(app, pool);
    const baseline = (await app.inject('/api/relations?days=90')).json();
    check(edge(baseline, a, b)?.count === 2 && edge(baseline, a, b)?.share === 2 / 3 && edge(baseline, a, b)?.mutual);
    // Pause live SQL after its aggregation; the revision fence must recheck a concurrent hide.
    let release!: () => void, arrived!: () => void;
    const blocked = new Promise<void>((r) => (release = r)),
      reached = new Promise<void>((r) => (arrived = r));
    let intercepted = false;
    const racingPool = new Proxy(pool, {
      get(target, key) {
        if (key === 'query')
          return async (...args: unknown[]) => {
            const result = await Reflect.apply(target.query, target, args);
            if (!intercepted && String(args[0]).startsWith('SELECT l.source_blog_id sourceBlogId')) {
              intercepted = true;
              arrived();
              await blocked;
            }
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Pool;
    await pool.query('DELETE FROM relation_snapshots');
    const racing = readRelationSnapshot(racingPool, 90);
    await reached;
    await override(postIds[0], bUrl + 'one', 'body', true);
    release();
    check(edge(await racing, a, b)?.count === 1);
    const [[currentSnapshot]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM relation_snapshots WHERE days=90');
    check(Number(currentSnapshot.count) === 0); // Public reads no longer write/cache worker DTOs.

    const hidden = (await app.inject('/api/relations?days=90')).json();
    check(!(await loadHomeMentions(pool, now)).items.some((row) => row.postId === postIds[0] && row.targetBlogId === b));
    check(edge(hidden, a, b)?.count === 1 && edge(hidden, a, b)?.share === 0.5 && edge(hidden, a, c)?.share === 0.5);
    check(hidden.mostMentioned.find((r: { blogId: number; mentions: number }) => r.blogId === b)?.mentions === 1);
    const incomingProfile = (await app.inject(`/api/blogs/visibility-b-${suffix}/relations`)).json();
    check(incomingProfile.incoming.find((e: { sourceBlogId: number; share: number }) => e.sourceBlogId === a)?.share === 0.5);
    const [[snapshot]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM relation_snapshots');
    check(Number(snapshot.count) === 0);
    const profile = (await app.inject(`/api/blogs/visibility-a-${suffix}/relations`)).json();
    check(profile.outgoing.find((e: { targetBlogId: number; share: number }) => e.targetBlogId === b)?.share === 0.5);
    check(!profile.evidence.some((e: { postId: number; targetUrl: string }) => e.postId === postIds[0] && e.targetUrl === bUrl + 'one'));
    check(profile.coverage.nonBodyLinks.sidebar === 1);
    const [[raw]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) count FROM relation_links WHERE source_post_id=? AND target_url=?', [
      postIds[0],
      bUrl + 'one',
    ]);
    check(Number(raw.count) === 3);
    // Reordered ordinal/new anchor text must not accidentally unhide or hide a different target.
    await save(
      postIds[0],
      a,
      aUrl + 'one',
      `<article><a href="${cUrl}">C before B now</a><a href="${bUrl}one">Changed B anchor</a><a href="${unknown}">Unknown</a><aside><a href="${bUrl}one">B sidebar</a></aside></article>`,
    );
    const reordered = await loadRelations(pool, 90);
    check(edge(reordered, a, b)?.count === 1 && edge(reordered, a, c)?.count === 1);
    await override(postIds[1], bUrl + 'one', 'body', true);
    const removed = await loadRelations(pool, 90);
    check(!edge(removed, a, b) && edge(removed, a, c)?.share === 1 && !edge(removed, b, a)?.mutual);
    check(
      !removed.mutual.some(
        (pair) => (pair.sourceBlogId === a && pair.targetBlogId === b) || (pair.sourceBlogId === b && pair.targetBlogId === a),
      ),
    );
    await override(postIds[0], unknown, 'body', true);
    check((await loadRelationCoverage(pool, a)).unresolvedLinks === 0);
    await override(postIds[0], bUrl + 'one', 'body', false);
    await override(postIds[1], bUrl + 'one', 'body', false);
    const restored = (await app.inject('/api/relations?days=90')).json();
    check(edge(restored, a, b)?.count === 2 && edge(restored, a, b)?.share === 2 / 3 && edge(restored, b, a)?.mutual);
    // Exact URL case matters, even when the database's default collation is insensitive.
    await override(postIds[0], bUrl + 'ONE', 'body', true);
    check(edge(await loadRelations(pool, 90), a, b)?.count === 2);
    // Identical keys must perform independent reads, with at most four SQL builders.
    let unblock!: () => void, allBlocked!: () => void;
    let builders = 0;
    const gate = new Promise<void>((r) => (unblock = r)),
      four = new Promise<void>((r) => (allBlocked = r));
    const limitedPool = new Proxy(pool, {
      get(target, key) {
        if (key === 'query')
          return async (...args: unknown[]) => {
            if (String(args[0]).startsWith('SELECT e.* FROM')) {
              builders++;
              if (builders === 4) allBlocked();
              await gate;
            }
            return Reflect.apply(target.query, target, args);
          };
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as Pool;
    const limitedApp = Fastify();
    installPrivateCachePolicy(limitedApp);
    await registerRelationRoutes(limitedApp, limitedPool);
    try {
      const loads = [
        ...Array.from({ length: 10 }, () => limitedApp.inject(`/api/blogs/visibility-a-${suffix}/relations?days=7`)),
        limitedApp.inject(`/api/blogs/visibility-a-${suffix}/relations?days=30`),
        limitedApp.inject(`/api/blogs/visibility-b-${suffix}/relations?days=7`),
        limitedApp.inject(`/api/blogs/visibility-b-${suffix}/relations?days=30`),
      ];
      // LightMyRequest starts on .then, rather than when the thenable is created.
      let rejectedCount = 0,
        allRejected!: () => void;
      const nineRejected = new Promise<void>((resolve) => (allRejected = resolve));
      const completion = Promise.all(
        loads.map((load) =>
          load.then((response) => {
            if (response.statusCode === 503 && ++rejectedCount === 9) allRejected();
            return response;
          }),
        ),
      );
      await Promise.all([four, nineRejected]);
      const overloaded = await limitedApp.inject(`/api/blogs/visibility-c-${suffix}/relations?days=7`);
      check(overloaded.statusCode === 503 && overloaded.headers['retry-after'] === '2');
      check(String(overloaded.headers['cache-control']).includes('no-store'));
      assert.deepEqual(overloaded.json(), { error: 'relation_projection_busy' });
      unblock();
      const responses = await completion;
      check(builders === 4);
      check(responses.filter((r) => r.statusCode === 200).length === 4);
      const rejected = responses.filter((r) => r.statusCode === 503);
      check(rejected.length === 9);
      for (const response of responses) check(String(response.headers['cache-control']).includes('no-store'));
      for (const response of rejected) {
        check(response.headers['retry-after'] === '2');
        assert.deepEqual(response.json(), { error: 'relation_projection_busy' }, 'overload must not return a stale relation DTO');
      }
      const repeated = await limitedApp.inject(`/api/blogs/visibility-a-${suffix}/relations?days=7`);
      check(repeated.statusCode === 200 && builders === 5);
      check(String(repeated.headers['cache-control']).includes('no-store'));
      check(repeated.json().outgoing.some((e: { targetBlogId: number; count: number }) => e.targetBlogId === b && e.count === 2));
    } finally {
      unblock();
      await limitedApp.close();
    }
    return {
      assertions,
      homeBarriers,
      cacheInvalidation: true,
      stableFingerprint: true,
      rawEvidencePreserved: true,
      ratiosConsistent: true,
    };
  } finally {
    await app.close();
    await invalidateRelationCache(pool);
    if (postIds.length) {
      await pool.query('DELETE FROM admin_relation_overrides WHERE source_post_id IN (?)', [postIds]);
      await pool.query('DELETE FROM relation_links WHERE source_post_id IN (?)', [postIds]);
      await pool.query('DELETE FROM relation_observations WHERE post_id IN (?)', [postIds]);
      await pool.query('DELETE FROM posts WHERE id IN (?)', [postIds]);
    }
    if (blogIds.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogIds]);
    if (userId) await pool.query('DELETE FROM users WHERE id=?', [userId]);
  }
}
