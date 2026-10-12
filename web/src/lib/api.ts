export type Blog = {
  id?: number;
  slug: string;
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
};
export type Author = {
  id: number;
  displayName: string;
  bio?: string | null;
  homepageUrl?: string | null;
  role?: string;
  isPrimary?: boolean;
  blogSlug?: string;
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
  blogName?: string;
  imageUrl?: string | null;
  tags?: Tag[];
};
export type Follow = Pick<Blog, 'slug' | 'name' | 'url' | 'category'>;
export type Overview = {
  posts: Post[];
  tags: Array<Tag & { postCount: number; blogCount: number }>;
  authors: Author[];
  blogs: Blog[];
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
export async function catalog(query: CatalogQuery): Promise<Catalog> {
  const params = new URLSearchParams();
  for (const key of ['q', 'category', 'status', 'sort', 'dir', 'page', 'limit'] as const) {
    if (typeof query[key] === 'string') params.set(key, query[key]);
  }
  const data = await gateway<Catalog>(`/api/catalog?${params}`);
  if (!data) throw new Error('Blog catalog unavailable');
  return data;
}
function origin() {
  return process.env.BLOG_GATEWAY_INTERNAL_URL ?? 'http://127.0.0.1:18160';
}
export async function gateway<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`${origin()}${path}`, { ...init, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}
export async function listBlogs(): Promise<Blog[]> {
  const payload = await gateway<{ blogs: Blog[] }>('/api/blogs');
  return payload?.blogs ?? [];
}
export async function getBlog(slug: string): Promise<Blog | null> {
  const data = await gateway<{ blog: Blog; posts: Post[] }>(`/api/blogs/${encodeURIComponent(slug)}`);
  return data?.blog ? { ...data.blog, posts: data.posts ?? [] } : null;
}
export async function overview(): Promise<Overview> {
  const data = await gateway<Overview>('/api/overview');
  if (!data) throw new Error('Blog overview unavailable');
  return data;
}
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
export async function authorCatalog(query: AuthorCatalogQuery): Promise<AuthorCatalog> {
  const params = new URLSearchParams();
  for (const key of ['author', 'page', 'limit'] as const) {
    if (typeof query[key] === 'string') params.set(key, query[key]);
  }
  const data = await gateway<AuthorCatalog>(`/api/catalog/authors?${params}`);
  if (!data) throw new Error('Author catalog unavailable');
  return data;
}
