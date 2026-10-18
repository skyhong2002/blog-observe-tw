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
import { isBlogGenre } from '../../../app/src/blog-genre-vocabulary.ts';
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
const relationCoverage = (value: unknown) => shape(value, { nonBodyLinks: object });
const boolean = (value: unknown) => typeof value === 'boolean';
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const oneOf =
  (...values: string[]) =>
  (value: unknown) =>
    values.includes(value as string);
/** A ranked topic row: the counts lists and word clouds show, and its provenance (the two accepted source kinds). */
const topicSource = oneOf('rss-category', 'tag-vocabulary');
const topicItems = (value: unknown) => rows(value, { id: text, label: text, source: topicSource, posts: count, blogs: count });
const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
/**
 * matchingPolicy.displayGate (topics/routes.ts): optional; when sent, every field the method notes state must be
 * present and in range, so a malformed gate is a failed read rather than a made-up rule description.
 */
const displayGate = (value: unknown) =>
  shape(value, {
    version: nonEmpty,
    upstream: nonEmpty,
    reason: nonEmpty,
    effect: nonEmpty,
    minimumSources: positive,
    minimumTwiceSources: positive,
    minimumPeakPosts: positive,
    documentFrequencyRatio: (v) => number(v) && (v as number) > 0 && (v as number) <= 1,
    // Optional on older gateways; when sent, every field the method notes state is present and in range.
    background: optional((v) =>
      shape(v, {
        maximumTitleShare: (r) => number(r) && (r as number) >= 0 && (r as number) <= 1,
        minimumBaselinePosts: positive,
        minimumNativeBlogs: positive,
        reason: nonEmpty,
      }),
    ),
  });
const matchingPolicy = optional((value) => object(value) && optional(displayGate)(value.displayGate));

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

const genreStatus = (value: unknown) => value === 'ready' || value === 'unavailable';
const genreState = (value: unknown) =>
  shape(value, {
    status: genreStatus,
    items: (items) =>
      rows(items, {
        genre: (v) => text(v) && isBlogGenre(v as string),
        source: (v) => v === 'ai' || v === 'admin' || v === 'community',
        visible: boolean,
        agrees: count,
        disagrees: count,
        adminOverride: (v) => v === null || v === 'set' || v === 'hide',
      }),
  });

/** The full overview's keys (app/src/overview.js loadProjection). */
const overviewShape = {
  genreStatus: optional(genreStatus),
  posts: (value: unknown) => rows(value, { blogGenres: optional((v) => list(v) && v.every((g) => text(g) && isBlogGenre(g as string))) }),
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
 * One homepage body citation (app/src/relations/home-feed.ts loadHomeMentions): every key the row renders, with
 * the single evidence kind it may be. A row of another kind (shared tag, similarity, sidebar) is not this answer.
 */
const homeMention = {
  postId: count,
  postTitle: text,
  postUrl: nullable(text),
  // Source article image; absent on older answers.
  postImageUrl: optional(nullable(text)),
  publishedAt: nullable(text),
  sourceBlogId: count,
  sourceBlogSlug: text,
  sourceBlogName: text,
  // Readable page paths added by the gateway's generic enrichment; absent on older answers (slug paths are used).
  sourceBlogCanonicalPath: optional(text),
  sourceIconUrl: nullable(text),
  targetBlogId: count,
  targetBlogSlug: text,
  targetBlogName: text,
  targetBlogCanonicalPath: optional(text),
  targetHomeUrl: nullable(text),
  targetDomain: nullable(text),
  targetIconUrl: nullable(text),
  evidenceType: (v: unknown) => v === 'direct-link',
  location: (v: unknown) => v === 'body',
  anchor: text,
  context: (v: unknown) => typeof v === 'string' && v.length <= 240,
  // The sentence around the link with 「…」 for omitted text; absent on older answers (context is shown).
  quote: optional((v: unknown) => typeof v === 'string' && v.length <= 330),
  observedAt: nullable(text),
  matchVersion: text,
  // A public enum, never an internal extraction id or digest.
  contextSource: (v: unknown) => v === 'body',
};
/** Required on the home overview: missing or malformed is a failed read, never an empty list. */
const homeMentions = (value: unknown) =>
  shape(value, {
    days: (v) => v === 90,
    evidenceType: (v) => v === 'direct-link',
    location: (v) => v === 'body',
    limit: (v) => v === 8,
    truncated: boolean,
    generatedAt: text,
    items: (items) => rows(items, homeMention) && atMost(8)(items),
    status: optional(oneOf('available', 'unavailable')),
  });
/**
 * /api/overview?view=home (loadHomeProjection): marked view 'home', the overview's shape at the homepage's bounds,
 * recentBlogs always sent and no directory rows. A full overview (no mark, 200 posts, its blogs) is not this answer.
 */
const homeOverview = (raw: unknown) =>
  shape(raw, overviewShape) &&
  shape(raw, {
    view: (v) => v === 'home',
    mentions: homeMentions,
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
const homeTopicRow = {
  id: text,
  label: text,
  canonicalPath: optional(text),
  source: topicSource,
  posts: count,
  blogs: count,
  titlePosts: optional(count),
  heat: optional((v) => typeof v === 'number' && Number.isFinite(v) && v > 0),
};
/** Candidates for the masthead cloud, a longer slice of the same ranked pool (at most 60, of which the cloud
 * draws 30 after skipping body-mention words); absent on older gateways. */
const HOME_CLOUD_LIMIT = 60;
const homeTopics = (raw: unknown) => {
  if (
    !shape(raw, {
      view: (v) => v === 'home',
      generatedAt: text,
      cacheSeconds: (v) => v === 0,
      days: count,
      source: (v) => v === 'tag-vocabulary',
      items: (items) => rows(items, homeTopicRow),
      cloudItems: optional((items) => rows(items, homeTopicRow) && atMost(HOME_CLOUD_LIMIT)(items)),
      cloudTruncated: optional(boolean),
      matchingPolicy,
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
  collectionCount: (raw) => shape(raw, { blogs: count }),
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
  topics: (raw) => shape(raw, { items: topicItems, vocabulary: object, matchingPolicy }),
  topic: (raw) =>
    shape(raw, {
      topic: (value) => shape(value, { id: text, label: text }),
      matchingPolicy,
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
      blog: (value) =>
        shape(value, { slug: text, name: text, authors: optional(rows), tags: optional(rows), genreState: optional(genreState) }),
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
  blogTopics: (raw) => shape(raw, { items: topicItems, vocabulary: object, matchingPolicy }),
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
