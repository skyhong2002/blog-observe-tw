import { type BlogGenre, isBlogGenre } from '../../../app/src/blog-genre-vocabulary.ts';
import type { Post } from './api.ts';

export type ArticleFilters = { maxPerBlog: number; exclude: BlogGenre[] };
export const NO_ARTICLE_FILTERS: ArticleFilters = { maxPerBlog: 0, exclude: [] };
export const BLOG_CAPS = [0, 1, 2, 3] as const;

/** Retired genre keys a shared URL may still carry (creative was 攝影／設計 before the 2026-10-17 split). */
const RETIRED: Record<string, BlogGenre> = { creative: 'design' };

/** Only supported caps and known genres survive a shared URL; repeated genres are harmless. */
export function articleFiltersOf(params: { get(key: string): string | null; getAll(key: string): string[] }): ArticleFilters {
  const raw = params.get('maxPerBlog');
  return {
    maxPerBlog: BLOG_CAPS.find((cap) => String(cap) === raw) ?? 0,
    exclude: [
      ...new Set(
        params
          .getAll('exclude')
          .map((genre) => (Object.hasOwn(RETIRED, genre) ? RETIRED[genre] : genre))
          .filter(isBlogGenre),
      ),
    ].sort(),
  };
}
export function articleFiltersHref(filters: ArticleFilters): string {
  const params = new URLSearchParams();
  if (filters.maxPerBlog) params.set('maxPerBlog', String(filters.maxPerBlog));
  for (const genre of filters.exclude) params.append('exclude', genre);
  return `/articles/${params.size ? `?${params}` : ''}`;
}

/** Input is already newest-first. Unknown genres and unidentified sources are always retained. */
export function filterLatestPosts(posts: Post[], filters: ArticleFilters) {
  const seen = new Map<string, number>();
  let hiddenGenre = 0;
  let hiddenCap = 0;
  const items = posts.filter((post) => {
    if (post.blogGenres?.some((genre) => filters.exclude.includes(genre))) {
      hiddenGenre++;
      return false;
    }
    if (!post.blogSlug || !filters.maxPerBlog) return true;
    const count = (seen.get(post.blogSlug) ?? 0) + 1;
    seen.set(post.blogSlug, count);
    if (count <= filters.maxPerBlog) return true;
    hiddenCap++;
    return false;
  });
  return { items, hiddenGenre, hiddenCap, unclassified: posts.filter((post) => !post.blogGenres?.length).length };
}
