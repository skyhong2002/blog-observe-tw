import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  blogHref,
  isCanonicalPagePath,
  isPageKey,
  pageApiPath,
  pageInfoOf,
  pageKeyOf,
  pageKeyOfParam,
  TOPIC_DETAIL_PERIOD,
  topicHref,
} from '../src/lib/page-links.ts';
import { validPublicPayload } from '../src/lib/public-contracts.ts';
import { publicKindOf } from '../src/lib/public-paths.ts';
import { topicApiPath } from '../src/lib/public-query.ts';
import { readPublic } from '../src/lib/public-read.ts';
import { pageMetadata } from '../src/lib/seo.ts';
import { EMPTY, json } from './public-payloads.ts';

const HASH = 'ab'.repeat(32);
const TRAVEL = '%E6%97%85%E8%A1%8C'; // 旅行
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('route keys: readable, legacy and topic ids pass; malformed or still-encoded params never do', () => {
  for (const key of ['旅行', 'example.com', 'c.js', 'a_b-c', 'discovered-abc', 'abc-', 'Ünïcode', '日本語2026'])
    assert.ok(isPageKey('blog', key), key);
  for (const key of ['旅行', 'react', `tag:${HASH}`, 'rss:42']) assert.ok(isPageKey('topic', key), key);
  for (const key of [
    '',
    TRAVEL, // isPageKey takes decoded keys; pageKeyOfParam decodes the Next param
    '%2F',
    '%25',
    '%',
    'a/b',
    'a%2Fb',
    'a\\b',
    'a?b',
    'a#b',
    'a b',
    'a\u0000b',
    '.',
    '..',
    'a..b',
    '-a',
    'a.',
    `tag:${HASH}`, // not a blog key
    `tag:${HASH.toUpperCase()}`,
    'rss:0',
    'x'.repeat(181),
  ])
    for (const kind of ['blog', 'topic'] as const)
      if (!(kind === 'topic' && key === `tag:${HASH}`)) assert.equal(isPageKey(kind, key), false, `${kind} ${JSON.stringify(key)}`);
  assert.equal(isPageKey('topic', 'abc-'), false);
});

test('canonical paths: one /blogs|topics/ segment, encoded exactly once, no query, fragment or authority', () => {
  assert.equal(pageKeyOf('topic', `/topics/${TRAVEL}/`), '旅行');
  assert.equal(pageKeyOf('blog', '/blogs/example.com/'), 'example.com');
  assert.equal(pageKeyOf('topic', `/topics/tag%3A${HASH}/`), `tag:${HASH}`);
  for (const [kind, path] of [
    ['topic', '/topics/旅行/'], // raw Unicode: not encoded
    ['topic', `/topics/${TRAVEL.toLowerCase()}/`], // non-canonical escapes
    ['topic', '/topics/%25E6%2597%2585/'], // double-encoded
    ['topic', `/topics/${TRAVEL}`], // no trailing slash
    ['topic', `/topics/${TRAVEL}/?days=7`],
    ['topic', `/topics/${TRAVEL}/#x`],
    ['topic', `/blogs/${TRAVEL}/`], // other kind
    ['blog', '/blogs/a/b/'],
    ['blog', '/blogs/a%2Fb/'],
    ['blog', '/blogs//evil.example/'],
    ['blog', '//evil.example/blogs/a/'],
    ['blog', 'https://blog.observe.tw/blogs/a/'],
    ['blog', '/blogs/%E0%A4%A/'],
    ['blog', '/blogs/../'],
    ['blog', '/blogs/'],
    ['blog', `/topics/tag%3A${HASH}/`],
    ['blog', '/blogs/tag:x/'],
    ['blog', null],
    ['blog', 42],
  ] as const)
    assert.equal(pageKeyOf(kind, path), null, `${kind} ${String(path)}`);
});

// The param Next 16 really hands page code for a request path: its route
// matcher decodes the segment once, then getDynamicParam re-encodes the value
// passed to user code (encodeURIComponent).
const nextRequire = createRequire(import.meta.url);
const { getRouteRegex } = nextRequire('next/dist/shared/lib/router/utils/route-regex.js');
const { getRouteMatcher } = nextRequire('next/dist/shared/lib/router/utils/route-matcher.js');
const { getDynamicParam } = nextRequire('next/dist/shared/lib/router/utils/get-dynamic-param.js');
function nextParam(route: '/blogs/[slug]' | '/topics/[id]', pathname: string): string | null {
  const name = route === '/blogs/[slug]' ? 'slug' : 'id';
  const params = getRouteMatcher(getRouteRegex(route))(pathname);
  return params ? getDynamicParam(params, name, 'd', null, []).value : null;
}

test('Next params: the page param is still percent-encoded and is decoded exactly once', () => {
  const SECURITY = '%E8%B3%87%E8%A8%8A%E5%AE%89%E5%85%A8'; // 資訊安全, the production 404
  // Fixtures from Next's own matcher: the value is encoded, not the decoded key.
  assert.equal(nextParam('/topics/[id]', `/topics/${SECURITY}/`), SECURITY);
  assert.equal(nextParam('/topics/[id]', `/topics/tag:${HASH}/`), `tag%3A${HASH}`);
  assert.equal(nextParam('/topics/[id]', '/topics/ai/'), 'ai');
  for (const [kind, route, path, key] of [
    ['topic', '/topics/[id]', `/topics/${SECURITY}/`, '資訊安全'],
    ['topic', '/topics/[id]', `/topics/${TRAVEL}/`, '旅行'],
    ['topic', '/topics/[id]', '/topics/ai/', 'ai'],
    ['topic', '/topics/[id]', `/topics/tag:${HASH}/`, `tag:${HASH}`],
    ['topic', '/topics/[id]', `/topics/tag%3A${HASH}/`, `tag:${HASH}`],
    ['topic', '/topics/[id]', '/topics/rss%3A42/', 'rss:42'],
    ['blog', '/blogs/[slug]', '/blogs/example.com/', 'example.com'],
    ['blog', '/blogs/[slug]', `/blogs/${TRAVEL}/`, '旅行'],
    ['blog', '/blogs/[slug]', '/blogs/discovered-abc/', 'discovered-abc'],
  ] as const)
    assert.equal(pageKeyOfParam(kind, nextParam(route, path)), key, path);
  // Should Next ever pass the decoded key, it is accepted as is (no '%' to decode).
  assert.equal(pageKeyOfParam('topic', '資訊安全'), '資訊安全');
  assert.equal(pageKeyOfParam('topic', `tag:${HASH}`), `tag:${HASH}`);
  // Double encoding, encoded slash/backslash/authority/query/fragment never reach the page API.
  for (const path of [
    '/topics/%252F/',
    '/topics/a%252Fb/',
    '/topics/%25E8%25B3%2587%25E8%25A8%258A/', // 資訊 encoded twice
    `/topics/tag%253A${HASH}/`,
    '/topics/a%2Fb/',
    '/topics/%2F%2Fevil.example/',
    '/topics/a%5Cb/',
    '/topics/%5C%5Cevil.example/',
    '/topics/evil%40example.com/',
    '/topics/a%3Fdays%3D7/',
    '/topics/a%23x/',
    '/topics/a%20b/',
    '/topics/a%00b/',
    '/topics/%2E%2E/',
    '/topics/a%3Ab/',
  ]) {
    const param = nextParam('/topics/[id]', path);
    assert.notEqual(param, null, `${path} reaches the page`);
    assert.equal(pageKeyOfParam('topic', param), null, path);
    assert.equal(pageKeyOfParam('blog', nextParam('/blogs/[slug]', path.replace('/topics/', '/blogs/'))), null, path);
  }
  // Malformed or non-canonical params Next could not produce.
  for (const raw of ['%E0%A4%A', '%', SECURITY.toLowerCase(), 'a%2fb', '', null, 42, `x${'%41'.repeat(700)}`])
    assert.equal(pageKeyOfParam('topic', raw), null, String(raw));
});

test('page routes: getPublicPage is the one decoding boundary and asks the page API with the key encoded once', () => {
  const api = source('lib/public-api.ts');
  assert.match(api, /getPublicPage\(kind: PageKind, param: string\)[\s\S]*?const key = pageKeyOfParam\(kind, param\);/);
  assert.match(api, /pageApiPath\(kind, key\)/);
  assert.ok(!/decodeURIComponent|decodeParam/.test(api));
  const param = '%E8%B3%87%E8%A8%8A%E5%AE%89%E5%85%A8';
  assert.equal(pageApiPath('topic', pageKeyOfParam('topic', param) as string), `/api/pages/topics/${param}`);
});

test('links prefer a valid canonicalPath, else the legacy stable URL; favicon/API keys are untouched', () => {
  assert.equal(blogHref('discovered-abc', '/blogs/example.com/'), '/blogs/example.com/');
  assert.equal(blogHref('discovered-abc'), '/blogs/discovered-abc/');
  // Invalid enrichment never wins.
  for (const bad of ['/blogs/example.com', '/topics/a/', 'https://x/blogs/a/', '/blogs/%2525/', '/blogs/a/?q=1'])
    assert.equal(blogHref('abc', bad), '/blogs/abc/', bad);
  assert.equal(topicHref(`tag:${HASH}`, `/topics/${TRAVEL}/`), `/topics/${TRAVEL}/`);
  assert.equal(topicHref(`tag:${HASH}`), `/topics/tag%3A${HASH}/`);
  // Detail pages default to 30 days, as before readable URLs; other periods keep ?days=.
  assert.equal(TOPIC_DETAIL_PERIOD, '30');
  assert.equal(topicHref('rss:1', `/topics/${TRAVEL}/`, '30'), `/topics/${TRAVEL}/`);
  assert.equal(topicHref('rss:1', `/topics/${TRAVEL}/`, '90'), `/topics/${TRAVEL}/?days=90`);
  assert.equal(topicHref('rss:1', `/topics/${TRAVEL}/`, '7'), `/topics/${TRAVEL}/?days=7`);
  assert.ok(isCanonicalPagePath('blog', '/blogs/abc/'));
  // Components keep the stable slug for icons, follow and API reads, the canonical only for hrefs.
  for (const file of ['components/public/BlogCatalog.tsx', 'components/public/TopicDetail.tsx', 'components/RelationLists.tsx'])
    assert.ok(!/BlogIcon media=\{[^}]*canonicalPath/i.test(source(file)), file);
  assert.match(source('components/SourceProfile.tsx'), /<FollowButton slug=\{blog\.slug\} \/>/);
  assert.match(source('components/SourceProfile.tsx'), /<BlogIcon media=\{blog\.slug\}/);
  assert.ok(!/\/blogs\/\$\{|\/topics\/\$\{/.test(source('app/page.tsx')), 'home builds page links through page-links.ts');
});

test('page API paths: the decoded key is encoded once and is a public, query-free path', () => {
  assert.equal(pageApiPath('topic', '旅行'), `/api/pages/topics/${TRAVEL}`);
  assert.equal(pageApiPath('topic', `tag:${HASH}`), `/api/pages/topics/tag%3A${HASH}`);
  assert.equal(pageApiPath('blog', 'example.com'), '/api/pages/blogs/example.com');
  assert.equal(publicKindOf(pageApiPath('topic', '旅行')), 'topicPage');
  assert.equal(publicKindOf(pageApiPath('blog', 'discovered-abc')), 'blogPage');
  for (const path of [
    '/api/pages/blogs/a?x=1',
    '/api/pages/blogs/a/b',
    '/api/pages/blogs/a%2Fb',
    '/api/pages/blogs/..',
    '/api/pages/topics/',
    '/api/pages/other/a',
  ])
    assert.equal(publicKindOf(path), null, path);
  // Legacy ids still read the existing entity APIs by stable id.
  assert.equal(topicApiPath(`tag:${HASH}`, '90'), `/api/topics/tag%3A${HASH}?days=90`);
});

const page = (kind: 'blogPage' | 'topicPage', patch: Record<string, unknown> = {}) => ({
  page: { ...(EMPTY[kind] as { page: object }).page, ...patch },
});

test('page API contract: every field is checked, canonicalPath must match the slug', () => {
  assert.ok(validPublicPayload('blogPage', page('blogPage')));
  assert.ok(validPublicPayload('topicPage', page('topicPage')));
  assert.ok(validPublicPayload('topicPage', page('topicPage', { posts: 1, blogs: 1 })));
  // Legacy indexability fields, if the gateway still sends them, are ignored rather than validated or used.
  const legacy = page('topicPage', { indexable: false, indexabilityReason: 'insufficient-posts' });
  assert.ok(validPublicPayload('topicPage', legacy));
  assert.ok(!('indexable' in (pageInfoOf('topic', legacy) ?? {})));
  const bad: Array<['blogPage' | 'topicPage', Record<string, unknown>]> = [
    ['topicPage', { windowDays: 30 }],
    ['topicPage', { canonicalPath: '/topics/旅行/' }],
    ['topicPage', { canonicalPath: `/topics/${TRAVEL}/?x` }],
    ['topicPage', { canonicalPath: '/topics/other/' }], // does not match slug
    ['topicPage', { stableId: `tag:${'cd'.repeat(32)}` }], // not tag:<entityId>
    ['topicPage', { stableId: 'rss:1' }],
    ['topicPage', { posts: -1 }],
    ['topicPage', { blogs: '2' }],
    ['topicPage', { currentVersion: 1 }],
    ['blogPage', { stableId: 'Example.com' }],
    ['blogPage', { entityId: 12 }],
    ['blogPage', { canonicalPath: '/topics/example.com/' }],
  ];
  for (const [kind, patch] of bad) assert.equal(validPublicPayload(kind, page(kind, patch)), false, JSON.stringify(patch));
  assert.equal(validPublicPayload('blogPage', page('topicPage')), false);
  assert.equal(pageInfoOf('topic', page('topicPage'))?.stableId, `tag:${'a'.repeat(64)}`);
});

test('page API contract: a topic window is 90 days or null (cumulative history); a blog window is always 90', () => {
  // app/src/seo/indexability.ts getPageIndexability with history reads on.
  const cumulative = page('topicPage', { windowDays: null, currentVersion: null, posts: 12, blogs: 3 });
  assert.ok(validPublicPayload('topicPage', cumulative));
  assert.deepEqual(
    { windowDays: pageInfoOf('topic', cumulative)?.windowDays, currentVersion: pageInfoOf('topic', cumulative)?.currentVersion },
    { windowDays: null, currentVersion: null },
    'null is kept, never rewritten to 90',
  );
  assert.equal(pageInfoOf('topic', page('topicPage'))?.windowDays, 90);
  assert.equal(pageInfoOf('topic', page('topicPage', { currentVersion: 'v1' }))?.currentVersion, 'v1');
  assert.equal(pageInfoOf('blog', page('blogPage'))?.windowDays, 90);
  assert.equal(validPublicPayload('blogPage', page('blogPage', { windowDays: null })), false);
  assert.equal(pageInfoOf('blog', page('blogPage', { windowDays: null })), null);
  for (const windowDays of [undefined, 0, 30, 365, '90', Number.NaN])
    for (const kind of ['blogPage', 'topicPage'] as const)
      assert.equal(validPublicPayload(kind, page(kind, { windowDays })), false, `${kind} ${String(windowDays)}`);
});

test('page API reads: unknown is a 404 (null), a wrong-shaped 200 throws, no cookies are sent', async () => {
  const seen: RequestInit[] = [];
  const fetcher = (status: number, body?: unknown) => async (_url: string, init: RequestInit) => {
    seen.push(init);
    return json(status, body);
  };
  const path = pageApiPath('topic', '旅行');
  assert.deepEqual(await readPublic('http://gw', path, fetcher(404, { error: 'not_found' })), { found: false });
  const ok = await readPublic('http://gw', path, fetcher(200, page('topicPage')));
  assert.equal(ok.found, true);
  await assert.rejects(readPublic('http://gw', path, fetcher(200, page('topicPage', { canonicalPath: '/x/' }))));
  for (const init of seen) assert.deepEqual(init.headers, { accept: 'application/json' });
});

test('metadata: canonical, OG and JSON-LD use canonicalPath; every registered page is a normal indexable page', () => {
  const meta = pageMetadata(`/topics/${TRAVEL}/`, '「旅行」話題', 'd');
  assert.equal(meta.alternates.canonical, `https://blog.observe.tw/topics/${TRAVEL}/`);
  assert.equal(meta.openGraph.url, `https://blog.observe.tw/topics/${TRAVEL}/`);
  assert.equal((meta as { robots?: unknown }).robots, undefined);
  for (const file of ['app/blogs/[slug]/page.tsx', 'app/topics/[id]/page.tsx']) {
    const text = source(file);
    assert.match(text, /generateMetadata[\s\S]*pageMetadata\(\s*page\.canonicalPath,/, file);
    assert.match(text, /breadcrumbSchema\(\[\s*\[[^\]]+\],\s*\[page\.canonicalPath,/, file);
    // No robots decision from counts, blog status or term activity: unknown/noise keys are the gateway's 404.
    assert.ok(!/robots|indexab|noindex|\.posts|\.blogs/.test(text), file);
    // Unknown keys and gateway 404s are real 404s.
    assert.match(text, /if \(!page\) notFound\(\);/, file);
  }
  // Blog detail stays ISR; topic detail renders per request so the gateway's article visibility is never stale.
  assert.match(source('app/blogs/[slug]/page.tsx'), /export const revalidate = 120;/);
  assert.match(source('app/topics/[id]/page.tsx'), /export const dynamic = 'force-dynamic';/);
  assert.doesNotMatch(source('app/topics/[id]/page.tsx'), /export const revalidate/);
  assert.match(source('app/topics/[id]/page.tsx'), /topicApiPath\(page\.stableId, TOPIC_DETAIL_PERIOD\)/);
  // The page carries recent and accumulated articles: its description names no fixed period.
  assert.match(source('app/topics/[id]/page.tsx'), /topicPageDescription\(label\)/);
  assert.match(source('app/blogs/[slug]/page.tsx'), /getBlog\(page\.stableId\)/);
  for (const file of ['components/SourceProfile.tsx', 'components/public/TopicDetail.tsx', 'lib/seo.ts', 'lib/page-links.ts'])
    assert.ok(!/indexabilityNote|detailPageMetadata|搜尋引擎索引/.test(source(file)), file);
});

test('topic articles: original links carry open_original; blog links never do', () => {
  const text = source('components/public/TopicDetail.tsx');
  assert.match(text, /const href = externalHref\(url\);\s*if \(!href\) return <span/);
  assert.match(text, /<a\s+href=\{href\}\s+data-analytics="open_original"/);
  assert.match(text, /<ArticleTitle url=\{a\.url\} title=\{a\.title\} \/>/);
  assert.equal(text.match(/open_original/g)?.length, 2); // the doc comment and the one anchor
  assert.match(text, /<Link \{\.\.\.blogLink\(a\.blogSlug, a\.blogCanonicalPath\)\}>/);
});
