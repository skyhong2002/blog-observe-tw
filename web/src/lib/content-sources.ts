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
    /** Known platform code, `unrecognized`, or null; never the raw value. */
    platform: string | null;
    lastMethod: ContentSourceKind | null;
    status: ContentStatus | null;
    /** Already reduced to a fixed reader phrase (see reasonText), or null when nothing needs saying. */
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
/** Known platform codes in reader words; anything else reads as 尚未辨識, never the raw code. */
const platformText: Record<string, string> = {
  generic: '一般網頁',
  wordpress: 'WordPress',
  blogger: 'Blogger',
  pixnet: '痞客邦',
  medium: 'Medium',
  substack: 'Substack',
  vocus: '方格子',
  matters: 'Matters',
  hugo: 'Hugo',
  jekyll: 'Jekyll',
  ghost: 'Ghost',
  hexo: 'Hexo',
};
const unrecognizedPlatform = '尚未辨識';
const statuses = new Set(Object.keys(contentStatusText));
const kinds = new Set(Object.keys(sourceText));
/**
 * Reason codes, checked in this order. `content-limit` comes first so the word "limit" can never read as a
 * source restriction; only robots / HTTP 401 / 403 / paywall do.
 */
const reasonGroups: [RegExp, string][] = [
  [/content[-_ ]?limit/i, '內容超過收錄長度上限'],
  [/budget|deferred/i, '等待下次處理'],
  [/publisher[-_ ]?excerpt/i, '來源只提供部分內容'],
  [/robots|paywall|(?<!\d)40[13](?!\d)/i, '來源限制'],
];

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const status = (value: unknown) => (typeof value === 'string' && statuses.has(value) ? (value as ContentStatus) : null);
const kind = (value: unknown) => (typeof value === 'string' && kinds.has(value) ? (value as ContentSourceKind) : null);
const time = (value: unknown) => (typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value)) ? value : null);

/** Never shows the raw code or error text: a fixed phrase per reason group, nothing when the status is fine. */
export function reasonText(reason: unknown, current: ContentStatus | null): string | null {
  if (current === 'ok' || current === 'no-posts') return null;
  const code = typeof reason === 'string' ? reason.slice(0, 200) : '';
  for (const [pattern, text] of code ? reasonGroups : []) if (pattern.test(code)) return text;
  if (current === 'blocked') return '來源限制';
  if (current === 'partial') return '尚未完整取得';
  return code || current === 'missing' ? '尚未取得' : null;
}
export const completenessLabel = (value: string | null) => (value ? (completenessText[value.toLowerCase()] ?? null) : null);
/** Lower-cased known platform code, `unrecognized` for any other value, null when none was sent. */
const platformCode = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const code = value.trim().toLowerCase();
  return Object.hasOwn(platformText, code) ? code : 'unrecognized';
};
export const platformLabel = (value: string | null) => {
  const code = platformCode(value);
  return code ? (platformText[code] ?? unrecognizedPlatform) : null;
};

export function normalizeContent(raw: unknown): BlogContent | null {
  if (!record(raw) || !record(raw.blog)) return null;
  const blog = raw.blog;
  const current = status(blog.status);
  return {
    blog: {
      platform: platformCode(blog.platform),
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
