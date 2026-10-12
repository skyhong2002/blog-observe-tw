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
import type { Period } from './public-query.ts';

export type PageKind = 'blog' | 'topic';

const PREFIX: Record<PageKind, string> = { blog: '/blogs/', topic: '/topics/' };
/** The period a topic detail page renders without ?days= (its indexability window). */
export const TOPIC_DETAIL_PERIOD: Period = '90';

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

/** GET /api/pages/... `page` (app/src/seo/page-api.ts). */
export type PublicPageInfo = {
  entityId: string;
  /** Blog: the original API slug. Topic: tag:<hash>. Used for every existing API read. */
  stableId: string;
  slug: string;
  canonicalPath: string;
  indexable: boolean;
  indexabilityReason: string | null;
  windowDays: 90;
  posts: number;
  blogs: number;
  currentVersion: string | null;
};

const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const STABLE: Record<PageKind, RegExp> = { blog: /^[a-z0-9][a-z0-9_-]{0,179}$/, topic: /^tag:[a-f0-9]{64}$/ };
const ENTITY: Record<PageKind, RegExp> = { blog: /^[1-9]\d{0,14}$/, topic: /^[a-f0-9]{64}$/ };

/** The validated `page` of a page API answer, or null for any other shape. */
export function pageInfoOf(kind: PageKind, raw: unknown): PublicPageInfo | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const page = (raw as { page?: unknown }).page as Record<string, unknown> | undefined;
  if (!page || typeof page !== 'object' || Array.isArray(page)) return null;
  const { entityId, stableId, slug, canonicalPath, indexable, indexabilityReason, windowDays, posts, blogs, currentVersion } = page;
  if (typeof entityId !== 'string' || !ENTITY[kind].test(entityId)) return null;
  if (typeof stableId !== 'string' || !STABLE[kind].test(stableId)) return null;
  if (kind === 'topic' && stableId !== `tag:${entityId}`) return null;
  if (typeof slug !== 'string' || pageKeyOf(kind, canonicalPath) !== slug) return null;
  if (typeof indexable !== 'boolean' || windowDays !== 90 || !count(posts) || !count(blogs)) return null;
  if (!(indexabilityReason === null || (typeof indexabilityReason === 'string' && indexabilityReason.length <= 64))) return null;
  if (indexable && indexabilityReason !== null) return null;
  if (!(currentVersion === null || typeof currentVersion === 'string')) return null;
  return {
    entityId,
    stableId,
    slug,
    canonicalPath: canonicalPath as string,
    indexable,
    indexabilityReason: indexabilityReason as string | null,
    windowDays: 90,
    posts: posts as number,
    blogs: blogs as number,
    currentVersion: currentVersion as string | null,
  };
}

const REASONS: Record<string, string> = {
  'insufficient-posts': '近 90 天比對到的文章少於 3 篇',
  'insufficient-blogs': '近 90 天只有 1 個部落格寫到',
  'excluded-term': '此詞不參與話題比對',
  'inactive-term': '此詞暫未參與比對',
  'not-current-term': '不在目前詞庫版本',
  'unverified-or-invalid-url': '尚未核准或沒有有效網址',
};

/**
 * One line on why a valid page is not offered to search engines, with the
 * 90-day counts the threshold is checked against (independent of the period
 * tab the page shows). null when indexable.
 */
export function indexabilityNote(page: Pick<PublicPageInfo, 'indexable' | 'indexabilityReason' | 'posts' | 'blogs'>, kind: PageKind) {
  if (page.indexable) return null;
  const reason = REASONS[page.indexabilityReason ?? ''] ?? '尚未達收錄門檻';
  return kind === 'topic'
    ? `暫不提供搜尋引擎索引：${reason}（近 90 天 ${page.posts} 篇、${page.blogs} 個部落格；門檻為至少 3 篇、2 個部落格）。`
    : `暫不提供搜尋引擎索引：${reason}。`;
}
