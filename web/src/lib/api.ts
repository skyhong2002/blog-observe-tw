export type Blog = {
  id?: number;
  slug: string;
  name: string;
  url?: string | null;
  category?: string | null;
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
