// Optional readable page URLs from the gateway's page registry, next to the
// stable slug/id they never replace (links: page-links.ts; absent = legacy URL).
export type Blog = {
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
  postCount?: number;
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
  tags?: Tag[];
};
export type Follow = Pick<Blog, 'slug' | 'name' | 'url' | 'category' | 'iconUrl' | 'canonicalPath'>;
export type Overview = {
  posts: Post[];
  tags: Array<Tag & { postCount: number; blogCount: number }>;
  authors: Author[];
  blogs: Blog[];
  /** Up to 20 blogs ordered by their newest post, each with `latestPost`. Absent on older gateways. */
  recentBlogs?: Blog[];
  totals: { blogs: number; posts: number };
  updatedAt: string | null;
};
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
export function taipei(value?: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
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

export type AuthorCatalogQuery = { author?: string; page?: string; limit?: string };
export type AuthorCatalog = {
  authors: Author[];
  totals: { authors: number; relationships: number };
  matchedAuthors: number;
  pagination: { page: number; pages: number; pageSize: number; total: number };
  filters: { author: number | null; page: number; limit: number };
};
