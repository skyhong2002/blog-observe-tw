import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { detectTechnology } from './detector.ts';
import { registerTechRoutes } from './routes.ts';
import { recordTechObservation } from './store.ts';

export async function runTechRoutesIntegration(pool: Pool) {
  await assertEphemeralDatabase(pool);
  const app = Fastify();
  registerTechRoutes(app, pool, { enabled: true });
  const marker = `techroutes-${randomUUID()}`;
  const ids: number[] = [];
  const posts: number[] = [];
  const now = new Date();
  let offset = -60_000;
  let checks = 0;
  const check = (value: unknown, message: string) => {
    assert.ok(value, message);
    checks++;
  };
  const get = async (url: string) => {
    const r = await app.inject(url);
    check(r.headers['cache-control']?.includes('no-store'), 'always no-store');
    return r;
  };
  try {
    for (let i = 0; i < 6; i++) {
      const [r] = await pool.execute<ResultSetHeader>("INSERT INTO blogs(slug,name,url,status,discovered_at) VALUES(?,?,?,'verified',?)", [
        `${marker}-${i}`,
        `${marker} ${i}`,
        `https://${marker}-${i}.example/`,
        now,
      ]);
      ids.push(r.insertId);
      await pool.execute("INSERT INTO public_route_keys(kind,route_key,entity_id,created_at) VALUES('blog',?,?,?)", [
        `${marker}-readable-${i}`,
        String(r.insertId),
        now,
      ]);
      await pool.execute("INSERT INTO public_page_routes(kind,entity_id,canonical_key,created_at) VALUES('blog',?,?,?)", [
        String(r.insertId),
        `${marker}-readable-${i}`,
        now,
      ]);
    }
    const observe = async (i: number, extra = {}, sourcePostId?: number) => {
      const sourceUrl = `https://${marker}-${i}.example/${sourcePostId ? 'article' : ''}`;
      offset += 1000;
      const result = await recordTechObservation(pool, {
        blogId: ids[i],
        sourcePostId,
        sourceUrl,
        observation: detectTechnology({
          url: sourceUrl,
          html: '<meta name="generator" content="WordPress 6.8">',
          observedAt: new Date(now.getTime() + offset),
          ...extra,
        }),
      });
      check(result.written, 'fixture observation stored');
    };
    await observe(0);
    await observe(1, { html: '<p>No signals</p>' });
    await observe(2, { failureReason: 'timeout' });
    await observe(3, { httpStatus: 403 });
    await observe(4);
    await observe(4, { failureReason: 'network' });
    const list = async (query = '') => (await get(`/api/tech?q=${marker}${query}`)).json();
    const initial = await list();
    check(initial.items.length === 6, 'all visible fixture blogs');
    check(initial.coverage.totalBlogs === initial.coverage.scannedBlogs, 'untruncated denominator');
    check(
      ['detected', 'unknown', 'failed', 'blocked', 'notObserved'].reduce((sum, k) => sum + initial.coverage[k], 0) ===
        initial.coverage.totalBlogs,
      'exclusive status counts reconcile',
    );
    const retained = initial.items.find((b: { id: number }) => b.id === ids[4]);
    check(
      retained.status === 'failed' && retained.detections.length === 1 && retained.observedAt < retained.lastAttemptAt,
      'last success retained separately',
    );
    check(
      initial.items[0].slug === `${marker}-0` && initial.items[0].url.endsWith(`${marker}-readable-0/`),
      'stable slug and registry URL',
    );
    check((await list('&technology=wordpress')).items.length === 2, 'technology includes valid retained evidence');
    check((await list('&status=unknown')).items.length === 1, 'status filter');
    await observe(0, {
      html: '<link href="/wp-content/themes/astra/style.css"><script src="/wp-content/plugins/elementor/script.js"></script>',
    });
    for (const technology of ['wp-theme:astra', 'wp-plugin:elementor']) {
      const filtered = await list(`&technology=${encodeURIComponent(technology)}`);
      check(filtered.items.length === 1 && filtered.items[0].id === ids[0], 'theme/plugin returned IDs can be filtered');
    }
    for (const [url, expected] of [
      ['https://user:fixturecredential@example.com/', null],
      ['javascript:alert(1)', null],
      ['https://medium.com/@author', 'https://medium.com/@author'],
      ['https://example.com/?token=fixturequerysecret#fragment', 'https://example.com/'],
    ]) {
      await pool.execute('UPDATE blogs SET url=? WHERE id=?', [url, ids[5]]);
      const projected = (await get(`/api/blogs/${marker}-5/tech`)).json().blog;
      check(projected.sourceUrl === expected, 'unsafe source URL projected rather than returned raw');
      const listing = (await list()).items.find((b: { id: number }) => b.id === ids[5]);
      check(listing.sourceUrl === expected, 'list uses same safe source URL');
      for (const secret of ['fixturecredential', 'fixturequerysecret'])
        check((await get(`/api/tech?q=${secret}`)).json().items.length === 0, 'search cannot probe raw URL secrets');
    }

    const first = await list('&limit=2');
    const second = await list(`&limit=2&cursor=${first.pagination.nextCursor}`);
    check(
      first.items.length === 2 && second.items.length === 2 && first.items[1].id < second.items[0].id,
      'keyset pagination no duplicate',
    );
    check((await get('/api/tech?limit=101')).statusCode === 400, 'limit bounded');
    check((await get(`/api/blogs/${marker}-readable-0/tech`)).json().blog.id === ids[0], 'readable registry alias resolves');
    for (const state of ['seed', 'rejected', 'moved']) {
      await pool.execute('UPDATE blogs SET status=? WHERE id=?', [state, ids[0]]);
      check(!(await list()).items.some((b: { id: number }) => b.id === ids[0]), `list hides ${state} on next request`);
      check((await get(`/api/blogs/${marker}-0/tech`)).statusCode === 404, `detail hides ${state}`);
    }
    await pool.execute("UPDATE blogs SET status='verified' WHERE id=?", [ids[0]]);
    const [post] = await pool.execute<ResultSetHeader>(
      'INSERT INTO posts(blog_id,guid,url,title,published_at,created_at) VALUES(?,?,?,?,?,?)',
      [ids[0], marker, `https://${marker}-0.example/article`, 'public source', new Date(now.getTime() - 3600_000), now],
    );
    posts.push(post.insertId);
    await observe(0, {}, post.insertId);
    check((await get(`/api/blogs/${marker}-0/tech`)).json().blog.detections.length === 1, 'public source initially visible');
    await pool.execute('UPDATE posts SET published_at=? WHERE id=?', [new Date(now.getTime() + 3600_000), post.insertId]);
    check((await get(`/api/blogs/${marker}-0/tech`)).json().blog.status === 'not-observed', 'future source immediately masked');
    await pool.execute('DELETE FROM posts WHERE id=?', [post.insertId]);
    const removed = (await get(`/api/blogs/${marker}-0/tech`)).json().blog;
    check(
      removed.status === 'not-observed' && removed.detections.length === 0 && removed.evidenceSourceUrl === null,
      'deleted source immediately masked',
    );
    check((await list('&technology=wordpress')).items.length === 1, 'invalid source removed from aggregate/filter');
    const head = await app.inject({ method: 'HEAD', url: '/api/tech' });
    check(head.statusCode === 200 && head.body === '', 'HEAD supported');
    return { checks, isolatedPort: 18169, retainedSuccess: true, sourceDeletionImmediate: true };
  } finally {
    await app.close();
    if (ids.length) {
      await pool.query('DELETE FROM blog_tech_scans WHERE blog_id IN (?)', [ids]);
      await pool.query("DELETE FROM public_page_routes WHERE kind='blog' AND entity_id IN (?)", [ids.map(String)]);
      await pool.query("DELETE FROM public_route_keys WHERE kind='blog' AND entity_id IN (?)", [ids.map(String)]);
    }
    if (posts.length) await pool.query('DELETE FROM posts WHERE id IN (?)', [posts]);
    if (ids.length) await pool.query('DELETE FROM blogs WHERE id IN (?)', [ids]);
  }
}
