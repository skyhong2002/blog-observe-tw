import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { digest, normalizeTerm, POLICY_VERSION } from '../topics/policy.ts';
import { SOURCE } from '../topics/snapshot-client.ts';
import { registerPageLinks } from './page-links.ts';

/** Disposable fixtures only. The caller owns the isolated migration/test lifecycle. */
export async function runPageLinksIntegration(pool: Pool) {
  assert.equal((pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port, 18169);
  const snapshot = randomUUID(),
    suffix = snapshot.slice(0, 8),
    now = new Date();
  const label = `連結測試-${suffix}`,
    term = digest(normalizeTerm(label)),
    alias = digest(`${snapshot}:alias`),
    slug = `discovered-link-${suffix}`;
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  let blogId = 0,
    tagId = 0;
  const app = Fastify();
  try {
    const [blog] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,status,discovered_at) VALUES (?,?,'seed',?)", [
      slug,
      'Link fixture',
      now,
    ]);
    blogId = blog.insertId;
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'published',?)", [
      snapshot,
      JSON.stringify({ id: snapshot }),
      now,
    ]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, snapshot],
    );
    await pool.execute('INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,policy_version) VALUES (?,?,?,?,?)', [
      snapshot,
      term,
      normalizeTerm(label),
      label,
      POLICY_VERSION,
    ]);
    await pool.execute('INSERT INTO topic_term_aliases_v3(snapshot_id,term_id,canonical_id) VALUES (?,?,?)', [snapshot, alias, term]);
    for (const [kind, entity, canonical, legacy] of [
      ['blog', String(blogId), `我的網站-${suffix}`, slug],
      ['topic', term, label, `tag:${term}`],
    ]) {
      for (const key of [canonical, legacy])
        await pool.execute('INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES (?,?,?,?)', [kind, key, entity, now]);
      await pool.execute('INSERT INTO public_page_routes(kind,entity_id,canonical_key,created_at) VALUES (?,?,?,?)', [
        kind,
        entity,
        canonical,
        now,
      ]);
    }
    const [tag] = await pool.execute<ResultSetHeader>(
      "INSERT INTO tags(slug,label,visibility,status,first_seen_at,last_seen_at,created_at,updated_at) VALUES (?,?,'public','active',?,?,?,?)",
      [`links-${suffix}`, label, now, now, now, now],
    );
    tagId = tag.insertId;
    registerPageLinks(app, pool);
    const original = {
      blogs: [{ id: blogId, slug, name: 'Link fixture', iconUrl: `/favicons/${slug}.png` }],
      posts: [{ blogSlug: slug }],
      items: [
        { id: `tag:${alias}`, label },
        { id: `rss:${tagId}`, label },
      ],
    };
    app.get('/api/overview', () => original);
    app.get('/api/me/follows', (_req, reply) => reply.header('cache-control', 'private, no-store').send({ follows: original.blogs }));
    const result = await app.inject('/api/overview');
    assert.equal(result.statusCode, 200);
    const json = result.json(),
      path = `/blogs/${encodeURIComponent(`我的網站-${suffix}`)}/`;
    assert.equal(json.blogs[0].canonicalPath, path);
    assert.equal(json.blogs[0].slug, slug);
    assert.equal(json.blogs[0].iconUrl, original.blogs[0].iconUrl);
    assert.equal(json.posts[0].blogCanonicalPath, path);
    assert.equal(json.items[0].canonicalPath, `/topics/${encodeURIComponent(label)}/`);
    assert.equal(json.items[1].canonicalPath, json.items[0].canonicalPath);
    assert.equal(Object.hasOwn(original.blogs[0], 'canonicalPath'), false);
    const privateResult = await app.inject('/api/me/follows');
    assert.equal(privateResult.headers['cache-control'], 'private, no-store');
    assert.equal(privateResult.json().follows[0].canonicalPath, path);
    return {
      seedPagePreserved: true,
      stableSlugAndIcon: true,
      rawAliasAndRssCanonical: true,
      privateCacheUnchanged: true,
      cachedDtoUnchanged: true,
    };
  } finally {
    await app.close();
    if (previous) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [previous.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    await pool.query("DELETE FROM public_page_routes WHERE (kind='blog' AND entity_id=?) OR (kind='topic' AND entity_id=?)", [
      String(blogId),
      term,
    ]);
    await pool.query("DELETE FROM public_route_keys WHERE (kind='blog' AND entity_id=?) OR (kind='topic' AND entity_id=?)", [
      String(blogId),
      term,
    ]);
    if (tagId) await pool.execute('DELETE FROM tags WHERE id=?', [tagId]);
    await pool.execute('DELETE FROM topic_term_aliases_v3 WHERE snapshot_id=?', [snapshot]);
    await pool.execute('DELETE FROM topic_canonical_terms_v3 WHERE snapshot_id=?', [snapshot]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [snapshot]);
    if (blogId) await pool.execute('DELETE FROM blogs WHERE id=?', [blogId]);
  }
}
