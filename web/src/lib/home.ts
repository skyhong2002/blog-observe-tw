import type { Blog, Overview, Post } from './api';

/** The newest post shown under a blog on the homepage; `id` is absent when it came from `posts`. */
export type RecentPost = { id?: number; title: string; url: string | null; publishedAt: string | null };

/**
 * One row of 最新更新的部落格. `latest` is null when no title is known, and
 * `missing` says why: `none` when the gateway reports the blog has no collected
 * post, `unknown` when an older gateway sent no `latestPost` and the overview's
 * post sample has nothing from this blog. Titles are never invented.
 */
export type RecentBlogRow = {
  blog: Blog;
  latest: RecentPost | null;
  missing: 'none' | 'unknown' | null;
  /** Newest known publish time, for display and fallback ordering. */
  publishedAt: string | null;
};

function time(value: string | null | undefined): number | null {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** Newest post per blog slug from the overview's post sample. Dated posts win over undated ones. */
export function latestPostsBySlug(posts: Post[]): Map<string, RecentPost> {
  const out = new Map<string, RecentPost>();
  for (const post of posts) {
    if (!post.blogSlug) continue;
    const current = out.get(post.blogSlug);
    const candidate = time(post.publishedAt);
    if (current) {
      const known = time(current.publishedAt);
      if (candidate === null || (known !== null && known >= candidate)) continue;
    }
    out.set(post.blogSlug, { id: post.id, title: post.title, url: post.url ?? null, publishedAt: post.publishedAt ?? null });
  }
  return out;
}

/**
 * Blog slug → the payload `iconUrl` the overview already carries (`recentBlogs`
 * first, then `blogs`), so homepage icons can server-render the logo instead
 * of waiting for the icon manifest. Keyed by slug only, like BlogIcon's
 * `media`; a slug with no iconUrl is absent and keeps the initial.
 */
export function blogIconUrls(data: Pick<Overview, 'blogs' | 'recentBlogs'>): Map<string, string> {
  const out = new Map<string, string>();
  for (const blog of [...(data.recentBlogs ?? []), ...(data.blogs ?? [])]) {
    const url = typeof blog.iconUrl === 'string' ? blog.iconUrl.trim() : '';
    if (blog.slug && url && !out.has(blog.slug)) out.set(blog.slug, url);
  }
  return out;
}

/**
 * Prefers `recentBlogs` (already ordered by newest post). Older gateways only
 * send `blogs`: those are ordered by their newest known publish time, and the
 * latest title is looked up in `posts` by blog slug.
 */
export function recentBlogRows(data: Pick<Overview, 'blogs' | 'posts' | 'recentBlogs'>, limit = 10): RecentBlogRow[] {
  const sample = latestPostsBySlug(data.posts ?? []);
  const toRow = (blog: Blog): RecentBlogRow => {
    const latest: RecentPost | null = blog.latestPost !== undefined ? blog.latestPost : (sample.get(blog.slug) ?? null);
    const missing = latest ? null : blog.latestPost === null ? 'none' : 'unknown';
    const publishedAt = [latest?.publishedAt, blog.lastPublishedAt].find((value) => time(value) !== null) ?? null;
    return { blog, latest, missing, publishedAt };
  };
  const seen = new Set<string>();
  const unique = (blogs: Blog[]) => blogs.filter((blog) => blog.slug && !seen.has(blog.slug) && seen.add(blog.slug));
  if (data.recentBlogs) return unique(data.recentBlogs).slice(0, limit).map(toRow);
  return unique(data.blogs ?? [])
    .map(toRow)
    .filter((row) => time(row.publishedAt) !== null)
    .sort((a, b) => (time(b.publishedAt) ?? 0) - (time(a.publishedAt) ?? 0))
    .slice(0, limit);
}
