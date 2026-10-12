import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  blogHref,
  indexabilityNote,
  isCanonicalPagePath,
  isPageKey,
  pageApiPath,
  pageInfoOf,
  pageKeyOf,
  TOPIC_DETAIL_PERIOD,
  topicHref,
} from '../src/lib/page-links.ts';
import { validPublicPayload } from '../src/lib/public-contracts.ts';
import { publicKindOf } from '../src/lib/public-paths.ts';
import { topicApiPath } from '../src/lib/public-query.ts';
import { readPublic } from '../src/lib/public-read.ts';
import { detailPageMetadata } from '../src/lib/seo.ts';
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
    TRAVEL, // Next already decoded once; an encoded param is a double-encoded URL
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

test('links prefer a valid canonicalPath, else the legacy stable URL; favicon/API keys are untouched', () => {
  assert.equal(blogHref('discovered-abc', '/blogs/example.com/'), '/blogs/example.com/');
  assert.equal(blogHref('discovered-abc'), '/blogs/discovered-abc/');
  // Invalid enrichment never wins.
  for (const bad of ['/blogs/example.com', '/topics/a/', 'https://x/blogs/a/', '/blogs/%2525/', '/blogs/a/?q=1'])
    assert.equal(blogHref('abc', bad), '/blogs/abc/', bad);
  assert.equal(topicHref(`tag:${HASH}`, `/topics/${TRAVEL}/`), `/topics/${TRAVEL}/`);
  assert.equal(topicHref(`tag:${HASH}`), `/topics/tag%3A${HASH}/`);
  // Detail pages default to 90 days; other periods keep ?days=.
  assert.equal(TOPIC_DETAIL_PERIOD, '90');
  assert.equal(topicHref('rss:1', `/topics/${TRAVEL}/`, '90'), `/topics/${TRAVEL}/`);
  assert.equal(topicHref('rss:1', `/topics/${TRAVEL}/`, '30'), `/topics/${TRAVEL}/?days=30`);
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
  assert.ok(validPublicPayload('topicPage', page('topicPage', { indexable: true, indexabilityReason: null, posts: 3, blogs: 2 })));
  const bad: Array<['blogPage' | 'topicPage', Record<string, unknown>]> = [
    ['topicPage', { windowDays: 30 }],
    ['topicPage', { canonicalPath: '/topics/旅行/' }],
    ['topicPage', { canonicalPath: `/topics/${TRAVEL}/?x` }],
    ['topicPage', { canonicalPath: '/topics/other/' }], // does not match slug
    ['topicPage', { stableId: `tag:${'cd'.repeat(32)}` }], // not tag:<entityId>
    ['topicPage', { stableId: 'rss:1' }],
    ['topicPage', { indexable: true }], // indexable with a reason
    ['topicPage', { posts: -1 }],
    ['topicPage', { blogs: '2' }],
    ['topicPage', { currentVersion: 1 }],
    ['blogPage', { stableId: 'Example.com' }],
    ['blogPage', { entityId: 12 }],
    ['blogPage', { canonicalPath: '/topics/example.com/' }],
    ['blogPage', { indexable: 'yes' }],
  ];
  for (const [kind, patch] of bad) assert.equal(validPublicPayload(kind, page(kind, patch)), false, JSON.stringify(patch));
  assert.equal(validPublicPayload('blogPage', page('topicPage')), false);
  assert.equal(pageInfoOf('topic', page('topicPage'))?.stableId, `tag:${'a'.repeat(64)}`);
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

test('metadata: canonical, OG and JSON-LD use canonicalPath; thin or unverified pages are noindex,follow', () => {
  const indexable = detailPageMetadata({ canonicalPath: `/topics/${TRAVEL}/`, indexable: true }, '「旅行」話題', 'd');
  assert.equal(indexable.alternates.canonical, `https://blog.observe.tw/topics/${TRAVEL}/`);
  assert.equal(indexable.openGraph.url, `https://blog.observe.tw/topics/${TRAVEL}/`);
  assert.equal((indexable as { robots?: unknown }).robots, undefined);
  const thin = detailPageMetadata({ canonicalPath: '/blogs/example.com/', indexable: false }, '甲', 'd');
  assert.deepEqual((thin as { robots?: unknown }).robots, { index: false, follow: true });
  assert.equal(thin.alternates.canonical, 'https://blog.observe.tw/blogs/example.com/');
  for (const file of ['app/blogs/[slug]/page.tsx', 'app/topics/[id]/page.tsx']) {
    const text = source(file);
    assert.match(text, /breadcrumbSchema\(\[\s*\[[^\]]+\],\s*\[page\.canonicalPath,/, file);
    // Unknown keys and gateway 404s are real 404s; ISR, no request-time reads.
    assert.match(text, /if \(!page\) notFound\(\);/, file);
    assert.match(text, /export const revalidate = 120;/, file);
  }
  assert.match(source('app/topics/[id]/page.tsx'), /topicApiPath\(page\.stableId, TOPIC_DETAIL_PERIOD\)/);
  assert.match(source('app/blogs/[slug]/page.tsx'), /getBlog\(page\.stableId\)/);
});

test('indexability note: the 90-day counts and thresholds, separate from the period tabs', () => {
  assert.equal(indexabilityNote({ indexable: true, indexabilityReason: null, posts: 9, blogs: 4 }, 'topic'), null);
  const note = indexabilityNote({ indexable: false, indexabilityReason: 'insufficient-blogs', posts: 5, blogs: 1 }, 'topic') ?? '';
  assert.match(note, /近 90 天 5 篇、1 個部落格/);
  assert.match(note, /至少 3 篇、2 個部落格/);
  assert.match(
    indexabilityNote({ indexable: false, indexabilityReason: 'unverified-or-invalid-url', posts: 0, blogs: 0 }, 'blog') ?? '',
    /尚未核准/,
  );
  assert.ok(indexabilityNote({ indexable: false, indexabilityReason: 'unknown-future', posts: 0, blogs: 0 }, 'blog'));
});
