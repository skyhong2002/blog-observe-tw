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

/** Valid answers with no rows. One per public kind. */
export const EMPTY: Record<PublicKind, unknown> = {
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
};

/** A path answering each kind. */
export const PATHS: Record<PublicKind, string> = {
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
};

export const json = (status: number, body: unknown = { ok: true }) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
