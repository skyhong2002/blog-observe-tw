import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { FREQUENCY_POLICY } from '../topics/frequency.ts';
import { CLEANUP_VERSION } from '../topics/matching-body.ts';
import { digest, MATCHER_VERSION, POLICY_VERSION } from '../topics/policy.ts';
import { SOURCE } from '../topics/snapshot-client.ts';
import { getIndexablePages, getPageIndexability } from './indexability.ts';
import { registerPageApi } from './page-api.ts';
import { registerSeoRoutes, SEO_ORIGIN } from './routes.ts';

export async function runIndexabilityIntegration(pool: Pool) {
  assert.equal((pool as unknown as { pool: { config: { connectionConfig: { port: number } } } }).pool.config.connectionConfig.port, 18169);
  const [[previous]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const snapshot = randomUUID(),
    now = new Date(),
    published = new Date(now.getTime() - 86400_000);
  const labels = ['中文有效', '兩篇薄頁', '單站三篇', '排除詞', '未啟用', '過期索引', '未來文章', '高頻正文'];
  const terms = labels.map((label) => ({ id: digest(`${snapshot}:${label}`), key: `${label}-${snapshot.slice(0, 8)}` }));
  const blogs: number[] = [],
    posts: number[] = [];
  const app = Fastify();
  const route = async (kind: string, id: string, key: string) => {
    await pool.execute('INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES (?,?,?,?)', [kind, key, id, now]);
    await pool.execute('INSERT INTO public_page_routes(kind,entity_id,canonical_key,created_at) VALUES (?,?,?,?)', [kind, id, key, now]);
  };
  try {
    await pool.execute("INSERT INTO topic_snapshots(id,manifest,status,generated_at,synced_at) VALUES (?,?,'published',?,?)", [
      snapshot,
      '{}',
      now,
      now,
    ]);
    await pool.execute(
      'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
      [SOURCE, snapshot],
    );
    for (let i = 0; i < 4; i++) {
      const [blog] = await pool.execute<ResultSetHeader>('INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES (?,?,?,?,?)', [
        `indexability-${snapshot}-${i}`,
        `品質測試${i}`,
        i === 3 ? 'https://' : `https://quality-${i}.example/`,
        i === 2 ? 'seed' : 'verified',
        now,
      ]);
      blogs.push(blog.insertId);
      await route('blog', String(blog.insertId), `quality-${i}-${snapshot.slice(0, 8)}.example`);
    }
    for (let i = 0; i < 7; i++) {
      const hash = digest(`${snapshot}:post:${i}`),
        blog = i === 3 || i === 5 ? blogs[1] : i === 6 ? blogs[2] : blogs[0];
      const [post] = await pool.execute<ResultSetHeader>(
        'INSERT INTO posts(blog_id,guid,url,title,content_hash,published_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [
          blog,
          `${snapshot}:${i}`,
          `https://quality.example/${snapshot}/${i}`,
          `有效文章${i}`,
          hash,
          i === 5 ? new Date(now.getTime() + 86400_000) : published,
          published,
          published,
        ],
      );
      posts.push(post.insertId);
      await pool.execute(
        "INSERT INTO topic_post_indexes_v3(snapshot_id,post_id,input_hash,post_hash,body_hash,matched_at,status,matcher_version,cleanup_version,body_kind) VALUES (?,?,?,?,NULL,?,'ok',?,?,'empty')",
        [snapshot, post.insertId, hash, i === 4 ? digest('stale') : hash, now, MATCHER_VERSION, CLEANUP_VERSION],
      );
    }
    for (const [i, term] of terms.entries()) {
      await pool.execute(
        'INSERT INTO topic_canonical_terms_v3(snapshot_id,id,normalized_label,label,exclusion_reason,inactive_reason,policy_version) VALUES (?,?,?,?,?,?,?)',
        [snapshot, term.id, term.key, term.key, i === 3 ? 'tag-noise' : null, i === 4 ? 'low-frequency' : null, POLICY_VERSION],
      );
      await route('topic', term.id, term.key);
      const matches = i === 1 ? [0, 3] : i === 2 ? [0, 1, 2] : i === 5 ? [0, 3, 4] : i === 6 ? [0, 3, 5] : [0, 1, 3];
      for (const index of [...matches, 6]) {
        if (i === 7)
          await pool.execute("INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) VALUES (?,?,?,'body')", [
            snapshot,
            posts[index],
            term.id,
          ]);
        else
          await pool.execute("INSERT INTO topic_matches_v3(snapshot_id,post_id,term_id,source) VALUES (?,?,?,'title'),(?,?,?,'body')", [
            snapshot,
            posts[index],
            term.id,
            snapshot,
            posts[index],
            term.id,
          ]);
      }
    }
    await pool.execute(
      'INSERT INTO topic_frequency_runs(snapshot_id,baseline_from,baseline_until,total_posts,covered_posts,threshold_ratio,policy_version,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [snapshot, new Date(now.getTime() - 365 * 86400_000), now, 100, 100, 0.03, FREQUENCY_POLICY.version, now],
    );
    await pool.execute(
      'INSERT INTO topic_term_frequencies(snapshot_id,term_id,matched_posts,title_posts,high_frequency) VALUES (?,?,?,?,?)',
      [snapshot, terms[7].id, 10, 0, 1],
    );
    registerPageApi(app, pool);
    registerSeoRoutes(app, pool);
    const statuses = await Promise.all(terms.map((term) => getPageIndexability(pool, 'topic', term.id)));
    assert.deepEqual(
      statuses.map((s) => s.indexabilityReason),
      [null, null, null, 'excluded-term', null, null, null, null],
    );
    assert.equal(statuses[0].posts, 3, 'title/body and private source do not inflate posts');
    assert.equal(statuses[0].blogs, 2);
    assert.ok(statuses.every((s) => s.currentVersion === snapshot && s.windowDays === 90));
    const list = await getIndexablePages(pool, 'topic');
    assert.deepEqual(list.map((p) => p.entityId).sort(), [0, 1, 2, 5, 6].map((i) => terms[i].id).sort());
    const xml = await app.inject('/sitemaps/topics.xml');
    assert.equal(xml.statusCode, 200);
    assert.ok(xml.body.includes(`${SEO_ORIGIN}/topics/${encodeURIComponent(terms[0].key)}/`));
    assert.ok(xml.body.includes(`<lastmod>${published.toISOString().replace(/\.\d{3}Z$/, '.000Z')}</lastmod>`));
    for (const [i, term] of terms.entries()) {
      const response = await app.inject(`/api/pages/topics/${encodeURIComponent(term.key)}`);
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().page.indexable, i !== 3);
      assert.equal(
        xml.body.includes(`/topics/${encodeURIComponent(term.key)}/`),
        [0, 1, 2, 5, 6].includes(i),
        'sitemap preserves the old >=1 valid evidence set without adding a page noindex gate',
      );
    }
    const blogXml = await app.inject('/sitemaps/blogs.xml');
    assert.ok(blogXml.body.includes(`/blogs/quality-0-${snapshot.slice(0, 8)}.example/`));
    assert.ok(!blogXml.body.includes(`/blogs/quality-2-${snapshot.slice(0, 8)}.example/`));
    assert.ok(
      blogXml.body.includes(`/blogs/quality-3-${snapshot.slice(0, 8)}.example/`),
      'preserve the deployed HTTP-prefix sitemap rule without adding URL eligibility policy',
    );
    assert.equal((await getPageIndexability(pool, 'blog', String(blogs[3]))).indexabilityReason, null);
    assert.equal((await getPageIndexability(pool, 'blog', String(blogs[2]))).indexable, true, 'seed blog pages gain no new noindex policy');
    assert.equal((await app.inject('/api/pages/topics/unknown')).statusCode, 404);
    assert.equal((await app.inject('/api/pages/topics/%252F')).statusCode, 404);
    const lowFrequency = await getPageIndexability(pool, 'blog', String(blogs[1]));
    assert.equal(lowFrequency.indexable, true, 'single low-frequency blog has no multi-blog minimum');
    return {
      noNewContentThresholds: true,
      samePostDeduplicated: true,
      privateExcluded: true,
      staleAndFutureExcluded: true,
      legacySitemapMembershipPreserved: true,
      chineseEncoding: true,
      unknown404: true,
      lowFrequencyBlogPreserved: true,
      highFrequencyBodyExcluded: true,
    };
  } finally {
    await app.close();
    if (previous) await pool.execute('UPDATE topic_current SET snapshot_id=? WHERE source=?', [previous.snapshot_id, SOURCE]);
    else await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    const routeIds = [...terms.map((t) => t.id), ...blogs.map(String)];
    if (routeIds.length) {
      await pool.query('DELETE FROM public_page_routes WHERE entity_id IN (?)', [routeIds]);
      await pool.query('DELETE FROM public_route_keys WHERE entity_id IN (?)', [routeIds]);
    }
    for (const table of [
      'topic_matches_v3',
      'topic_post_indexes_v3',
      'topic_term_frequencies',
      'topic_frequency_runs',
      'topic_canonical_terms_v3',
    ])
      await pool.execute(`DELETE FROM ${table} WHERE snapshot_id=?`, [snapshot]);
    if (posts.length) await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    if (blogs.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [blogs]);
    await pool.execute('DELETE FROM topic_snapshots WHERE id=?', [snapshot]);
  }
}
