/**
 * Full-text search over recently collected posts via the gateway's /api/search.
 * The page shows the API's short snippet (≤240 characters) and never any
 * further body text. Pure helpers only (node --test imports this file); the
 * gateway call lives in search-api.ts.
 */
import type { Post } from './api';

export const SEARCH_LIMIT = 20;
export const SNIPPET_MAX = 240;
export const QUERY_MAX = 100;
export type MatchSource = 'body' | 'metadata';
export type SearchItem = Post & { snippet: string | null; matchSource: MatchSource | null };
export type SearchResult = {
  items: SearchItem[];
  page: number;
  hasMore: boolean;
  coverage: { limit: number; scannedPosts: number | null; truncated: boolean };
  query: string;
  generatedAt: string | null;
};
export type SearchParams = { q: string; page: number; blog: string | null };
/** What /articles/ shows without a query: the latest posts, no search. */
export const NO_SEARCH: SearchParams = { q: '', page: 1, blog: null };

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** Reads ?q=&page=&blog= defensively: trimmed query, positive page, a slug-shaped blog or none. */
export function searchParamsOf(input: Record<string, string | string[] | undefined>): SearchParams {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
  const q = one(input.q).replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);
  const page = Number.parseInt(one(input.page), 10);
  const blog = one(input.blog).trim();
  return {
    q,
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 50) : 1,
    blog: /^[\w.-]{1,255}$/.test(blog) ? blog : null,
  };
}

/** Same-page URL with q (and blog) kept; page 1 is left implicit. */
export function searchHref({ q, page, blog }: SearchParams): string {
  const params = new URLSearchParams({ q });
  if (blog) params.set('blog', blog);
  if (page > 1) params.set('page', String(page));
  return `/articles/?${params}`;
}

/** Plain text, at most SNIPPET_MAX characters, cut with an ellipsis. */
export function clampSnippet(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Same stripping as api.ts plainText, so stray markup never reaches the page.
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(?:nbsp|amp|lt|gt|quot|#39);/g,
      (entity) => ({ '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" })[entity] ?? entity,
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const chars = [...text];
  return chars.length > SNIPPET_MAX ? `${chars.slice(0, SNIPPET_MAX - 1).join('')}…` : text;
}

export function normalizeSearch(raw: unknown, asked: SearchParams): SearchResult | null {
  if (!record(raw) || !Array.isArray(raw.items)) return null;
  const pagination = record(raw.pagination) ? raw.pagination : {};
  const coverage = record(raw.coverage) ? raw.coverage : {};
  const items = raw.items.filter(record).flatMap((item): SearchItem[] => {
    if (typeof item.title !== 'string') return [];
    const { snippet, matchSource, body: _body, content: _content, ...post } = item;
    return [
      {
        ...(post as Post),
        snippet: clampSnippet(snippet),
        matchSource: matchSource === 'body' || matchSource === 'metadata' ? matchSource : null,
      },
    ];
  });
  return {
    items: items.slice(0, SEARCH_LIMIT),
    page: count(pagination.page) || asked.page,
    hasMore: pagination.hasMore === true,
    coverage: {
      limit: count(coverage.limit) || 1000,
      scannedPosts: count(coverage.scannedPosts),
      truncated: coverage.truncated === true,
    },
    query: typeof raw.query === 'string' ? raw.query.slice(0, QUERY_MAX) : asked.q,
    generatedAt: typeof raw.generatedAt === 'string' && Number.isFinite(Date.parse(raw.generatedAt)) ? raw.generatedAt : null,
  };
}

/** Gateway path for one search page. */
export function searchPath(asked: SearchParams): string {
  const params = new URLSearchParams({ q: asked.q, page: String(asked.page), limit: String(SEARCH_LIMIT) });
  if (asked.blog) params.set('blog', asked.blog);
  return `/api/search?${params}`;
}
