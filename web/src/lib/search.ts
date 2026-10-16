/**
 * Search via the gateway's /api/search (app/src/search.ts). Older gateways match
 * metadata over the latest ingested posts plus a partial body-prefix index; the
 * historical contract (HISTORICAL_COVERAGE_TYPE) matches metadata over all indexed
 * public posts plus the whole collected body of indexed articles. The page shows the
 * API's short snippet (≤240 characters) and never any further body text.
 * normalizeSearch keeps an explicit allowlist: no input key reaches the view
 * unless it is listed and typed here. Pure helpers only (node --test imports
 * this file).
 */
import type { Post, Tag } from './api';

export const SEARCH_LIMIT = 20;
export const SNIPPET_MAX = 240;
export const QUERY_MAX = 100;
export type MatchSource = 'body' | 'metadata';
/** Where the shown snippet was taken from (app/src/search.ts contextSource, search-body-index.ts). */
export const CONTEXT_SOURCES = ['title', 'summary', 'blog-name', 'tag', 'body', 'metadata'] as const;
export type ContextSource = (typeof CONTEXT_SOURCES)[number];
/** Per-hit evidence; null is "not provided" (older gateways, or a value this page does not accept). */
export type SearchEvidence = {
  articleId: number | null;
  matchVersion: string | null;
  contextSource: ContextSource | null;
  snippetNormalization: string | null;
};
export type SearchItem = Post & { snippet: string | null; matchSource: MatchSource | null } & SearchEvidence;
/** `indexed`: the whole-body index (nfkc-bigram-whole-body-v1); `partial`: the older prefix index, still accepted. */
export const HISTORICAL_STATUSES = ['not-enabled', 'short-query', 'partial', 'indexed', 'unavailable'] as const;
/** coverage.type of the historical whole-body contract: metadata over all indexed public posts plus whole collected bodies. */
export const HISTORICAL_COVERAGE_TYPE = 'historical-indexed-metadata-and-whole-body';
/** coverage.historicalBody; `unrecognized` is a status this page does not know, shown as not provided. */
export type HistoricalBodyCoverage = {
  status: (typeof HISTORICAL_STATUSES)[number] | 'unrecognized';
  indexVersion: string | null;
  normalization: string | null;
  scope: string | null;
  prefixCodepoints: number | null;
  rawBodyByteLimit: number | null;
  candidateLimit: number | null;
  candidates: number | null;
  candidateTruncated: boolean | null;
  staleOrIneligible: number | null;
  invalidUtf8: number | null;
  overcap: number | null;
  prefixTruncatedCandidates: number | null;
  /** The gateway says 'unknown': it does not know how many articles have no index entry. */
  unindexed: number | 'unknown' | null;
  /** Only `false` is kept: a claimed exhaustive search is not something this page repeats. */
  exhaustive: false | null;
};
export type SearchCoverage = {
  type: string | null;
  /**
   * Older contract: the latest `limit` ingested posts. Historical contract (metadataScope all-indexed-public-posts):
   * the cap on result candidates, not a recency window. null: not provided, never assumed.
   */
  limit: number | null;
  /** coverage.metadata.scope, e.g. 'latest-ingested-ids' or 'all-indexed-public-posts'; null when not sent. */
  metadataScope: string | null;
  scannedPosts: number | null;
  truncated: boolean | null;
  metadataFields: string[] | null;
  /** null: an older gateway that sends no historical-body coverage at all. */
  historicalBody: HistoricalBodyCoverage | null;
  statementTimeoutMs: number | null;
  maximumStatements: number | null;
};
export type SearchResult = {
  items: SearchItem[];
  page: number;
  hasMore: boolean;
  coverage: SearchCoverage;
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

const positive = (value: unknown) => (Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null);
const flag = (value: unknown) => (typeof value === 'boolean' ? value : null);
/** A short identifier (version, scope, normalization name); anything else is not provided. */
const label = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) ? value : null);
const shortText = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : undefined);
const nullableText = (value: unknown, max: number) => (value === null ? null : shortText(value, max));
/** Only http(s) links leave the page; anything else is dropped (the item shows no link). */
const webUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? value : null;
  } catch {
    return null;
  }
};
const isoDate = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
const METADATA_FIELDS = ['title', 'summary', 'blog-name', 'public-tags'];

/** The public post keys a list row renders (app/src/public-post.ts PUBLIC_POST_FIELDS and Post); nothing else is copied. */
function postOf(item: Record<string, unknown>, title: string): Post {
  const post: Post = { title: title.slice(0, 500) };
  const id = positive(item.id);
  if (id !== null) post.id = id;
  const guid = shortText(item.guid, 500);
  if (guid !== undefined) post.guid = guid;
  if (item.url !== undefined) post.url = webUrl(item.url);
  const summary = nullableText(item.summary, 2000);
  if (summary !== undefined) post.summary = summary;
  const author = nullableText(item.author, 200);
  if (author !== undefined) post.author = author;
  if (item.publishedAt !== undefined) post.publishedAt = isoDate(item.publishedAt);
  if (item.imageUrl !== undefined) post.imageUrl = webUrl(item.imageUrl);
  if (typeof item.blogSlug === 'string' && /^[\p{L}\p{N}_.-]{1,255}$/u.test(item.blogSlug)) post.blogSlug = item.blogSlug;
  const blogName = shortText(item.blogName, 200);
  if (blogName !== undefined) post.blogName = blogName;
  if (typeof item.blogCanonicalPath === 'string' && /^\/blogs\/[^/?#\s\\]{1,765}\/$/.test(item.blogCanonicalPath))
    post.blogCanonicalPath = item.blogCanonicalPath;
  if (Array.isArray(item.tags)) {
    const tags = item.tags
      .filter((tag): tag is Record<string, unknown> => record(tag) && typeof tag.slug === 'string' && typeof tag.label === 'string')
      .slice(0, 20)
      .map((tag) => ({ slug: (tag.slug as string).slice(0, 255), label: (tag.label as string).slice(0, 255) }) as Tag);
    if (tags.length) post.tags = tags;
    const tagCount = positive(item.tagCount);
    if (tags.length && tagCount !== null) post.tagCount = tagCount;
  }
  return post;
}

function historicalBodyOf(value: unknown): HistoricalBodyCoverage | null {
  if (!record(value)) return null;
  const status = HISTORICAL_STATUSES.find((known) => known === value.status) ?? 'unrecognized';
  return {
    status,
    indexVersion: label(value.indexVersion),
    normalization: label(value.normalization),
    scope: label(value.scope),
    prefixCodepoints: positive(value.prefixCodepoints),
    rawBodyByteLimit: positive(value.rawBodyByteLimit),
    candidateLimit: positive(value.candidateLimit),
    candidates: count(value.candidates),
    candidateTruncated: flag(value.candidateTruncated),
    staleOrIneligible: count(value.staleOrIneligible),
    invalidUtf8: count(value.invalidUtf8),
    overcap: count(value.overcap),
    prefixTruncatedCandidates: count(value.prefixTruncatedCandidates),
    unindexed: value.unindexed === 'unknown' ? 'unknown' : count(value.unindexed),
    exhaustive: value.exhaustive === false ? false : null,
  };
}

function coverageOf(value: unknown): SearchCoverage {
  const coverage = record(value) ? value : {};
  const metadata = record(coverage.metadata) ? coverage.metadata : null;
  const fields =
    metadata && Array.isArray(metadata.fields)
      ? metadata.fields.filter((field): field is string => METADATA_FIELDS.includes(field as string))
      : null;
  return {
    type: label(coverage.type),
    limit: positive(coverage.limit),
    metadataScope: metadata ? label(metadata.scope) : null,
    scannedPosts: count(coverage.scannedPosts),
    truncated: flag(coverage.truncated),
    metadataFields: fields,
    historicalBody: historicalBodyOf(coverage.historicalBody),
    statementTimeoutMs: positive(coverage.statementTimeoutMs),
    maximumStatements: positive(coverage.maximumStatements),
  };
}

export function normalizeSearch(raw: unknown, asked: SearchParams): SearchResult | null {
  if (!record(raw) || !Array.isArray(raw.items)) return null;
  const pagination = record(raw.pagination) ? raw.pagination : {};
  const items = raw.items.filter(record).flatMap((item): SearchItem[] => {
    if (typeof item.title !== 'string') return [];
    const matchSource = item.matchSource === 'body' || item.matchSource === 'metadata' ? item.matchSource : null;
    return [
      {
        ...postOf(item, item.title),
        snippet: clampSnippet(item.snippet),
        matchSource,
        articleId: positive(item.articleId),
        matchVersion: label(item.matchVersion),
        contextSource: CONTEXT_SOURCES.find((source) => source === item.contextSource) ?? null,
        snippetNormalization: label(item.snippetNormalization),
      },
    ];
  });
  return {
    items: items.slice(0, SEARCH_LIMIT),
    page: positive(pagination.page) ?? asked.page,
    hasMore: pagination.hasMore === true,
    coverage: coverageOf(raw.coverage),
    query: typeof raw.query === 'string' ? raw.query.slice(0, QUERY_MAX) : asked.q,
    generatedAt: isoDate(raw.generatedAt),
  };
}

export const MISSING = '未提供';
const CONTEXT_LABELS: Record<ContextSource, string> = {
  title: '標題',
  summary: '公開摘要',
  'blog-name': '部落格名稱',
  tag: '公開標籤',
  body: '已取得的文章正文',
  metadata: '標題或摘要',
};
/** Where the snippet came from, as the gateway said; never inferred from matchSource. */
export const contextSourceText = (source: ContextSource | null) => (source ? CONTEXT_LABELS[source] : MISSING);
export const countText = (value: number | null) => (value === null ? MISSING : value.toLocaleString('zh-TW'));
/** A byte limit as the gateway sent it: whole KiB when exact, bytes otherwise. */
export const bytesText = (value: number | null) =>
  value === null
    ? MISSING
    : value % 1024 === 0
      ? `${(value / 1024).toLocaleString('zh-TW')} KiB`
      : `${value.toLocaleString('zh-TW')} bytes`;

/** Gateway path for one search page. */
export function searchPath(asked: SearchParams): string {
  const params = new URLSearchParams({ q: asked.q, page: String(asked.page), limit: String(SEARCH_LIMIT) });
  if (asked.blog) params.set('blog', asked.blog);
  return `/api/search?${params}`;
}
