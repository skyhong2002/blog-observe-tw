import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_CONTRACTS, validPublicPayload } from '../src/lib/public-contracts.ts';
import { PUBLIC_KINDS, type PublicKind, publicKindOf } from '../src/lib/public-paths.ts';
import { EMPTY, PATHS } from './public-payloads.ts';

const clone = <T>(value: T): T => structuredClone(value);
// Synthetic shared-tag answer (app/src/relations/shared-tags.ts shape); no real article or blog.
const SHARED_HIT = {
  sourceArticleId: 1,
  sourceArticleUrl: 'https://a.example/p/1',
  sourceArticleTitle: '甲文',
  sourceArticlePublishedAt: '2026-10-01T00:00:00.000Z',
  targetArticleId: 2,
  targetArticleUrl: 'https://b.example/p/2',
  targetArticleTitle: '乙文',
  targetArticlePublishedAt: '2026-10-02T00:00:00.000Z',
  targetBlogSlug: 'b',
  targetBlogName: '乙',
  targetBlogId: 2,
  tagId: 9,
  label: '旅行',
  sourceType: 'rss-category',
  lastSeenAt: '2026-10-03T00:00:00.000Z',
  targetSourceType: 'rss-category',
  targetLastSeenAt: '2026-10-03T00:00:00.000Z',
  tagSourceType: 'rss-category',
  tagLastSeenAt: '2026-10-03T00:00:00.000Z',
  matchVersion: 'native-post-tags-v1',
};
const SHARED_READY = {
  status: 'ready',
  days: 90,
  items: [SHARED_HIT],
  truncated: false,
  sourceTagsTruncated: false,
  matchVersion: 'native-post-tags-v1',
  interpretation: '共同標籤僅表示原始文章標籤相同。',
};
// Synthetic link row (readBlogRelations projectEvidence shape); OLD_EVIDENCE is the five keys every gateway sent
// (no postId: that came with the newer keys).
const OLD_EVIDENCE = {
  postTitle: '甲文',
  postUrl: 'https://a.example/p/1',
  targetUrl: 'https://b.example/',
  anchor: '乙',
  publishedAt: '2026-10-01T00:00:00.000Z',
};
const OLD_KEYS = Object.keys(OLD_EVIDENCE);
const EVIDENCE = {
  ...OLD_EVIDENCE,
  postId: 1,
  sourceBlogId: 1,
  targetBlogId: 2,
  location: 'body',
  context: '提到乙。',
  observedAt: '2026-10-02T00:00:00.000Z',
  matchVersion: 'relations-v3',
  evidenceType: 'direct-link',
  contextSource: 'body',
};
const without = (value: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
const HIT_PROVENANCE = [
  'targetBlogSlug',
  'sourceType',
  'lastSeenAt',
  'targetSourceType',
  'targetLastSeenAt',
  'tagSourceType',
  'tagLastSeenAt',
];
/** EMPTY[kind] with one top-level key replaced (undefined deletes it). */
function with_(kind: PublicKind, key: string, value: unknown) {
  const payload = clone(EMPTY[kind]) as Record<string, unknown>;
  if (value === undefined) delete payload[key];
  else payload[key] = value;
  return payload;
}

test('contracts: every public path kind has one, and the fixture paths map to their kinds', () => {
  assert.deepEqual(Object.keys(PUBLIC_CONTRACTS).sort(), [...PUBLIC_KINDS].sort());
  for (const kind of PUBLIC_KINDS) assert.equal(publicKindOf(PATHS[kind]), kind, PATHS[kind]);
});

test('contracts: valid answers with no rows stay valid (empty lists, null profile, unavailable vocabulary)', () => {
  for (const kind of PUBLIC_KINDS) assert.equal(validPublicPayload(kind, EMPTY[kind]), true, kind);
  // Optional fields older gateways omit.
  assert.equal(validPublicPayload('overview', with_('overview', 'recentBlogs', undefined)), true);
  assert.equal(validPublicPayload('blogRelations', with_('blogRelations', 'evidence', undefined)), true);
  // F3 profile keys: absent (older gateway), every shared-tag state, and text similarity not yet analysed.
  for (const key of ['nonBodyEvidence', 'evidenceTruncated', 'nonBodyEvidenceTruncated', 'sharedTags', 'textSimilarity'])
    assert.equal(validPublicPayload('blogRelations', with_('blogRelations', key, undefined)), true, key);
  for (const value of [
    { status: 'not-enabled' },
    { status: 'unavailable', matchVersion: 'native-post-tags-v1' },
    { ...SHARED_READY, items: [] },
    SHARED_READY,
  ])
    assert.equal(validPublicPayload('blogRelations', with_('blogRelations', 'sharedTags', value)), true, JSON.stringify(value));
  assert.equal(validPublicPayload('blogRelations', with_('blogRelations', 'textSimilarity', { status: 'not-analysed' })), true);
  // Link rows: today's full row, an older gateway's five keys (no postId, anchor and date possibly null), and the
  // nulls the view says as 未提供.
  for (const row of [
    EVIDENCE,
    OLD_EVIDENCE,
    { ...OLD_EVIDENCE, anchor: null, publishedAt: null },
    without(EVIDENCE, 'postId'),
    {
      ...EVIDENCE,
      anchor: null,
      publishedAt: null,
      targetBlogId: null,
      context: null,
      observedAt: null,
      matchVersion: null,
      contextSource: null,
    },
  ])
    for (const key of ['evidence', 'nonBodyEvidence'])
      assert.equal(validPublicPayload('blogRelations', with_('blogRelations', key, [row])), true, `${key} ${JSON.stringify(row)}`);
  // A shared-tag hit from before the tag provenance keys were sent.
  assert.equal(
    validPublicPayload(
      'blogRelations',
      with_('blogRelations', 'sharedTags', { ...SHARED_READY, items: [without(SHARED_HIT, ...HIT_PROVENANCE)] }),
    ),
    true,
  );
  // A ready AI profile and provenance, a disabled/pending content status.
  assert.equal(
    validPublicPayload('blogInference', {
      ...(EMPTY.blogInference as object),
      profile: { bio: '寫旅行', topics: ['旅行'] },
      provenance: { coverage: 'rss-summary', modelAlias: 'm', updatedAt: '2026-10-12T00:00:00Z' },
      topics: [{ postId: 1, title: 't', topics: ['a'], coverage: 'rss-summary', updatedAt: null, label: 'AI 推定' }],
    }),
    true,
  );
  assert.equal(validPublicPayload('blogContent', { blog: { status: 'disabled', reason: null }, sources: [{ status: 'pending' }] }), true);
  assert.equal(
    validPublicPayload(
      'topics',
      with_('topics', 'items', [{ id: 'rss:1', label: '旅行', source: 'rss-category', score: 1, posts: 2, blogs: 2 }]),
    ),
    true,
  );
});

test('contracts: {}, null, arrays, text and HTML-ish answers are never a page', () => {
  for (const kind of PUBLIC_KINDS)
    for (const raw of [{}, null, undefined, [], 'ok', 0, true, { error: 'not found' }])
      assert.equal(validPublicPayload(kind, raw), false, `${kind} ${JSON.stringify(raw)}`);
});

test('contracts: each required container of the wrong type fails', () => {
  const cases: Array<[PublicKind, string, unknown]> = [
    ['overview', 'posts', null],
    ['overview', 'tags', {}],
    ['overview', 'totals', { blogs: '3', posts: 1 }],
    ['overview', 'recentBlogs', 'x'],
    ['catalog', 'blogs', [{ slug: 'a' }]],
    ['catalog', 'pagination', { page: 1, pages: 1, pageSize: 50 }],
    ['catalog', 'filters', null],
    ['authors', 'matchedAuthors', '0'],
    ['authors', 'filters', { author: '7' }],
    ['search', 'items', null],
    ['topics', 'items', [{ id: 1, label: 'x' }]],
    ['topics', 'vocabulary', null],
    ['topic', 'topic', null],
    ['topic', 'topic', { id: 'rss:1' }],
    ['topic', 'articles', undefined],
    ['relations', 'coverage', { observedPosts: 0 }],
    ['relations', 'mutual', undefined],
    ['relations', 'generatedAt', 0],
    ['traffic', 'blogs', null],
    ['tag', 'tag', null],
    ['tag', 'posts', {}],
    ['blog', 'blog', {}],
    ['blog', 'blog', { slug: 'a', name: '甲', tags: {} }],
    ['blog', 'posts', undefined],
    ['blogRelations', 'outgoing', undefined],
    ['blogRelations', 'coverage', null],
    ['blogRelations', 'nonBodyEvidence', {}],
    ['blogRelations', 'evidenceTruncated', 'false'],
    ['blogRelations', 'sharedTags', null],
    ['blogRelations', 'sharedTags', { status: 'ready' }],
    ['blogRelations', 'sharedTags', { status: 'unavailable' }],
    ['blogRelations', 'sharedTags', { status: 'off' }],
    ['blogRelations', 'sharedTags', { ...SHARED_READY, truncated: undefined }],
    ['blogRelations', 'sharedTags', { ...SHARED_READY, items: [{ ...SHARED_HIT, label: undefined }] }],
    ['blogRelations', 'sharedTags', { ...SHARED_READY, items: [{ ...SHARED_HIT, targetArticleId: '2' }] }],
    ['blogRelations', 'textSimilarity', 'not-analysed'],
    // Link rows: a missing or mistyped old key, or a rendered newer key that is an object or array, never reaches React.
    ...OLD_KEYS.map((key): [PublicKind, string, unknown] => ['blogRelations', 'evidence', [without(EVIDENCE, key)]]),
    ...OLD_KEYS.map((key): [PublicKind, string, unknown] => ['blogRelations', 'nonBodyEvidence', [without(OLD_EVIDENCE, key)]]),
    ['blogRelations', 'evidence', [{ ...EVIDENCE, postId: '1' }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, postId: null }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, postId: -1 }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, anchor: 7 }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, publishedAt: undefined }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, postTitle: null }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, context: {} }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, context: ['提到乙。'] }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, location: ['body'] }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, matchVersion: { v: 3 } }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, observedAt: [] }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, publishedAt: 0 }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, contextSource: {} }]],
    ['blogRelations', 'evidence', [{ ...EVIDENCE, targetBlogId: '2' }]],
    ['blogRelations', 'evidence', [EVIDENCE, 'row']],
    ['blogRelations', 'nonBodyEvidence', [{ ...EVIDENCE, location: 'comment', context: {} }]],
    ['blogRelations', 'nonBodyEvidence', [OLD_EVIDENCE, { ...OLD_EVIDENCE, anchor: [] }]],
    // Shared-tag provenance may be absent, but when sent it is text.
    ...HIT_PROVENANCE.map((key): [PublicKind, string, unknown] => [
      'blogRelations',
      'sharedTags',
      { ...SHARED_READY, items: [{ ...SHARED_HIT, [key]: {} }] },
    ]),
    ['blogRelations', 'sharedTags', { ...SHARED_READY, items: [{ ...SHARED_HIT, tagLastSeenAt: [] }] }],
    ['blogTopics', 'items', undefined],
    ['blogInference', 'label', undefined],
    ['blogInference', 'overridden', 'false'],
    ['blogInference', 'profile', 'bio'],
    ['blogInference', 'topics', null],
    ['blogContent', 'blog', null],
    ['blogContent', 'sources', undefined],
  ];
  for (const [kind, key, value] of cases)
    assert.equal(validPublicPayload(kind, with_(kind, key, value)), false, `${kind}.${key} = ${JSON.stringify(value)}`);
});

/* view=home ---------------------------------------------------------------- */

// Synthetic homepage rows: no real article, author or blog.
const HOME_TOPIC = { id: 'rss:1', label: '旅行', source: 'tag-vocabulary', score: 1.5, posts: 4, blogs: 2 };
const RECENT_BLOG = {
  id: 1,
  slug: 'a',
  name: '甲',
  url: 'https://a.example/',
  lastPublishedAt: '2026-10-01T00:00:00.000Z',
  iconUrl: null,
  latestPost: { id: 1, title: '甲文', url: 'https://a.example/p/1', publishedAt: '2026-10-01T00:00:00.000Z' },
};
const many = (n: number, row: object) => Array.from({ length: n }, () => row);

test('contracts: the homepage answers are their own kinds, full at their bounds', () => {
  const homeOverview = {
    ...(EMPTY.homeOverview as object),
    posts: many(7, { id: 1, title: '甲文' }),
    tags: many(30, { slug: '旅行', label: '旅行', postCount: 1, blogCount: 1 }),
    authors: many(8, { id: 1, displayName: '甲' }),
    recentBlogs: many(10, RECENT_BLOG),
    totals: { blogs: 10, posts: 70 },
    updatedAt: '2026-10-12T00:00:00.000Z',
  };
  assert.equal(validPublicPayload('homeOverview', homeOverview), true);
  // latestPost: null (no collected post), absent (looked up in posts), or what recentBlogRows reads, nulls included.
  const { latestPost: _latest, ...withoutLatest } = RECENT_BLOG;
  for (const blog of [
    { ...RECENT_BLOG, latestPost: null },
    withoutLatest,
    { ...RECENT_BLOG, latestPost: { ...RECENT_BLOG.latestPost, url: null, publishedAt: null } },
    { ...RECENT_BLOG, latestPost: without(RECENT_BLOG.latestPost, 'id') },
    { ...RECENT_BLOG, latestPost: { ...RECENT_BLOG.latestPost, title: '' } },
  ])
    assert.equal(validPublicPayload('homeOverview', with_('homeOverview', 'recentBlogs', [blog])), true, JSON.stringify(blog));
  const homeTopics = { ...(EMPTY.homeTopics as object), items: many(8, HOME_TOPIC), truncated: true };
  assert.equal(validPublicPayload('homeTopics', homeTopics), true);
  assert.equal(
    validPublicPayload('homeTopics', { ...homeTopics, items: [{ ...HOME_TOPIC, canonicalPath: '/topics/%E6%97%85%E8%A1%8C/' }] }),
    true,
  );
  // The compact overview is still an overview; the compact topics are not the full ranking (no vocabulary).
  assert.equal(validPublicPayload('overview', homeOverview), true);
  // The full overview's contract is unchanged: its recentBlogs rows are not checked further here.
  assert.equal(validPublicPayload('overview', { ...(EMPTY.overview as object), recentBlogs: [{ ...RECENT_BLOG, latestPost: {} }] }), true);
  assert.equal(validPublicPayload('topics', homeTopics), false);
});

test('contracts: a full payload cannot pass for a homepage one, nor a malformed compact one', () => {
  // The full answers, as /api/overview and /api/topics?days=30 send them: no view mark, full bounds, vocabulary.
  assert.equal(validPublicPayload('homeOverview', EMPTY.overview), false);
  assert.equal(validPublicPayload('homeTopics', EMPTY.topics), false);
  assert.equal(validPublicPayload('homeTopics', { ...(EMPTY.topics as object), view: 'home' }), false);
  const cases: Array<[PublicKind, string, unknown]> = [
    ['homeOverview', 'view', undefined],
    ['homeOverview', 'view', 'full'],
    ['homeOverview', 'view', 'HOME'],
    ['homeOverview', 'posts', many(8, {})],
    ['homeOverview', 'tags', many(31, {})],
    ['homeOverview', 'authors', many(9, {})],
    ['homeOverview', 'blogs', [RECENT_BLOG]],
    ['homeOverview', 'recentBlogs', undefined],
    ['homeOverview', 'recentBlogs', many(11, RECENT_BLOG)],
    ['homeOverview', 'recentBlogs', [{ ...RECENT_BLOG, slug: undefined }]],
    ['homeOverview', 'recentBlogs', [{ ...RECENT_BLOG, name: 1 }]],
    // A latestPost recentBlogRows would crash on (latest.title.trim) or misread.
    ...[
      {},
      [],
      'x',
      0,
      without(RECENT_BLOG.latestPost, 'title'),
      without(RECENT_BLOG.latestPost, 'url'),
      without(RECENT_BLOG.latestPost, 'publishedAt'),
      { ...RECENT_BLOG.latestPost, title: null },
      { ...RECENT_BLOG.latestPost, title: 1 },
      { ...RECENT_BLOG.latestPost, title: { text: '甲文' } },
      { ...RECENT_BLOG.latestPost, url: {} },
      { ...RECENT_BLOG.latestPost, url: 1 },
      { ...RECENT_BLOG.latestPost, publishedAt: 0 },
      { ...RECENT_BLOG.latestPost, publishedAt: [] },
      { ...RECENT_BLOG.latestPost, id: '1' },
      { ...RECENT_BLOG.latestPost, id: -1 },
      { ...RECENT_BLOG.latestPost, id: 1.5 },
      { ...RECENT_BLOG.latestPost, id: null },
    ].map((latestPost): [PublicKind, string, unknown] => ['homeOverview', 'recentBlogs', [{ ...RECENT_BLOG, latestPost }]]),
    ['homeOverview', 'totals', { blogs: '1', posts: 1 }],
    ['homeOverview', 'posts', null],
    ['homeTopics', 'view', undefined],
    ['homeTopics', 'view', 'full'],
    ['homeTopics', 'generatedAt', undefined],
    ['homeTopics', 'cacheSeconds', 60],
    ['homeTopics', 'cacheSeconds', undefined],
    ['homeTopics', 'days', '30'],
    ['homeTopics', 'source', 'rss-category'],
    ['homeTopics', 'items', undefined],
    ['homeTopics', 'items', many(9, HOME_TOPIC)],
    ['homeTopics', 'items', [{ ...HOME_TOPIC, label: undefined }]],
    ['homeTopics', 'items', [{ ...HOME_TOPIC, posts: '4' }]],
    ['homeTopics', 'items', [{ ...HOME_TOPIC, blogs: -1 }]],
    ['homeTopics', 'items', [{ ...HOME_TOPIC, source: 'other' }]],
    ['homeTopics', 'items', [{ ...HOME_TOPIC, canonicalPath: {} }]],
    ['homeTopics', 'truncated', 'false'],
    ['homeTopics', 'minimumBlogs', 1],
    ['homeTopics', 'limit', 100],
    ['homeTopics', 'vocabulary', (EMPTY.topics as { vocabulary: unknown }).vocabulary],
    ['homeTopics', 'coverage', { datedPosts: 0 }],
  ];
  for (const [kind, key, value] of cases)
    assert.equal(validPublicPayload(kind, with_(kind, key, value)), false, `${kind}.${key} = ${JSON.stringify(value)}`);
});
