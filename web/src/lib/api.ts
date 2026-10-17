import type { BlogGenre } from '../../../app/src/blog-genre-vocabulary.ts';
import type { GenreState } from '../../../app/src/blog-genres/resolve.ts';
import type { RobotsStatus } from './robots';

// Optional readable page URLs from the gateway's page registry, next to the
// stable slug/id they never replace (links: page-links.ts; absent = legacy URL).
export type Blog = {
  genreState?: GenreState;
  id?: number;
  slug: string;
  canonicalPath?: string;
  name: string;
  url?: string | null;
  category?: string | null;
  iconUrl?: string | null;
  statusLabel?: string | null;
  description?: string | null;
  latestPosts?: Post[];
  posts?: Post[];
  authors?: Author[];
  tags?: Tag[];
  lastCrawlSuccessAt?: string | null;
  lastPublishedAt?: string | null;
  expectedIntervalHours?: number;
  /** Median gap between its latest posts, in hours; null with fewer than 3 posts. */
  postingIntervalHours?: number | null;
  /** How often the RSS is checked, in hours. */
  crawlIntervalHours?: number;
  postCount?: number;
  /** /api/catalog: distinct active authors recorded for the blog. */
  authorCount?: number;
  /** /api/catalog: the latest robots.txt read for the blog's host; `null` before the first read. */
  robots?: RobotsStatus | null;
  /** /api/overview: the blog's newest collected post; `null` means none. Absent on older gateways. */
  latestPost?: LatestPost | null;
};
export type LatestPost = { id: number; title: string; url: string | null; publishedAt: string | null };
export type Author = {
  id: number;
  displayName: string;
  bio?: string | null;
  homepageUrl?: string | null;
  role?: string;
  isPrimary?: boolean;
  blogSlug?: string;
  blogCanonicalPath?: string;
  blogName?: string;
  postCount?: number;
};
export type Tag = {
  slug: string;
  label: string;
  kind?: string;
  visibility?: string;
  role?: string;
  postCount?: number;
  blogCount?: number;
};
export type Post = {
  id?: number;
  guid?: string;
  title: string;
  url?: string | null;
  summary?: string | null;
  author?: string | null;
  publishedAt?: string | null;
  blogSlug?: string;
  blogCanonicalPath?: string;
  blogName?: string;
  imageUrl?: string | null;
  /** Resolved database genres; absent on older gateways, empty when unclassified. */
  blogGenres?: BlogGenre[];
  /** The author's feed categories, at most a few (app/src/post-tags.ts); absent when none or not sent. */
  tags?: Tag[];
  /** The post's full tag count, for "+N" beside the shown `tags`. */
  tagCount?: number;
};
export type Follow = Pick<Blog, 'slug' | 'name' | 'url' | 'category' | 'iconUrl' | 'canonicalPath'>;
export type Overview = {
  genreStatus?: 'ready' | 'unavailable';
  posts: Post[];
  tags: Array<Tag & { postCount: number; blogCount: number }>;
  authors: Author[];
  blogs: Blog[];
  /** Up to 20 blogs ordered by their newest post, each with `latestPost`. Absent on older gateways. */
  recentBlogs?: Blog[];
  totals: { blogs: number; posts: number };
  updatedAt: string | null;
};
/**
 * One row of the homepage's body citations (app/src/relations/home-feed.ts loadHomeMentions): an article that
 * links, in its body, to another collected blog. Only direct body links; never shared tags or text similarity.
 * The target is a blog (and its domain), not a guessed target article. anchor/context are plain text.
 */
export type HomeMention = {
  postId: number;
  postTitle: string;
  postUrl: string | null;
  /** Source article image, when the feed/page offered one; absent on older gateways. */
  postImageUrl?: string | null;
  publishedAt: string | null;
  sourceBlogId: number;
  sourceBlogSlug: string;
  sourceBlogName: string;
  /** Readable page paths from the gateway's enrichment; absent on older answers (blogLink falls back to the slug). */
  sourceBlogCanonicalPath?: string;
  sourceIconUrl: string | null;
  targetBlogId: number;
  targetBlogSlug: string;
  targetBlogName: string;
  targetBlogCanonicalPath?: string;
  targetHomeUrl: string | null;
  targetDomain: string | null;
  targetIconUrl: string | null;
  evidenceType: 'direct-link';
  location: 'body';
  anchor: string;
  context: string;
  /** The sentence holding the link, with 「…」 where text before or after it was left out. */
  quote?: string;
  /** The source article's own feed categories (at most 3) and their full count; absent when none or not sent. */
  postTags?: Tag[];
  postTagCount?: number;
  observedAt: string | null;
  matchVersion: string;
  /** Public enum: the context was taken from the article body. Never an internal extraction id. */
  contextSource: 'body';
};
export type HomeMentions = {
  days: 90;
  evidenceType: 'direct-link';
  location: 'body';
  limit: 8;
  truncated: boolean;
  generatedAt: string;
  items: HomeMention[];
  /** The bounded query can degrade independently; this is distinct from an empty result. */
  status?: 'available' | 'unavailable';
};
/** /api/overview?view=home: the overview's shape (posts and tags now empty) plus the body citations. */
export type HomeOverview = Overview & { view: 'home'; mentions: HomeMentions };
export type CatalogQuery = { q?: string; category?: string; status?: string; sort?: string; dir?: string; page?: string; limit?: string };
export type Catalog = {
  blogs: Blog[];
  totals: { blogs: number; posts: number; withUrls: number; authors: number };
  categories: Array<{ value: string; count: number }>;
  statuses: Array<{ value: string; count: number }>;
  updatedAt: string | null;
  pagination: { page: number; pages: number; pageSize: number; total: number };
  filters: {
    q: string;
    category: string;
    status: string;
    sort: 'name' | 'category' | 'posts' | 'latest' | 'crawl' | 'status';
    dir: 'asc' | 'desc';
    page: number;
    limit: number;
  };
};
// Types and formatting only, so client components may import this file. Gateway
// reads live in server-only modules: public-api.ts (public, no-store) and server-gateway.ts (private).
/**
 * Node's ICU puts a thin space (U+2009) between a date and its time where Chrome's puts a plain one; the mismatch
 * failed hydration (React #418) on every page showing a time. Every date-time string gets plain spaces.
 */
export const plainSpaces = (text: string) => text.replace(/[\u00a0\u2000-\u200b\u202f]/gu, ' ');
export function taipei(value?: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? plainSpaces(
        new Date(value).toLocaleString('zh-TW', {
          timeZone: 'Asia/Taipei',
          year: 'numeric',
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }),
      )
    : '尚無紀錄';
}
export function plainText(value?: string | null) {
  return (value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|#39);/g,
      (entity) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity] ?? entity,
    )
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
/**
 * A publisher's article title as text: decodes HTML character references once (`&#038;`, `&#x26;`, and the
 * named amp/quot/apos/lt/gt/nbsp) so "&#038;" reads as "&". Only for display; the stored title is unchanged.
 * Unknown or invalid references stay as written, nothing is parsed as markup and the result is still React text
 * (escaped on output), so a literal "<script>" in a title stays visible text. One pass: "&amp;#038;" -> "&#038;".
 */
export function displayTitle(value?: string | null): string {
  if (typeof value !== 'string') return '';
  return value.replace(/&(#[0-9]{1,8}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z]{2,8});/g, (entity, body: string) => {
    // Own keys only: "&toString;" or "&constructor;" must not read Object.prototype.
    if (body[0] !== '#') return Object.hasOwn(TITLE_ENTITIES, body) ? TITLE_ENTITIES[body] : entity;
    const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    // No NUL, surrogates, C0/C1 controls (except tab/newline/return) or values beyond Unicode: keep the text as is.
    if (
      !Number.isSafeInteger(code) ||
      code > 0x10ffff ||
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0 ||
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      (code >= 0x7f && code <= 0x9f)
    )
      return entity;
    return String.fromCodePoint(code);
  });
}

export type AuthorCatalogQuery = { author?: string; page?: string; limit?: string };
export type AuthorCatalog = {
  authors: Author[];
  totals: { authors: number; relationships: number };
  matchedAuthors: number;
  pagination: { page: number; pages: number; pageSize: number; total: number };
  filters: { author: number | null; page: number; limit: number };
};
