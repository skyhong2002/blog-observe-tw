import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { assertPublicApiPath, isPublicApiPath, PUBLIC_KINDS, PUBLIC_REVALIDATE_SECONDS } from '../src/lib/public-paths.ts';
import { PUBLIC_RETRY_MS, PublicGatewayError, publicInit, readPublic } from '../src/lib/public-read.ts';
import { EMPTY, json, PATHS } from './public-payloads.ts';

const SRC = join(import.meta.dirname, '../src');
const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const files = (dir: string): string[] =>
  readdirSync(join(SRC, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(SRC, path)).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

/* Whitelist ---------------------------------------------------------------- */

test('public gateway paths: the reads public pages make are allowed', () => {
  for (const path of [
    '/api/overview',
    '/api/catalog',
    '/api/catalog?limit=1',
    '/api/catalog?q=%E5%92%96&category=x&status=y&sort=latest&dir=desc&page=2&limit=50',
    '/api/catalog/authors?author=12&page=2',
    '/api/search?q=%E5%92%96%E5%95%A1&page=1&limit=20&blog=a-b',
    '/api/topics?days=30',
    '/api/topics/rss%3A12?days=7',
    '/api/relations?days=90',
    '/api/traffic',
    '/api/traffic?blog=some-blog',
    '/api/tags/%E6%97%85%E8%A1%8C',
    '/api/blogs/some-blog',
    '/api/blogs/some-blog/relations?days=90',
    '/api/blogs/some-blog/topics?days=90',
    '/api/blogs/some-blog/inference',
    '/api/blogs/some-blog/content',
  ])
    assert.equal(isPublicApiPath(path), true, path);
});

test('public gateway paths: private, auth, reader and admin reads are never public', () => {
  for (const path of [
    '/api/me/capabilities',
    '/api/me/follows',
    '/api/me/opml',
    '/me/feed.xml',
    '/me/opml',
    '/auth/me',
    '/auth/google?next=%2F',
    '/auth/logout',
    '/api/admin/session',
    '/api/admin/discovery',
    '/api/reader/list',
    '/api/auth/me',
    '/healthz',
    '/_migration/health',
    '/favicons/a.png',
  ])
    assert.equal(isPublicApiPath(path), false, path);
});

test('public gateway paths: no other origin, route, key or encoding trick', () => {
  for (const path of [
    'api/overview',
    '//evil.example/api/overview',
    'http://127.0.0.1:18160/api/overview',
    '/api/overview?',
    '/api/overview?x=1',
    '/api/overview#x',
    '/api/overview/',
    '/api/topics?days=30&days=7',
    '/api/topics?days=30&cookie=a',
    '/api/topics?authorization=a',
    `/api/catalog?q=${'a'.repeat(301)}`,
    '/api/blogs/..%2Fme%2Ffollows',
    '/api/blogs/a%2Fb',
    '/api/blogs/%2e%2e/content',
    '/api/blogs/a/../../me/follows',
    '/api/blogs/a\\b',
    '/api/blogs/a b',
    '/api/blogs/%E0%A4%A',
    '/api/blogs/a/b/c',
    '/api/tags/a?x=1',
    '/api/blogs/x/relations?days=7&blog=y',
  ])
    assert.equal(isPublicApiPath(path), false, path);
  assert.throws(() => assertPublicApiPath('/api/me/follows'), /Not a public gateway path/);
});

/* Read rules --------------------------------------------------------------- */

function fakeFetch(...answers: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit & { next?: { revalidate?: number } } }> = [];
  const fetcher = async (url: string, init: RequestInit & { next: { revalidate: number } }) => {
    calls.push({ url, init });
    const answer = answers.shift();
    if (!answer) throw new Error('unexpected fetch');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, fetcher };
}
const noWait = async () => {};

test('public read: a fixed cookie-free GET, cached for the ISR period', async () => {
  const { calls, fetcher } = fakeFetch(json(200, EMPTY.overview));
  assert.deepEqual(await readPublic('http://gw', '/api/overview', fetcher, noWait), { found: true, body: EMPTY.overview });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://gw/api/overview');
  const { init } = calls[0];
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.equal(init.next?.revalidate, PUBLIC_REVALIDATE_SECONDS);
  assert.equal(init.cache, undefined, 'no-store would make the page dynamic');
  assert.equal(init.credentials, undefined);
  assert.deepEqual(Object.keys(init.headers as Record<string, string>), ['accept']);
  assert.equal(PUBLIC_REVALIDATE_SECONDS, 120);
  assert.deepEqual(Object.keys(publicInit()).sort(), ['headers', 'method', 'next', 'redirect', 'signal']);
});

test('public read: 404 is "not found", never an empty success', async () => {
  const { fetcher } = fakeFetch(json(404, { error: 'blog not found' }));
  assert.deepEqual(await readPublic('http://gw', '/api/blogs/missing', fetcher, noWait), { found: false });
});

test('public read: other statuses, network failures and bad JSON throw (the last good page stays)', async () => {
  for (const answer of [json(500), json(400), json(401), json(403), new TypeError('fetch failed')]) {
    const { fetcher } = fakeFetch(answer);
    await assert.rejects(readPublic('http://gw', '/api/overview', fetcher, noWait), PublicGatewayError);
  }
  const { fetcher } = fakeFetch(new Response('<html>', { status: 200 }));
  await assert.rejects(readPublic('http://gw', '/api/overview', fetcher, noWait), PublicGatewayError);
});

test('public read: one retry for a transient 5xx, then it throws', async () => {
  const waits: number[] = [];
  const wait = async (ms: number) => {
    waits.push(ms);
  };
  const retried = fakeFetch(json(503, { error: 'relation_projection_busy' }), json(200, EMPTY.relations));
  assert.deepEqual(await readPublic('http://gw', '/api/relations?days=90', retried.fetcher, wait), {
    found: true,
    body: EMPTY.relations,
  });
  assert.equal(retried.calls.length, 2);
  assert.deepEqual(waits, [PUBLIC_RETRY_MS]);
  const failing = fakeFetch(json(503), json(503));
  await assert.rejects(readPublic('http://gw', '/api/relations?days=90', failing.fetcher, wait), (error: unknown) => {
    assert.ok(error instanceof PublicGatewayError);
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(failing.calls.length, 2);
});

test('public read: every valid empty answer is data, never a 404 or an error', async () => {
  for (const kind of PUBLIC_KINDS) {
    const { fetcher } = fakeFetch(json(200, EMPTY[kind]));
    assert.deepEqual(await readPublic('http://gw', PATHS[kind], fetcher, noWait), { found: true, body: EMPTY[kind] }, kind);
  }
});

test('public read: a 200 of the wrong shape throws, so the last good page stays (getBlog({}), traffic null, inference {})', async () => {
  for (const kind of PUBLIC_KINDS)
    for (const body of [{}, null, [], 'ok']) {
      const { fetcher } = fakeFetch(json(200, body));
      await assert.rejects(readPublic('http://gw', PATHS[kind], fetcher, noWait), (error: unknown) => {
        assert.ok(error instanceof PublicGatewayError, kind);
        assert.equal(error.status, 200);
        assert.match(error.message, new RegExp(`unexpected ${kind} payload`));
        return true;
      });
    }
});

test('public read: unused bodies are cancelled before the 404 answer, the retry and the throw', async () => {
  const cancelled: number[] = [];
  const response = (status: number) =>
    new Response(
      new ReadableStream({
        cancel: () => {
          cancelled.push(status);
        },
      }),
      { status },
    );
  assert.deepEqual(await readPublic('http://gw', '/api/blogs/missing', fakeFetch(response(404)).fetcher, noWait), { found: false });
  await assert.rejects(
    readPublic('http://gw', '/api/overview', fakeFetch(response(503), response(500)).fetcher, noWait),
    PublicGatewayError,
  );
  assert.deepEqual(cancelled, [404, 503, 500]);
});

test('public read: a private path is refused before any request', async () => {
  const { calls, fetcher } = fakeFetch(json(200));
  await assert.rejects(readPublic('http://gw', '/api/me/follows', fetcher, noWait), /Not a public gateway path/);
  await assert.rejects(readPublic('http://gw', '/auth/me', fetcher, noWait), /Not a public gateway path/);
  assert.equal(calls.length, 0);
});

/* Route contract (source) -------------------------------------------------- */

const ISR_PAGES = [
  'app/page.tsx',
  'app/ranking/page.tsx',
  'app/traffic/page.tsx',
  'app/blogs/page.tsx',
  'app/blogs/[slug]/page.tsx',
  'app/authors/page.tsx',
  'app/articles/page.tsx',
  'app/topics/page.tsx',
  'app/topics/[id]/page.tsx',
  'app/relations/page.tsx',
  'app/tags/page.tsx',
];

test('route contract: public pages are ISR for PUBLIC_REVALIDATE_SECONDS and read no request data', () => {
  for (const page of ISR_PAGES) {
    const source = read(page);
    assert.match(source, new RegExp(`^export const revalidate = ${PUBLIC_REVALIDATE_SECONDS};$`, 'm'), page);
    assert.doesNotMatch(source, /force-dynamic|force-static|searchParams|next\/headers|server-gateway|connection\(|noStore/, page);
  }
});

test('route contract: dynamic public routes render on demand, none at build', () => {
  for (const page of ['app/blogs/[slug]/page.tsx', 'app/topics/[id]/page.tsx']) {
    const source = read(page);
    assert.match(source, /^export const dynamicParams = true;$/m, page);
    assert.match(source, /export function generateStaticParams\(\) \{\n\s+return \[\];\n\}/, page);
  }
});

test('route contract: server components reach the gateway only through the public helper', () => {
  const offenders = files('.').filter((path) => {
    if (path.endsWith('lib/server-gateway.ts') || path.endsWith('lib/public-api.ts')) return false;
    const source = read(path);
    return /BLOG_GATEWAY_INTERNAL_URL|gatewayOrigin|from '@\/lib\/server-gateway'/.test(source);
  });
  assert.deepEqual(offenders, []);
});

test('route contract: server-only helpers stay out of client code', () => {
  for (const path of ['lib/public-api.ts', 'lib/server-gateway.ts']) assert.match(read(path), /^import 'server-only';$/m, path);
  for (const path of files('.')) {
    const source = read(path);
    if (!/^'use client';/.test(source)) continue;
    assert.doesNotMatch(source, /public-api|server-gateway|BLOG_GATEWAY_INTERNAL_URL/, relative(SRC, join(SRC, path)));
  }
  assert.doesNotMatch(read('lib/api.ts'), /process\.env|fetch\(/, 'api.ts is imported by client components');
});

test('route contract: private pages and reader data do not share the public cache', () => {
  for (const page of ['app/my/page.tsx', 'app/login/page.tsx', 'app/admin/page.tsx', 'app/admin/discovery/page.tsx']) {
    const source = read(page);
    assert.doesNotMatch(source, /public-api|export const revalidate/, page);
  }
  // The browser's session and reader reads stay no-store and credentialed, outside the public hook.
  for (const path of ['lib/session.ts', 'lib/admin-client.ts', 'components/ReaderList.tsx', 'components/follow-button.tsx'])
    assert.doesNotMatch(read(path), /use-public-json|public-paths/, path);
  // The query hook goes through the loader (whitelist, contracts, no cookies; behaviour in public-loader.test.ts).
  assert.match(read('lib/use-public-json.ts'), /createPublicLoader\(\)/);
  const loader = read('lib/public-loader.ts');
  assert.match(loader, /credentials: 'omit'/);
  assert.match(loader, /publicKindOf\(path\)/);
  assert.match(loader, /validPublicPayload\(kind, raw\)/);
});

test('route contract: query pages read the URL in the browser inside Suspense, with the baseline as fallback', () => {
  for (const page of [
    'app/blogs/page.tsx',
    'app/authors/page.tsx',
    'app/articles/page.tsx',
    'app/topics/page.tsx',
    'app/relations/page.tsx',
    'app/tags/page.tsx',
    'app/topics/[id]/page.tsx',
  ])
    assert.match(read(page), /<Suspense fallback=\{<\w+View [^>]*\/>\}>/, page);
  for (const path of files('.')) {
    const source = read(path);
    if (source.includes('useSearchParams()')) assert.match(source, /^'use client';/, path);
  }
});
