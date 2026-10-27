/** Read-only registry + HTTP acceptance. Run with the private DB env; never logs credentials. */
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';
import type { RowDataPacket } from 'mysql2/promise';
import { createDb } from '../../app/src/db/client.ts';
import { getIndexablePages } from '../../app/src/seo/indexability.ts';

const origin = 'https://weblog.tw';
const base = new URL(process.argv[2] ?? origin);
assert.ok(base.origin === origin || (base.hostname === '127.0.0.1' && base.protocol === 'http:'), 'verification_origin');
const store = createDb(undefined, { poolSize: 1 });
const xml = new XMLParser();
const array = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
async function request(path: string, method = 'GET') {
  assert.ok(path.startsWith('/') && !path.startsWith('//'));
  return fetch(base.origin + path, {
    method,
    redirect: 'manual',
    headers: { 'user-agent': 'BlogObserve-SEO-Verification/1.0' },
    signal: AbortSignal.timeout(45_000),
  });
}
async function canonicalPage(path: string) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert.deepEqual(
    [...html.matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1]),
    [origin + path],
    path,
  );
  assert.ok(!/noindex/i.test(response.headers.get('x-robots-tag') ?? ''), path);
  assert.ok(![...html.matchAll(/<meta name="robots" content="([^"]+)"/g)].some((m) => /noindex/i.test(m[1])), path);
}
try {
  const result: { checkedAt: string; base: string; redirects: unknown[]; sitemaps: unknown[]; api?: unknown } = {
    checkedAt: new Date().toISOString(),
    base: base.origin,
    redirects: [],
    sitemaps: [],
  };
  const [blogs] = await store.pool.query<RowDataPacket[]>(
    `SELECT b.slug old_key,r.canonical_key new_key FROM blogs b JOIN public_page_routes r ON r.kind='blog' AND r.entity_id=CAST(b.id AS CHAR)
     WHERE b.status='verified' AND b.slug LIKE 'discovered-%' AND r.canonical_key<>b.slug ORDER BY b.id LIMIT 5`,
  );
  const topics = (await getIndexablePages(store.pool, 'topic')).slice(0, 5).map((p) => ({ old_key: p.stableId, new_key: p.slug }));
  for (const [kind, rows] of [
    ['blogs', blogs],
    ['topics', topics],
  ] as const) {
    assert.equal(rows.length, 5, kind);
    for (const row of rows) {
      const oldPath = `/${kind}/${encodeURIComponent(row.old_key)}/`;
      const newPath = `/${kind}/${encodeURIComponent(row.new_key)}/`;
      assert.notEqual(oldPath, newPath);
      const response = await request(oldPath);
      assert.equal(response.status, 301, oldPath);
      assert.equal(response.headers.get('location'), newPath, oldPath);
      await response.body?.cancel();
      await canonicalPage(newPath);
      result.redirects.push({ oldUrl: origin + oldPath, statuses: [301, 200], newUrl: origin + newPath, canonical: origin + newPath });
    }
  }
  for (const path of ['/sitemap.xml', '/robots.txt']) {
    const response = await request(path, 'HEAD');
    assert.equal(response.status, 200, path);
  }
  const indexResponse = await request('/sitemap.xml');
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers.get('content-type') ?? '', /^application\/xml/);
  const index = await indexResponse.text();
  assert.ok(index.startsWith('<?xml') && index.trim() === index && !index.startsWith('\uFEFF'));
  for (const child of array<{ loc: string }>(xml.parse(index).sitemapindex.sitemap)) {
    const path = new URL(child.loc).pathname;
    assert.equal((await request(path, 'HEAD')).status, 200, path);
    const response = await request(path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type') ?? '', /^application\/xml/);
    const body = await response.text();
    assert.ok(body.startsWith('<?xml') && body.trim() === body && Buffer.byteLength(body) <= 50 * 1024 * 1024);
    const rows = array<{ loc: string; lastmod: string }>(xml.parse(body).urlset.url);
    assert.ok(rows.length <= 50_000);
    for (const row of rows) {
      const url = new URL(row.loc);
      assert.equal(url.origin, origin);
      assert.ok(row.lastmod && !url.search && url.pathname.endsWith('/'));
      assert.ok(!/^\/(?:blogs\/discovered-|topics\/(?:tag|rss):)/.test(decodeURIComponent(url.pathname)), row.loc);
    }
    const samples = [...new Set([0, Math.floor(rows.length / 2), rows.length - 1])].filter((i) => i >= 0 && i < rows.length);
    for (const index of samples) await canonicalPage(new URL(rows[index].loc).pathname);
    result.sitemaps.push({ url: child.loc, count: rows.length, allReadable: true, samples: samples.map((i) => rows[i].loc) });
  }
  const response = await request('/api/v1/blogs?limit=50');
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { items: { id: number; url: string; sourceUrl: string | null; iconUrl: string }[] };
  assert.ok(payload.items.length > 0);
  const [sources] = await store.pool.query<RowDataPacket[]>('SELECT id,url FROM blogs WHERE id IN (?)', [payload.items.map((b) => b.id)]);
  const urls = new Map(sources.map((b) => [String(b.id), b.url]));
  for (const blog of payload.items) {
    assert.equal(blog.sourceUrl, urls.get(String(blog.id)), 'v1 sourceUrl retains original source');
    assert.ok(blog.url.startsWith(origin + '/blogs/') && blog.url.endsWith('/'));
    assert.ok(!Object.hasOwn(blog, 'pageUrl'), 'no redundant pageUrl');
    assert.ok(blog.iconUrl, 'favicon retained');
  }
  result.api = { checkedBlogs: payload.items.length, originalSourcePreserved: true, readableUrl: true, iconsPresent: true };
  console.log(JSON.stringify(result, null, 2));
} finally {
  await store.close();
}
