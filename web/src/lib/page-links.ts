/**
 * Readable HTML page URLs for blogs and topics. The gateway's page registry
 * (app/src/seo/page-routes.ts) owns every readable key and returns it as
 * `canonicalPath` (`/blogs/<key>/` or `/topics/<key>/`, the key encoded
 * exactly once). Payloads carry it as an optional field next to the stable API
 * identifiers: canonicalPath on blog and topic items, blogCanonicalPath beside
 * blogSlug/blogId, source/targetBlogCanonicalPath on relation edges.
 *
 * These helpers only decide which HTML href to render: a valid canonicalPath,
 * otherwise the legacy URL built from the stable slug or topic id (which the
 * gateway 301s once it knows the readable one). API endpoints, favicon keys
 * and follow/reader calls keep the stable slug or id. Pure: node --test
 * imports this file.
 */
import { safeContentId } from './analytics-consent.mts';
import { type Period, TOPICS_PERIOD } from './public-query.ts';

export type PageKind = 'blog' | 'topic';

const PREFIX: Record<PageKind, string> = { blog: '/blogs/', topic: '/topics/' };
/** The period a topic detail page renders without ?days= (30 days, as before readable URLs). */
export const TOPIC_DETAIL_PERIOD: Period = TOPICS_PERIOD;

/**
 * An already-decoded page key the registry could have minted (mirrors
 * isPublicRouteKey in app/src/seo/page-routes.ts): a stable API slug or topic
 * id, or a readable key of letters, marks, digits and inner `.`, `_`, `-`.
 * Never decodes; `%`, `/`, `?`, `#`, `\`, `:` (outside topic ids), spaces and
 * control characters are all rejected.
 */
export function isPageKey(kind: PageKind, key: unknown): key is string {
  if ((kind !== 'blog' && kind !== 'topic') || typeof key !== 'string' || !key || [...key].length > 180) return false;
  if (kind === 'topic' && /^(tag:[a-f0-9]{64}|rss:[1-9]\d{0,9})$/.test(key)) return true;
  if (kind === 'blog' && /^[a-z0-9][a-z0-9_-]{0,179}$/.test(key)) return true;
  return /^[\p{L}\p{N}][\p{L}\p{M}\p{N}._-]*$/u.test(key) && !key.includes('..') && !/[._-]$/.test(key);
}

/**
 * The key of a relative `/blogs/<key>/` or `/topics/<key>/` path whose single
 * segment is the key percent-encoded exactly once, else null. Rejects any
 * other prefix, origin or `//` authority, extra segment, query, fragment,
 * missing trailing slash, invalid or non-canonical escapes and double
 * encoding (a decoded `%` is not a valid key).
 */
export function pageKeyOf(kind: PageKind, path: unknown): string | null {
  if (typeof path !== 'string' || path.length > 2048) return null;
  const prefix = PREFIX[kind];
  if (!prefix || !path.startsWith(prefix) || !path.endsWith('/')) return null;
  const segment = path.slice(prefix.length, -1);
  let key: string;
  try {
    key = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return isPageKey(kind, key) && encodeURIComponent(key) === segment ? key : null;
}

/**
 * The page key of a /blogs/[slug] or /topics/[id] param, else null. Next 16
 * hands page code the segment re-encoded with encodeURIComponent
 * (getParamValue in next/dist/shared/lib/router/utils/get-dynamic-param.js),
 * so `資訊安全` arrives as `%E8%B3%87…` and `tag:<hash>` as `tag%3A<hash>`.
 * This is the one place that decodes it, exactly once: the param must be the
 * key's encodeURIComponent form (or the key itself, should Next ever pass it
 * decoded) and the decoded key must pass isPageKey. A double-encoded `%252F`
 * decodes to `%2F` and an encoded `/`, `\`, `?`, `#` or `@` to themselves, all
 * of which isPageKey rejects.
 */
export function pageKeyOfParam(kind: PageKind, raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let key: string;
  try {
    key = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return isPageKey(kind, key) && (raw === key || encodeURIComponent(key) === raw) ? key : null;
}

export const isCanonicalPagePath = (kind: PageKind, path: unknown): path is string => pageKeyOf(kind, path) !== null;

/** /blogs/<slug>/ or /topics/<id>/ from a stable identifier, encoded once (the pre-registry URL). */
export const legacyPagePath = (kind: PageKind, id: string) => `${PREFIX[kind]}${encodeURIComponent(id)}/`;

/** The payload's canonicalPath when valid for this kind, otherwise the legacy URL of the stable id. */
export const pagePath = (kind: PageKind, id: string, canonicalPath?: unknown) =>
  isCanonicalPagePath(kind, canonicalPath) ? canonicalPath : legacyPagePath(kind, id);

export const blogHref = (slug: string, canonicalPath?: unknown) => pagePath('blog', slug, canonicalPath);

/** A topic page, with ?days= unless it is the detail page's own period. */
export function topicHref(id: string, canonicalPath?: unknown, days?: Period) {
  const path = pagePath('topic', id, canonicalPath);
  return days && days !== TOPIC_DETAIL_PERIOD ? `${path}?days=${days}` : path;
}

type LinkProps = { href: string; 'data-analytics-content-id'?: string };

/**
 * href plus, when the stable id is analytics-safe (an ASCII blog slug, a topic
 * hash or RSS number), the select_content id the click handler sends instead
 * of reading the readable path. Spread onto <Link>/<a>.
 */
export function blogLink(slug: string, canonicalPath?: unknown): LinkProps {
  const id = safeContentId('blog', slug);
  return id ? { href: blogHref(slug, canonicalPath), 'data-analytics-content-id': id } : { href: blogHref(slug, canonicalPath) };
}

export function topicLink(id: string, canonicalPath?: unknown, days?: Period): LinkProps {
  const content = /^(tag|rss):/.test(id) ? safeContentId('topic', id.slice(4)) : undefined;
  const href = topicHref(id, canonicalPath, days);
  return content ? { href, 'data-analytics-content-id': content } : { href };
}

/** /api/pages/blogs/:key and /api/pages/topics/:key for an already-decoded key, encoded once. */
export const pageApiPath = (kind: PageKind, key: string) => `/api/pages/${kind === 'blog' ? 'blogs' : 'topics'}/${encodeURIComponent(key)}`;

/**
 * GET /api/pages/... `page` (app/src/seo/page-api.ts). A registered page gets
 * the same indexable metadata as any public page; unknown or noise keys are the
 * gateway's 404. The counts are descriptive only and never drive robots; any
 * indexable/indexabilityReason fields in the answer are ignored. Blog counts
 * cover 90 days; topic counts cover 90 days, or with windowDays null the whole
 * durable history (history reads on).
 */
export type PublicPageInfo = {
  entityId: string;
  /** Blog: the original API slug. Topic: tag:<hash>. Used for every existing API read. */
  stableId: string;
  slug: string;
  canonicalPath: string;
  /** null: cumulative, no window (topics only). */
  windowDays: 90 | null;
  posts: number;
  blogs: number;
  currentVersion: string | null;
};

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const STABLE: Record<PageKind, RegExp> = { blog: /^[a-z0-9][a-z0-9_-]{0,179}$/, topic: /^tag:[a-f0-9]{64}$/ };
const ENTITY: Record<PageKind, RegExp> = { blog: /^[1-9]\d{0,14}$/, topic: /^[a-f0-9]{64}$/ };
const windowOf = (kind: PageKind, value: unknown): value is 90 | null => value === 90 || (kind === 'topic' && value === null);

/** The validated `page` of a page API answer, or null for any other shape. */
export function pageInfoOf(kind: PageKind, raw: unknown): PublicPageInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const page = (raw as { page?: unknown }).page as Record<string, unknown> | undefined;
  if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
  const { entityId, stableId, slug, canonicalPath, windowDays, posts, blogs, currentVersion } = page;
  if (typeof entityId !== 'string' || !ENTITY[kind].test(entityId)) return null;
  if (typeof stableId !== 'string' || !STABLE[kind].test(stableId)) return null;
  if (kind === 'topic' && stableId !== `tag:${entityId}`) return null;
  if (typeof slug !== 'string' || pageKeyOf(kind, canonicalPath) !== slug) return null;
  if (!windowOf(kind, windowDays) || !count(posts) || !count(blogs)) return null;
  if (!(currentVersion === null || typeof currentVersion === 'string')) return null;
  return {
    entityId,
    stableId,
    slug,
    canonicalPath: canonicalPath as string,
    windowDays,
    posts: posts as number,
    blogs: blogs as number,
    currentVersion: currentVersion as string | null,
  };
}
