/**
 * Minimal public gateway payloads, shaped after the routes in app/src (read
 * only). `EMPTY` holds the valid answers that carry no rows — no posts, no
 * topics, no relations, no traffic, no AI profile — which pages must keep
 * rendering as normal states.
 */
import type { PublicKind } from '../src/lib/public-paths.ts';

const vocabulary = { status: 'unavailable', source: 'tag-vocabulary', version: null, coverage: null, syncedAt: null, window: null };
const relationCoverage = {
  observedPosts: 0,
  totalPosts: 0,
  failedPosts: 0,
  noBodyPosts: 0,
  unknownDatePosts: 0,
  unresolvedLinks: 0,
  truncatedPosts: 0,
  sampledAt: null,
  method: 'distinct-published-article-to-blog/body-only',
  nonBodyLinks: { sidebar: 0, blogroll: 0, comment: 0 },
  graphTruncated: false,
  aggregationTruncated: false,
};
const pagination = { page: 1, pages: 1, pageSize: 50, total: 0 };
/** app/src/tech/routes.ts METHOD (synthetic wording). */
export const techMethod = {
  id: 'passive-existing-response',
  partial: true,
  additionalRequests: false,
  description: '僅辨識既有公開回應中的部分線索（synthetic fixture）。',
};
/** A public blog with no technology observation yet (the gateway's not-observed row). Synthetic. */
export const notObservedBlog = {
  id: 1,
  slug: 'a',
  name: '甲',
  url: 'https://blog.observe.tw/blogs/a/',
  sourceUrl: 'https://a.example/',
  iconUrl: null,
  status: 'not-observed',
  observedAt: null,
  lastAttemptAt: null,
  errorCode: null,
  evidenceSourceUrl: null,
  coverage: null,
  detections: [],
};

/** Valid answers with no rows. One per public kind. */
export const EMPTY: Record<PublicKind, unknown> = {
  collectionCount: { blogs: 0 },
  overview: { posts: [], tags: [], authors: [], blogs: [], recentBlogs: [], totals: { blogs: 0, posts: 0 }, updatedAt: null },
  catalog: {
    blogs: [],
    totals: { blogs: 0, posts: 0, withUrls: 0, authors: 0 },
    updatedAt: null,
    categories: [],
    statuses: [],
    pagination,
    filters: { q: '', category: '', status: '', sort: 'name', dir: 'asc', page: 1, limit: 50 },
  },
  authors: {
    authors: [],
    totals: { authors: 0, relationships: 0 },
    matchedAuthors: 0,
    pagination,
    filters: { author: null, page: 1, limit: 50 },
  },
  search: {
    items: [],
    pagination: { page: 1, pageSize: 20, hasMore: false },
    coverage: { limit: 1000, scannedPosts: 0, truncated: false },
    query: 'x',
  },
  topics: { days: 30, vocabulary, coverage: { datedPosts: 0 }, items: [], truncated: false, minimumBlogs: 2, limit: 100 },
  topic: { days: 30, vocabulary, topic: { id: 'rss:1', label: '旅行', source: 'rss-category' }, blogs: [], articles: [], truncated: false },
  relations: {
    days: 90,
    generatedAt: '2026-10-12T00:00:00.000Z',
    nodes: [],
    edges: [],
    mostMentioned: [],
    mutual: [],
    coverage: relationCoverage,
  },
  traffic: { source: 'similarweb-extension', scope: 'domain', limitations: '整個網域的估算。', blogs: [] },
  tag: { tag: { id: 1, slug: '旅行', label: '旅行' }, posts: [], blogs: [] },
  blog: { blog: { id: 1, slug: 'a', name: '甲', authors: [], tags: [] }, posts: [] },
  blogRelations: {
    days: 90,
    generatedAt: '2026-10-12T00:00:00.000Z',
    mostMentioned: [],
    mutual: [],
    coverage: relationCoverage,
    blogId: 1,
    nodes: [{ id: 1, slug: 'a', name: '甲' }],
    edges: [],
    outgoing: [],
    incoming: [],
    evidence: [],
    profileTruncated: false,
  },
  blogTopics: { days: 90, vocabulary, items: [], truncated: false, minimumBlogs: 1 },
  blogInference: { label: 'AI 推定', profile: null, overridden: false, provenance: null, topics: [] },
  blogContent: {
    blog: { slug: 'a', name: '甲', platform: null, lastMethod: null, status: null },
    sources: [],
    publicContent: 'summary-only',
  },
  // app/src/tech/routes.ts: zero counts and no rows are a valid answer, never shown as an error.
  tech: {
    generatedAt: '2026-10-12T00:00:00.000Z',
    method: techMethod,
    coverage: { totalBlogs: 0, scannedBlogs: 0, truncated: false, detected: 0, unknown: 0, failed: 0, blocked: 0, notObserved: 0 },
    technologies: [],
    items: [],
    pagination: { limit: 50, nextCursor: null, total: 0 },
    filters: { q: '', technology: '', status: '' },
  },
  blogTech: { generatedAt: '2026-10-12T00:00:00.000Z', method: techMethod, blog: notObservedBlog },
  // app/src/blog-suggestions.ts loadBlogQueue: an empty queue is a valid answer.
  blogQueue: {
    filters: { q: '', state: '', source: '', page: 1 },
    pagination: { page: 1, pages: 1, total: 0 },
    states: { waiting: 0, failed: 0, listed: 0, rejected: 0 },
    sources: {},
    items: [],
  },
  // view=home (app/src/overview.js loadHomeProjection, topics/routes.ts): marked, bounded, no directory rows,
  // and no vocabulary or coverage on the topic list.
  homeOverview: {
    view: 'home',
    generatedAt: '2026-10-12T00:00:00.000Z',
    cacheSeconds: 0,
    posts: [],
    tags: [],
    authors: [],
    blogs: [],
    recentBlogs: [],
    totals: { blogs: 0, posts: 0 },
    updatedAt: null,
    // app/src/relations/home-feed.ts: a bounded 90-day window with no body citations is a valid empty answer.
    mentions: {
      days: 90,
      evidenceType: 'direct-link',
      location: 'body',
      limit: 8,
      truncated: false,
      generatedAt: '2026-10-12T00:00:00.000Z',
      items: [],
    },
  },
  homeTopics: {
    view: 'home',
    generatedAt: '2026-10-12T00:00:00.000Z',
    cacheSeconds: 0,
    days: 30,
    source: 'tag-vocabulary',
    items: [],
    truncated: false,
    minimumBlogs: 2,
    limit: 8,
  },
  // app/src/seo/page-api.ts: zero counts are a valid registered page (counts never gate indexing).
  blogPage: {
    page: {
      entityId: '12',
      stableId: 'discovered-abc',
      slug: 'example.com',
      canonicalPath: '/blogs/example.com/',
      windowDays: 90,
      posts: 0,
      blogs: 0,
      currentVersion: null,
    },
  },
  topicPage: {
    page: {
      entityId: 'a'.repeat(64),
      stableId: `tag:${'a'.repeat(64)}`,
      slug: '旅行',
      canonicalPath: '/topics/%E6%97%85%E8%A1%8C/',
      windowDays: 90,
      posts: 0,
      blogs: 0,
      currentVersion: null,
    },
  },
};

/** A path answering each kind. */
export const PATHS: Record<PublicKind, string> = {
  collectionCount: '/api/collection-count',
  overview: '/api/overview',
  catalog: '/api/catalog?sort=latest',
  authors: '/api/catalog/authors?author=7',
  search: '/api/search?q=x&page=1&limit=20',
  topics: '/api/topics?days=7',
  topic: '/api/topics/rss%3A1?days=7',
  relations: '/api/relations?days=7',
  traffic: '/api/traffic?blog=a',
  tag: '/api/tags/%E6%97%85%E8%A1%8C',
  blog: '/api/blogs/a',
  blogRelations: '/api/blogs/a/relations?days=90',
  blogTopics: '/api/blogs/a/topics?days=90',
  blogInference: '/api/blogs/a/inference',
  blogContent: '/api/blogs/a/content',
  tech: '/api/tech?technology=wp-plugin%3Aelementor&status=detected&cursor=12',
  blogTech: '/api/blogs/a/tech',
  blogPage: '/api/pages/blogs/example.com',
  topicPage: '/api/pages/topics/%E6%97%85%E8%A1%8C',
  homeOverview: '/api/overview?view=home',
  homeTopics: '/api/topics?days=30&view=home',
  blogQueue: '/api/blog-queue?q=thelingwu.com&state=failed&source=reader-suggestion&page=2',
};

export const json = (status: number, body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
