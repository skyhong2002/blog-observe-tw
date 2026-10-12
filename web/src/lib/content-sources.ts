/**
 * Where a blog's article text comes from (/api/blogs/:slug/content), mapped to
 * plain reader-facing words. Only the known fields below ever reach the page:
 * raw reasons, stack traces and any body text are dropped here.
 */
export type ContentStatus = 'ok' | 'partial' | 'missing' | 'blocked' | 'deferred' | 'pending' | 'no-posts';
export type ContentSourceKind = 'rss-content' | 'atom-content' | 'wordpress-api' | 'article-html';
export type ContentSource = {
  status: ContentStatus | null;
  source: ContentSourceKind | null;
  completeness: string | null;
  count: number | null;
};
export type BlogContent = {
  blog: {
    platform: string | null;
    lastMethod: ContentSourceKind | null;
    status: ContentStatus | null;
    /** Already reduced to one of two safe phrases, or null when nothing needs saying. */
    reason: string | null;
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
  };
  sources: ContentSource[];
};
// `publicContent` is not read: whatever it says, pages show only summaries and links to the original.

export const contentStatusText: Record<ContentStatus, string> = {
  ok: '已取得內文',
  partial: '部分取得',
  missing: '尚未取得內文',
  blocked: '來源限制',
  deferred: '暫緩處理',
  pending: '等待處理',
  'no-posts': '尚無文章',
};
export const contentStatusTone: Record<ContentStatus, string> = {
  ok: 'text-brand-700 dark:text-brand-400',
  partial: 'text-amber-700 dark:text-amber-400',
  missing: 'text-zinc-600 dark:text-zinc-400',
  blocked: 'text-amber-700 dark:text-amber-400',
  deferred: 'text-zinc-600 dark:text-zinc-400',
  pending: 'text-zinc-600 dark:text-zinc-400',
  'no-posts': 'text-zinc-600 dark:text-zinc-400',
};
export const sourceText: Record<ContentSourceKind, string> = {
  'rss-content': 'RSS 全文',
  'atom-content': 'Atom 內容',
  'wordpress-api': '平台 API',
  'article-html': 'HTML 抽取',
};
const completenessText: Record<string, string> = {
  full: '完整',
  complete: '完整',
  partial: '部分',
  truncated: '部分',
  summary: '僅摘要',
  excerpt: '僅摘要',
};
const platformText: Record<string, string> = {
  wordpress: 'WordPress',
  blogger: 'Blogger',
  medium: 'Medium',
  substack: 'Substack',
  ghost: 'Ghost',
  hexo: 'Hexo',
  hugo: 'Hugo',
  jekyll: 'Jekyll',
  pixnet: '痞客邦',
  vocus: '方格子',
  matters: 'Matters',
  other: '其他',
};
const statuses = new Set(Object.keys(contentStatusText));
const kinds = new Set(Object.keys(sourceText));
/** Reason codes that mean the site or its terms limit fetching; everything else reads as not yet fetched. */
const limitedReason = /block|forbid|denied|robots|paywall|login|auth|captcha|rate|limit|403|401|429|terms|optout|opt-out/i;

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const status = (value: unknown) => (typeof value === 'string' && statuses.has(value) ? (value as ContentStatus) : null);
const kind = (value: unknown) => (typeof value === 'string' && kinds.has(value) ? (value as ContentSourceKind) : null);
const time = (value: unknown) => (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null);

/** Never shows the raw code: `來源限制` for limits, `尚未取得` otherwise, nothing when the status is fine. */
export function reasonText(reason: unknown, current: ContentStatus | null): string | null {
  if (current === 'ok' || current === 'no-posts') return null;
  if (current === 'blocked') return '來源限制';
  if (typeof reason !== 'string' || !reason) return current === 'missing' ? '尚未取得' : null;
  return limitedReason.test(reason.slice(0, 200)) ? '來源限制' : '尚未取得';
}
export const completenessLabel = (value: string | null) => (value ? (completenessText[value.toLowerCase()] ?? null) : null);
export const platformLabel = (value: string | null) =>
  value ? (platformText[value.toLowerCase()] ?? (/^[\w .-]{1,30}$/.test(value) ? value : null)) : null;

export function normalizeContent(raw: unknown): BlogContent | null {
  if (!record(raw) || !record(raw.blog)) return null;
  const blog = raw.blog;
  const current = status(blog.status);
  return {
    blog: {
      platform: typeof blog.platform === 'string' ? blog.platform : null,
      lastMethod: kind(blog.lastMethod),
      status: current,
      reason: reasonText(blog.reason, current),
      lastAttemptAt: time(blog.lastAttemptAt),
      lastSuccessAt: time(blog.lastSuccessAt),
    },
    sources: (Array.isArray(raw.sources) ? raw.sources : []).filter(record).map((source) => ({
      status: status(source.status),
      source: kind(source.source),
      completeness: typeof source.completeness === 'string' ? source.completeness.slice(0, 40) : null,
      // A count the API did not record stays unknown, never 0.
      count: typeof source.count === 'number' && Number.isInteger(source.count) && source.count >= 0 ? source.count : null,
    })),
  };
}
