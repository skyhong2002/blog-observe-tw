/**
 * URL query handling for the public list pages. The pages themselves are
 * rendered on the server without a query (force-dynamic, no-store reads);
 * these helpers read the browser's query,
 * decide whether it differs from that baseline, and build the same-origin
 * public API path that answers it. Pure: node --test imports this file.
 */
import type { AuthorCatalogQuery, CatalogQuery } from './api';

/** Anything with URLSearchParams' `get` (also Next's ReadonlyURLSearchParams). */
export type QueryReader = { get(key: string): string | null };

const value = (query: QueryReader, key: string) => query.get(key) ?? undefined;

/* /blogs/ ---------------------------------------------------------------- */

const CATALOG_KEYS = ['q', 'category', 'genre', 'status', 'kind', 'sort', 'dir', 'page', 'limit'] as const;
const siteKinds = ['personal', 'group', 'organization', 'unknown'] as const;
const catalogSorts = ['name', 'category', 'posts', 'authors', 'latest', 'crawl', 'status'] as const;
/** A column of the table, or (only while searching) best match first. */
export type CatalogSort = (typeof catalogSorts)[number] | 'relevance';
export type CatalogFilters = {
  q: string;
  category: string;
  /** A genre key, or '-' for blogs no genre is shown for yet (app/src/catalog.js). */
  genre: string;
  status: string;
  /** Who runs the blog (app/src/catalog.js SITE_KINDS), or '' for all. */
  kind?: (typeof siteKinds)[number] | '';
  sort: CatalogSort;
  dir: 'asc' | 'desc';
  page: number;
  limit: number;
};

/** The catalog keys present in the URL, untouched otherwise (the gateway normalises them). */
export function catalogQueryOf(query: QueryReader): CatalogQuery {
  const picked: CatalogQuery = {};
  for (const key of CATALOG_KEYS) {
    const found = value(query, key);
    if (found !== undefined) picked[key] = found.slice(0, 300);
  }
  return picked;
}

const chars = (text: string | undefined, length: number) =>
  typeof text === 'string' ? Array.from(text.trim()).slice(0, length).join('') : '';
const positive = (text: string | undefined, fallback: number) => {
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return fallback;
  const number = Number(text);
  return Number.isSafeInteger(number) ? Math.max(1, number) : Number.MAX_SAFE_INTEGER;
};

/** Mirrors the gateway's catalogFilters (app/src/catalog.js) so a pending view highlights what was asked. */
export function catalogFiltersOf(query: CatalogQuery): CatalogFilters {
  const q = chars(query.q, 100);
  const column = catalogSorts.find((sort) => sort === query.sort);
  const sort: CatalogSort = column ?? (q ? 'relevance' : 'latest');
  return {
    q,
    category: chars(query.category, 255),
    genre: chars(query.genre, 40),
    status: chars(query.status, 64),
    kind: siteKinds.find((kind) => kind === query.kind) ?? '',
    sort,
    dir: query.dir === 'asc' || query.dir === 'desc' ? query.dir : ['name', 'category', 'status'].includes(sort) ? 'asc' : 'desc',
    page: positive(query.page, 1),
    limit: Math.min(200, positive(query.limit, 50)),
  };
}

/** Same-origin path for a catalog query, keys in a fixed order. */
export function catalogApiPath(query: CatalogQuery): string {
  const params = new URLSearchParams();
  for (const key of CATALOG_KEYS) if (typeof query[key] === 'string') params.set(key, query[key]);
  const search = params.toString();
  return search ? `/api/catalog?${search}` : '/api/catalog';
}

/** The same query as an OPML file of the matching blogs' feeds (no paging or order). */
export function catalogOpmlPath(query: CatalogQuery): string {
  const params = new URLSearchParams();
  for (const key of ['q', 'category', 'genre', 'status', 'kind'] as const) if (query[key]) params.set(key, query[key]);
  const search = params.toString();
  return search ? `/api/catalog.opml?${search}` : '/api/catalog.opml';
}

/** True when the URL asks for something other than the prerendered catalog. */
export const isCatalogBaseline = (query: CatalogQuery) => CATALOG_KEYS.every((key) => query[key] === undefined);

/* /authors/ -------------------------------------------------------------- */

type AuthorQuery = AuthorCatalogQuery;
const AUTHOR_KEYS = ['author', 'page', 'limit'] as const;

export function authorQueryOf(query: QueryReader): AuthorQuery {
  const picked: AuthorQuery = {};
  for (const key of AUTHOR_KEYS) {
    const found = value(query, key);
    if (found !== undefined) picked[key] = found.slice(0, 300);
  }
  return picked;
}

/** A positive 32-bit author id, as the gateway's /api/catalog/authors requires. */
export const isAuthorId = (id: string) => /^[1-9]\d*$/.test(id) && Number(id) <= 2147483647;

export function authorApiPath(query: AuthorQuery): string {
  const params = new URLSearchParams();
  for (const key of AUTHOR_KEYS) if (typeof query[key] === 'string') params.set(key, query[key]);
  const search = params.toString();
  return search ? `/api/catalog/authors?${search}` : '/api/catalog/authors';
}

export const isAuthorBaseline = (query: AuthorQuery) => AUTHOR_KEYS.every((key) => query[key] === undefined);

/* Period tabs: /topics/, /topics/[id]/, /relations/ ---------------------- */

export const PERIODS = ['7', '30', '90'] as const;
export type Period = (typeof PERIODS)[number];
/** The period each page prerenders; the others are read in the browser. */
export const TOPICS_PERIOD: Period = '30';
export const RELATIONS_PERIOD: Period = '90';

/** `?days=` when it is one of the offered periods, otherwise the page's default. */
export function periodOf(query: QueryReader, fallback: Period): Period {
  const days = query.get('days');
  return PERIODS.includes(days as Period) ? (days as Period) : fallback;
}

export const topicsApiPath = (days: Period) => `/api/topics?days=${days}`;
/** The homepage's bounded projections (view=home): their own kinds and contracts, never the full pages' payloads. */
export const HOME_OVERVIEW_PATH = '/api/overview?view=home';
/** A profile's topics over its original 90-day period: one path, so its list and its word cloud share one read. */
export const BLOG_TOPICS_PERIOD: Period = '90';
export const blogTopicsApiPath = (slug: string) => `/api/blogs/${encodeURIComponent(slug)}/topics?days=${BLOG_TOPICS_PERIOD}`;
export const homeTopicsApiPath = (days: Period) => `/api/topics?days=${days}&view=home`;
export const relationsApiPath = (days: Period) => `/api/relations?days=${days}`;
/** `id` is always the stable topic id (never the readable canonical path); `historyCursor` asks for the next history page. */
export function topicApiPath(id: string, days: Period, historyCursor?: string) {
  const path = `/api/topics/${encodeURIComponent(id)}?days=${days}`;
  return historyCursor === undefined ? path : `${path}&historyCursor=${encodeURIComponent(historyCursor)}`;
}

/** An opaque gateway history cursor worth sending back: base64url of at most 256 characters, as app/src/topics/history-read.ts accepts. */
export const isHistoryCursor = (cursor: unknown): cursor is string => typeof cursor === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(cursor);

/** The gateway's topic id shapes (app/src/topics/routes.ts). */
export const isTopicId = (id: string) => /^(rss:[1-9]\d{0,9}|tag:[0-9a-f]{64})$/.test(id);

/* /tags/ and /blogs/[slug]/ ---------------------------------------------- */

/** A tag or blog slug worth asking the gateway about: one path segment within the routes' 255 (UTF-16) limit. */
export const isSlug = (slug: string) => slug.length > 0 && slug.length <= 255 && !/[/\\?#\s\p{Cc}]/u.test(slug);

export const tagApiPath = (slug: string) => `/api/tags/${encodeURIComponent(slug)}`;

/** `?q=` for a blog profile's in-page filter: trimmed to the form's 100 characters. */
export const profileQueryOf = (query: QueryReader) => (query.get('q') ?? '').slice(0, 100);

/** Next params may arrive percent-encoded; decode once, keep the raw text when it is not valid encoding. */
export function decodeParam(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
