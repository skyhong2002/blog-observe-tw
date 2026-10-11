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
};

export type Post = {
  guid?: string;
  title: string;
  url?: string | null;
  summary?: string | null;
  publishedAt?: string | null;
};

export type Follow = Pick<Blog, 'slug' | 'name' | 'url' | 'category'>;

type GatewayEnvelope<T> = T | { blogs?: T; follows?: T; blog?: T };

function origin() {
  // This module only runs in Next server components. Never expose this value
  // via NEXT_PUBLIC_*; the public browser uses the rewrites above instead.
  return process.env.BLOG_GATEWAY_INTERNAL_URL ?? 'http://127.0.0.1:18160';
}

export async function gateway<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`${origin()}${path}`, { ...init, cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function listBlogs(): Promise<Blog[]> {
  const payload = await gateway<GatewayEnvelope<Blog[]>>('/api/blogs');
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.blogs)) return payload.blogs;
  return [];
}

export async function getBlog(slug: string): Promise<Blog | null> {
  const direct = await gateway<GatewayEnvelope<Blog>>(`/api/blogs/${encodeURIComponent(slug)}`);
  if (direct && !Array.isArray(direct)) {
    if ('blog' in direct && direct.blog) return direct.blog as Blog;
    if ('slug' in direct) return direct as Blog;
  }
  const blogs = await listBlogs();
  return blogs.find((blog) => blog.slug === slug) ?? null;
}

export async function listFollows(): Promise<Follow[] | null> {
  const payload = await gateway<GatewayEnvelope<Follow[]>>('/api/me/follows');
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.follows)) return payload.follows;
  return null;
}
