/**
 * The fields public pages need from each public gateway payload, checked on
 * every 200 by the server (public-read.ts) and the browser (public-loader.ts).
 * A 200 whose shape is wrong is a failure, not an empty page or a 404: on the
 * server it throws, so the request fails instead of rendering empty data.
 *
 * Shapes follow the gateway routes (app/src/overview.js, catalog.js,
 * catalog-authors.js, search.ts, topics/routes.ts, relations/routes.ts,
 * v1/similarweb-routes.ts, ai/routes.ts, content/routes.ts, tech/routes.ts and app.js). Only
 * containers and the keys the pages index into are required, never that a
 * list is non-empty: an empty list, a null profile or "unavailable" vocabulary
 * are valid answers. Pure: node --test imports this file.
 */
import { pageInfoOf } from './page-links.ts';
import type { PublicKind } from './public-paths.ts';

type Value = Record<string, unknown>;
const object = (value: unknown): value is Value => typeof value === 'object' && value !== null && !Array.isArray(value);
const list = (value: unknown): value is unknown[] => Array.isArray(value);
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown) => typeof value === 'string';
const nullable = (check: (value: unknown) => boolean) => (value: unknown) => value === null || check(value);
const optional = (check: (value: unknown) => boolean) => (value: unknown) => value === undefined || check(value);
/** Every listed key passes its check. */
const shape = (value: unknown, checks: Record<string, (value: unknown) => boolean>): value is Value =>
  object(value) && Object.entries(checks).every(([key, check]) => check(value[key]));
const rows = (value: unknown, checks: Record<string, (value: unknown) => boolean> = {}) =>
  list(value) && value.every((row) => shape(row, checks));

const pagination = (value: unknown) => shape(value, { page: number, pages: number, pageSize: number, total: number });
const topicItems = (value: unknown) => rows(value, { id: text, label: text });
const relationCoverage = (value: unknown) => shape(value, { nonBodyLinks: object });
const boolean = (value: unknown) => typeof value === 'boolean';
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const oneOf =
  (...values: string[]) =>
  (value: unknown) =>
    values.includes(value as string);

/**
 * One link row of readBlogRelations (projectEvidence). The five keys every gateway sent (postTitle, postUrl,
 * targetUrl, anchor, publishedAt) are required; anchor may be null although the column is NOT NULL, read
 * leniently. The newer ones, postId included, may be absent (shown as 未提供) but, when sent, must be what
 * BlogRelations renders: an object or array there would pass `rows` and then fail in React, outside the
 * section's own error handling.
 */
const relationEvidence = {
  postTitle: text,
  postUrl: text,
  targetUrl: text,
  anchor: nullable(text),
  publishedAt: nullable(text),
  postId: optional(count),
  sourceBlogId: optional(count),
  targetBlogId: optional(nullable(count)),
  location: optional(nullable(text)),
  context: optional(nullable(text)),
  observedAt: optional(nullable(text)),
  matchVersion: optional(nullable(text)),
  evidenceType: optional(text),
  contextSource: optional(nullable(text)),
};
/**
 * app/src/relations/shared-tags.ts and readBlogRelations: off, unavailable, or ready with every key the rows show.
 * A ready answer is a list (possibly empty) whose truncation is stated; another status is not this contract.
 * The tag provenance keys are newer than the hit itself: absent is 未提供, sent is text.
 */
const sharedTagHit = {
  sourceArticleId: count,
  sourceArticleUrl: text,
  sourceArticleTitle: text,
  sourceArticlePublishedAt: text,
  targetArticleId: count,
  targetArticleUrl: text,
  targetArticleTitle: text,
  targetArticlePublishedAt: text,
  targetBlogId: count,
  targetBlogSlug: optional(text),
  targetBlogName: text,
  tagId: count,
  label: text,
  sourceType: optional(text),
  lastSeenAt: optional(text),
  targetSourceType: optional(text),
  targetLastSeenAt: optional(text),
  tagSourceType: optional(text),
  tagLastSeenAt: optional(text),
  matchVersion: text,
};
const sharedTags = (value: unknown) => {
  if (!shape(value, { status: oneOf('not-enabled', 'unavailable', 'ready') })) return false;
  if (value.status === 'not-enabled') return true;
  if (value.status === 'unavailable') return text(value.matchVersion);
  return shape(value, {
    days: count,
    items: (items) => rows(items, sharedTagHit),
    truncated: boolean,
    sourceTagsTruncated: boolean,
    matchVersion: text,
    interpretation: text,
  });
};

/** The full overview's keys (app/src/overview.js loadProjection). */
const overviewShape = {
  posts: rows,
  tags: rows,
  authors: rows,
  blogs: rows,
  recentBlogs: optional(rows),
  totals: (value: unknown) => shape(value, { blogs: number, posts: number }),
  updatedAt: optional(nullable(text)),
};
const atMost = (max: number) => (value: unknown) => list(value) && value.length <= max;
/**
 * A recent blog's latestPost (lib/home.ts RecentPost): absent (looked up in `posts`), null (no collected post), or
 * what recentBlogRows reads: a title it trims, a url or null, a publish time or null, and the post id when sent.
 */
const recentPost = (value: unknown) => shape(value, { id: optional(count), title: text, url: nullable(text), publishedAt: nullable(text) });
/**
 * /api/overview?view=home (loadHomeProjection): marked view 'home', the overview's shape at the homepage's bounds,
 * recentBlogs always sent and no directory rows. A full overview (no mark, 200 posts, its blogs) is not this answer.
 */
const homeOverview = (raw: unknown) =>
  shape(raw, overviewShape) &&
  shape(raw, {
    view: (v) => v === 'home',
    posts: atMost(7),
    tags: atMost(30),
    authors: atMost(8),
    blogs: atMost(0),
    // Only the keys the homepage's recent-blog rows need are promised (recentBlogRows, BlogIcon, blogLink).
    recentBlogs: (value) => rows(value, { slug: text, name: text, latestPost: optional(nullable(recentPost)) }) && atMost(10)(value),
  });
/**
 * /api/topics?view=home (topics/routes.ts): marked view 'home', the top `limit` (8) of the shared vocabulary with
 * at least two blogs, and none of the full ranking's vocabulary or coverage, so a full payload cannot pass for it.
 */
const homeTopics = (raw: unknown) => {
  if (
    !shape(raw, {
      view: (v) => v === 'home',
      generatedAt: text,
      cacheSeconds: (v) => v === 0,
      days: count,
      source: (v) => v === 'tag-vocabulary',
      items: (items) =>
        rows(items, {
          id: text,
          label: text,
          canonicalPath: optional(text),
          source: oneOf('rss-category', 'tag-vocabulary'),
          posts: count,
          blogs: count,
        }),
      truncated: boolean,
      minimumBlogs: (v) => v === 2,
      limit: (v) => v === 8,
      vocabulary: (v) => v === undefined,
      coverage: (v) => v === undefined,
    })
  )
    return false;
  return (raw.items as unknown[]).length <= (raw.limit as number);
};

const techStatus = oneOf('detected', 'unknown', 'failed', 'blocked', 'not-observed');
const techCategory = oneOf('cms', 'framework', 'theme', 'plugin', 'analytics', 'hosting', 'cdn');
const techErrorCode = oneOf('robots', 'waf', 'rate-limit', 'http-error', 'timeout', 'network', 'invalid-response');
/** app/src/tech/contracts.ts TechCoverage, as projectTechScan copies it: the views read sourceType and htmlTruncated. */
const techScanCoverage = (value: unknown) =>
  shape(value, {
    partial: (v) => v === true,
    method: (v) => v === 'passive-existing-response',
    sourceType: oneOf('html', 'body-fragment', 'header'),
    htmlTruncated: boolean,
    inspectedNodes: count,
  });
const techDetections = (value: unknown) =>
  rows(value, {
    id: text,
    name: text,
    category: techCategory,
    version: text,
    confidence: number,
    ruleId: text,
    ruleVersion: text,
    observedAt: text,
    evidence: (items) => rows(items, { kind: oneOf('generator', 'asset', 'marker', 'header'), value: text }),
  });
/**
 * One blog of app/src/tech/routes.ts: the views read every one of these keys.
 * projectTechScan's invariants hold too, so no impossible row is shown as a
 * state: a success snapshot (observedAt) always carries its coverage; without
 * one there are no detections; `detected` has detections and `unknown` none;
 * `not-observed` has no attempt at all.
 */
const techBlog = (value: unknown) => {
  if (
    !shape(value, {
      id: count,
      slug: text,
      name: text,
      url: nullable(text),
      sourceUrl: nullable(text),
      iconUrl: nullable(text),
      status: techStatus,
      observedAt: nullable(text),
      lastAttemptAt: nullable(text),
      errorCode: nullable(techErrorCode),
      evidenceSourceUrl: nullable(text),
      coverage: nullable(techScanCoverage),
      detections: techDetections,
    })
  )
    return false;
  const { status, observedAt, lastAttemptAt, coverage, detections } = value as {
    status: string;
    observedAt: string | null;
    lastAttemptAt: string | null;
    coverage: unknown;
    detections: unknown[];
  };
  if ((observedAt === null) !== (coverage === null)) return false;
  if (observedAt === null && detections.length) return false;
  if (status === 'not-observed') return lastAttemptAt === null && observedAt === null;
  if (lastAttemptAt === null) return false;
  if (status === 'detected') return observedAt !== null && detections.length > 0;
  if (status === 'unknown') return observedAt !== null && detections.length === 0;
  return true;
};
// The page says no extra request is made and the result is partial; a gateway saying otherwise is not this method.
const techMethod = (value: unknown) =>
  shape(value, { id: text, partial: (v) => v === true, additionalRequests: (v) => v === false, description: text });
/**
 * Status counts are of the scanned blogs (they sum to scannedBlogs), scanned is
 * at most the public total, and `truncated` says exactly whether some were left
 * out. A missing or inconsistent count is a failure, never shown as 0.
 */
const techCoverage = (value: unknown) => {
  if (
    !shape(value, {
      totalBlogs: count,
      scannedBlogs: count,
      truncated: boolean,
      detected: count,
      unknown: count,
      failed: count,
      blocked: count,
      notObserved: count,
    })
  )
    return false;
  const c = value as Record<'totalBlogs' | 'scannedBlogs' | 'detected' | 'unknown' | 'failed' | 'blocked' | 'notObserved', number> & {
    truncated: boolean;
  };
  return (
    c.scannedBlogs <= c.totalBlogs &&
    c.truncated === c.totalBlogs > c.scannedBlogs &&
    c.detected + c.unknown + c.failed + c.blocked + c.notObserved === c.scannedBlogs
  );
};

export const PUBLIC_CONTRACTS: Record<PublicKind, (raw: unknown) => boolean> = {
  overview: (raw) => shape(raw, overviewShape),
  homeOverview,
  homeTopics,
  catalog: (raw) =>
    shape(raw, {
      blogs: (value) => rows(value, { slug: text, name: text }),
      categories: rows,
      statuses: rows,
      totals: (value) => shape(value, { blogs: number, posts: number, withUrls: number, authors: number }),
      pagination,
      filters: object,
    }),
  authors: (raw) =>
    shape(raw, {
      authors: (value) => rows(value, { displayName: text }),
      totals: object,
      matchedAuthors: number,
      pagination,
      filters: (value) => shape(value, { author: nullable(number) }),
    }),
  search: (raw) => shape(raw, { items: list }),
  // The full ranking: vocabulary stays required (the homepage's view=home answer is homeTopics).
  topics: (raw) => shape(raw, { items: topicItems, vocabulary: object }),
  topic: (raw) =>
    shape(raw, {
      topic: (value) => shape(value, { id: text, label: text }),
      blogs: rows,
      articles: rows,
      vocabulary: object,
      // Absent while history reads are off; rows with another evidenceState are dropped by the view (historyRows).
      history: optional((value) =>
        shape(value, {
          articles: (items) => rows(items, { id: number, title: text, url: text, blogSlug: text, blogName: text, observedAt: text }),
          nextCursor: nullable(text),
        }),
      ),
    }),
  relations: (raw) =>
    shape(raw, { nodes: rows, edges: rows, mostMentioned: rows, mutual: rows, coverage: relationCoverage, generatedAt: text }),
  traffic: (raw) => shape(raw, { blogs: list }),
  tag: (raw) => shape(raw, { tag: (value) => shape(value, { slug: text, label: text }), posts: rows, blogs: rows }),
  blog: (raw) =>
    shape(raw, {
      blog: (value) => shape(value, { slug: text, name: text, authors: optional(rows), tags: optional(rows) }),
      posts: rows,
    }),
  // The evidence, shared-tag and text-similarity keys are newer than some gateways: absent is "not provided" in the view.
  blogRelations: (raw) =>
    shape(raw, {
      nodes: rows,
      outgoing: rows,
      incoming: rows,
      evidence: optional((items) => rows(items, relationEvidence)),
      evidenceTruncated: optional(boolean),
      nonBodyEvidence: optional((items) => rows(items, relationEvidence)),
      nonBodyEvidenceTruncated: optional(boolean),
      sharedTags: optional(sharedTags),
      textSimilarity: optional((value) => shape(value, { status: text })),
      coverage: object,
    }),
  blogTopics: (raw) => shape(raw, { items: topicItems, vocabulary: object }),
  blogInference: (raw) =>
    shape(raw, {
      label: text,
      overridden: (value) => typeof value === 'boolean',
      profile: nullable(object),
      provenance: nullable(object),
      topics: rows,
    }),
  blogContent: (raw) => shape(raw, { blog: object, sources: rows }),
  tech: (raw) => {
    if (
      !shape(raw, {
        generatedAt: text,
        method: techMethod,
        coverage: techCoverage,
        technologies: (value) =>
          rows(value, {
            id: text,
            name: text,
            category: techCategory,
            blogs: count,
            versions: (items) => rows(items, { version: text, blogs: count }),
          }),
        items: (value) => list(value) && value.every(techBlog),
        pagination: (value) => shape(value, { limit: count, nextCursor: nullable(text), total: count }),
        // app/src/tech/routes.ts echoes techFilters: always all three, '' when unset; the view renders them as text.
        filters: (value) => shape(value, { q: text, technology: text, status: (v) => v === '' || techStatus(v) }),
      })
    )
      return false;
    const { coverage, technologies, items, pagination } = raw as {
      coverage: { scannedBlogs: number };
      technologies: Array<{ blogs: number }>;
      items: unknown[];
      pagination: { limit: number; total: number };
    };
    // Aggregates and matches come from the scanned cohort only; a page never holds more than it asked for.
    return (
      technologies.every((t) => t.blogs <= coverage.scannedBlogs) &&
      pagination.total <= coverage.scannedBlogs &&
      items.length <= pagination.limit &&
      items.length <= pagination.total
    );
  },
  blogTech: (raw) => shape(raw, { generatedAt: text, method: techMethod, blog: techBlog }),
  // Every field: the page's canonical, robots and the stable id of its API reads come from here.
  blogPage: (raw) => pageInfoOf('blog', raw) !== null,
  topicPage: (raw) => pageInfoOf('topic', raw) !== null,
};

/** True when a 200 payload has what the page for this kind of path reads. */
export const validPublicPayload = (kind: PublicKind, raw: unknown) => PUBLIC_CONTRACTS[kind](raw);
