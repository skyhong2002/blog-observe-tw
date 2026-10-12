import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { normalizeTerm, POLICY_VERSION } from '../topics/policy.ts';
import { SOURCE } from '../topics/snapshot-client.ts';
import { backfillPublicRoutes, backfillTopicRouteAliases, getPublicPages, resolvePublicPage } from './page-routes.ts';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
/** All mutations below are disposable fixtures and refuse the production database port. */
export async function runPublicRoutesIntegration(pool: Pool) {
  const port = (pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port;
  assert.equal(port, 18169);
  const snapshot = randomUUID(),
    suffix = snapshot.slice(0, 8),
    now = new Date();
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const blogs: number[] = [],
    tags: number[] = [],
    labels = [`同名 主題-${suffix}`, `同名／主題-${suffix}`],
    topics = labels.map((label) => digest(normalizeTerm(label)));
  const rawAlias = digest(`${snapshot}:raw`);
  try {
    for (let index = 0; index < 3; index++) {
      const [row] = await pool.execute<ResultSetHeader>(
        "INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,'verified',?)",
        [`discovered-${suffix}-${index}`, `Fixture ${index}`, `https://routes-${suffix}.example/`, now],
      );
      blogs.push(row.insertId);
    }
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'published',?)", [
      snapshot,
      JSON.stringify({ id: snapshot }),
      now,
    ]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, snapshot],
    );
    for (const [i, id] of topics.entries())
      await pool.execute('INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,policy_version) VALUES (?,?,?,?,?)', [
        snapshot,
        id,
        normalizeTerm(labels[i]),
        labels[i],
        POLICY_VERSION,
      ]);
    await pool.execute('INSERT INTO topic_term_aliases_v3(snapshot_id,term_id,canonical_id) VALUES (?,?,?)', [
      snapshot,
      rawAlias,
      topics[0],
    ]);
    const before = await pool.query<RowDataPacket[]>('SELECT id,slug FROM blogs WHERE id IN (?)', [blogs]);
    let cursor = String(blogs[0] - 1);
    for (let i = 0; i < 3; i++) {
      const result = await backfillPublicRoutes(pool, { kind: 'blog', afterId: cursor, limit: 1 });
      assert.equal(result.processed, 1);
      cursor = result.nextCursor!;
    }
    await backfillPublicRoutes(pool, { kind: 'topic', limit: 500 });
    await backfillTopicRouteAliases(pool, { limit: 500 });
    assert.equal((await backfillPublicRoutes(pool, { kind: 'topic', missingOnly: true })).processed, 0);
    assert.equal((await backfillTopicRouteAliases(pool, { missingOnly: true })).processed, 0);
    const pages = await getPublicPages(pool, 'blog', blogs.map(String));
    assert.equal(pages.size, 3);
    assert.equal(new Set([...pages.values()].map((p) => p.slug)).size, 3, 'domain collisions receive stable suffixes');
    assert.equal(pages.get(String(blogs[0]))!.slug, `routes-${suffix}.example`);
    assert.match(pages.get(String(blogs[1]))!.slug, new RegExp(`^routes-${suffix}\\.example-[a-f0-9]{8}$`));
    const first = await resolvePublicPage(pool, 'blog', `discovered-${suffix}-0`);
    assert.equal(first?.entityId, String(blogs[0]));
    assert.equal(first?.stableId, `discovered-${suffix}-0`, 'API and favicon identity unchanged');
    assert.equal((await resolvePublicPage(pool, 'blog', first!.slug))?.canonicalPath, first?.canonicalPath);
    const topic = await resolvePublicPage(pool, 'topic', `tag:${topics[0]}`);
    assert.equal(topic?.stableId, `tag:${topics[0]}`);
    assert.ok(topic?.canonicalPath.startsWith('/topics/%E5%90%8C%E5%90%8D-'));
    assert.equal((await resolvePublicPage(pool, 'topic', `tag:${rawAlias}`))?.canonicalPath, topic?.canonicalPath);
    const topicPages = await getPublicPages(pool, 'topic', topics);
    assert.equal(new Set([...topicPages.values()].map((p) => p.slug)).size, 2);
    await pool.execute('UPDATE topic_canonical_terms_v3 SET label=? WHERE snapshot_id=? AND id=?', ['顯示名稱已變更', snapshot, topics[0]]);
    await backfillPublicRoutes(pool, { kind: 'topic', limit: 500 });
    await backfillPublicRoutes(pool, { kind: 'blog', afterId: String(blogs[0] - 1), limit: 3 });
    await backfillTopicRouteAliases(pool, { limit: 500 });
    assert.equal(
      (await resolvePublicPage(pool, 'topic', `tag:${topics[0]}`))?.canonicalPath,
      topic?.canonicalPath,
      'display changes and reruns never churn slugs',
    );
    const after = await pool.query<RowDataPacket[]>('SELECT id,slug FROM blogs WHERE id IN (?)', [blogs]);
    assert.deepEqual(after[0], before[0]);
    const [seed] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,status,discovered_at) VALUES (?,?,'seed',?)", [
      `seed-${suffix}`,
      '尚待補網址',
      now,
    ]);
    blogs.push(seed.insertId);
    assert.equal((await backfillPublicRoutes(pool, { kind: 'blog', afterId: String(seed.insertId - 1), missingOnly: true })).processed, 1);
    assert.equal(
      (await resolvePublicPage(pool, 'blog', `seed-${suffix}`))?.stableId,
      `seed-${suffix}`,
      'pre-existing seed page remains addressable',
    );
    assert.equal((await backfillPublicRoutes(pool, { kind: 'blog', afterId: String(seed.insertId - 1), missingOnly: true })).processed, 0);
    const [tag] = await pool.execute<ResultSetHeader>(
      "INSERT INTO tags(slug,label,visibility,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,'private','active',?,?,?,?)",
      [`route-tag-${suffix}`, labels[0], now, now, now, now],
    );
    tags.push(tag.insertId);
    assert.equal(
      await resolvePublicPage(pool, 'topic', `rss:${tag.insertId}`),
      null,
      'private RSS labels never reveal a canonical mapping',
    );
    await pool.execute("UPDATE tags SET visibility='public',status='candidate' WHERE id=?", [tag.insertId]);
    assert.equal(await resolvePublicPage(pool, 'topic', `rss:${tag.insertId}`), null, 'inactive RSS labels stay hidden');
    await pool.execute("UPDATE tags SET status='active' WHERE id=?", [tag.insertId]);
    assert.equal((await resolvePublicPage(pool, 'topic', `rss:${tag.insertId}`))?.canonicalPath, topic?.canonicalPath);
    await assert.rejects(
      pool.execute('INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES (?,?,?,?)', [
        'topic',
        topic!.slug,
        topics[1],
        now,
      ]),
      { code: 'ER_DUP_ENTRY' },
    );
    await assert.rejects(
      pool.execute('UPDATE public_page_routes SET canonical_key=? WHERE kind=? AND entity_id=?', [topic!.slug, 'topic', topics[1]]),
    );
    await pool.execute('UPDATE topic_canonical_terms_v3 SET label=? WHERE snapshot_id=? AND id=?', ['™', snapshot, topics[0]]);
    assert.equal(
      await resolvePublicPage(pool, 'topic', `tag:${topics[0]}`),
      null,
      'pure symbols have no public URL even if NFKC expands them to letters',
    );
    const [[retainedRoute]] = await pool.query<RowDataPacket[]>(
      "SELECT canonical_key FROM public_page_routes WHERE kind='topic' AND entity_id=?",
      [topics[0]],
    );
    assert.equal(retainedRoute.canonical_key, topic!.slug, 'noise exclusion does not delete or rename retained keys');
    await pool.execute('UPDATE topic_canonical_terms_v3 SET label=? WHERE snapshot_id=? AND id=?', ['顯示名稱已變更', snapshot, topics[0]]);
    // Explicit future maintenance may change the canonical key without deleting aliases.
    // Every old key still resolves to the entity's one final key, never another alias.
    for (const [kind, entity, oldKeys] of [
      ['blog', String(blogs[0]), [first!.slug, `discovered-${suffix}-0`]],
      ['topic', topics[0], [topic!.slug, `tag:${topics[0]}`, `tag:${rawAlias}`]],
    ] as const) {
      const renamed = `maintained-${kind}-${suffix}`;
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        await c.execute('INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES (?,?,?,?)', [
          kind,
          renamed,
          entity,
          now,
        ]);
        await c.execute('UPDATE public_page_routes SET canonical_key=? WHERE kind=? AND entity_id=?', [renamed, kind, entity]);
        await c.commit();
      } catch (error) {
        await c.rollback();
        throw error;
      } finally {
        c.release();
      }
      for (const key of [...oldKeys, renamed])
        assert.equal((await resolvePublicPage(pool, kind, key))?.canonicalPath, `/${kind === 'blog' ? 'blogs' : 'topics'}/${renamed}/`);
      await backfillPublicRoutes(pool, { kind, afterId: kind === 'blog' ? String(blogs[0] - 1) : undefined, limit: 3 });
      assert.equal(
        (await resolvePublicPage(pool, kind, oldKeys[0]))?.slug,
        renamed,
        'routine backfill does not undo explicit canonical maintenance',
      );
    }
    // Old routes go directly to a verified final URL owner, including an intermediate moved site.
    await pool.execute("UPDATE blogs SET status='moved' WHERE id IN (?,?)", [blogs[0], blogs[1]]);
    await pool.execute('UPDATE blogs SET url=? WHERE id=?', [`https://final-${suffix}.example/`, blogs[2]]);
    await pool.execute('INSERT INTO blog_urls(blog_id,url,kind,is_primary,discovered_at) VALUES (?, ?, ?, FALSE, ?)', [
      blogs[2],
      `https://routes-${suffix}.example/`,
      'moved',
      now,
    ]);
    assert.equal((await resolvePublicPage(pool, 'blog', first!.slug))?.entityId, String(blogs[2]));
    assert.equal((await resolvePublicPage(pool, 'blog', `discovered-${suffix}-1`))?.entityId, String(blogs[2]));
    await pool.execute("UPDATE blogs SET status='verified',url=? WHERE id=?", [`https://routes-${suffix}.example/`, seed.insertId]);
    assert.equal(await resolvePublicPage(pool, 'blog', first!.slug), null, 'ambiguous verified URL owners cannot be guessed');
    const [[size]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM public_route_keys');
    assert.equal(await resolvePublicPage(pool, 'topic', 'unknown-unregistered-topic'), null);
    const [[sizeAfter]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM public_route_keys');
    assert.equal(Number(size.n), Number(sizeAfter.n));
    return {
      stableApiIds: true,
      domainAndLabelCollision: true,
      nfkcAndEncoding: true,
      sourceAliases: true,
      rerunIdempotent: true,
      canonicalOwnerEnforced: true,
      explicitRenameKeepsSingleHopAliases: true,
      punctuationNoPublicUrlPreservesRegistry: true,
      movedSingleFinalTarget: true,
      ambiguousMoveRejected: true,
      nonVerifiedPagePreserved: true,
      privateRssMappingHidden: true,
      missingOnlySkipsExisting: true,
      requestLookupReadOnly: true,
    };
  } finally {
    if (tags.length) await pool.query('DELETE FROM tags WHERE id IN (?)', [tags]);
    if (previous) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [previous.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    if (blogs.length) {
      await pool.query("DELETE FROM public_page_routes WHERE kind='blog' AND entity_id IN (?)", [blogs.map(String)]);
      await pool.query("DELETE FROM public_route_keys WHERE kind='blog' AND entity_id IN (?)", [blogs.map(String)]);
      await pool.query('DELETE FROM blog_urls WHERE blog_id IN (?)', [blogs]);
      await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
    }
    await pool.query("DELETE FROM public_page_routes WHERE kind='topic' AND entity_id IN (?)", [topics]);
    await pool.query("DELETE FROM public_route_keys WHERE kind='topic' AND entity_id IN (?)", [topics]);
    await pool.execute('DELETE FROM topic_term_aliases_v3 WHERE snapshot_id=?', [snapshot]);
    await pool.execute('DELETE FROM topic_canonical_terms_v3 WHERE snapshot_id=?', [snapshot]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [snapshot]);
  }
}
