/**
 * /tech/ and the blog profile's 使用的技術 section: the gateway's passive
 * technology observations (app/src/tech/routes.ts, read only). Pure, no
 * process.env and no fetch: client views and node --test import this file.
 *
 * Wording rules the views follow:
 * - An observation is partial evidence from responses the crawler already
 *   fetched; nothing seen is `unknown`, never "not used".
 * - `failed` / `blocked` are the latest attempt; detections kept with them are
 *   the last successful observation (observedAt), shown as history.
 * - A version is shown only when the gateway sends one with evidence; else 未知.
 * - Hosting / CDN hints are low-confidence infrastructure, never a CMS.
 * - Status counts and every share are of the blogs this read scanned
 *   (coverage.scannedBlogs); the public total is shown beside it.
 */
import { isCanonicalPagePath } from './page-links.ts';
import type { QueryReader } from './public-query.ts';

export type TechCategory = 'cms' | 'framework' | 'theme' | 'plugin' | 'analytics' | 'hosting' | 'cdn';
export type TechStatus = 'detected' | 'unknown' | 'failed' | 'blocked' | 'not-observed';
export type TechEvidence = { kind: 'generator' | 'asset' | 'marker' | 'header'; value: string };
export type TechDetection = {
  id: string;
  name: string;
  category: TechCategory;
  version: string;
  confidence: number;
  ruleId: string;
  ruleVersion: string;
  observedAt: string;
  evidence: TechEvidence[];
};
export type TechCoverageOfBlog = {
  partial: true;
  method: 'passive-existing-response';
  sourceType: 'html' | 'body-fragment' | 'header';
  htmlTruncated: boolean;
  inspectedNodes: number;
};
export type TechBlog = {
  id: number;
  slug: string;
  name: string;
  /** This site's absolute canonical page URL, or null when the registry has none. */
  url: string | null;
  /** The blog's own site. */
  sourceUrl: string | null;
  iconUrl: string | null;
  status: TechStatus;
  observedAt: string | null;
  lastAttemptAt: string | null;
  errorCode: string | null;
  evidenceSourceUrl: string | null;
  coverage: TechCoverageOfBlog | null;
  detections: TechDetection[];
};
export type TechMethod = { id: string; partial: true; additionalRequests: false; description: string };
export type TechCoverage = {
  totalBlogs: number;
  scannedBlogs: number;
  truncated: boolean;
  detected: number;
  unknown: number;
  failed: number;
  blocked: number;
  notObserved: number;
};
export type TechTechnology = {
  id: string;
  name: string;
  category: TechCategory;
  blogs: number;
  versions: Array<{ version: string; blogs: number }>;
};
export type TechStats = {
  generatedAt: string;
  method: TechMethod;
  coverage: TechCoverage;
  technologies: TechTechnology[];
  items: TechBlog[];
  pagination: { limit: number; nextCursor: string | null; total: number };
  filters: { q: string; technology: string; status: string };
};
export type BlogTechPayload = { generatedAt: string; method: TechMethod; blog: TechBlog };

/* Labels ----------------------------------------------------------------- */

export const TECH_STATUSES: TechStatus[] = ['detected', 'unknown', 'failed', 'blocked', 'not-observed'];
export const statusText: Record<TechStatus, string> = {
  detected: '有辨識',
  unknown: '未辨識',
  failed: '觀測失敗',
  blocked: '來源阻擋',
  // Same label as unknown: either way no known clue was seen. statusNote keeps the reason.
  'not-observed': '未辨識',
};
/** The /tech/ status chips. 未辨識 covers not-observed too (see unknownCount); the gateway's status=unknown matches both. */
export const STATUS_CHIPS: TechStatus[] = ['detected', 'unknown', 'failed', 'blocked'];
/** One sentence per status; none of them claims a technology is absent. */
export const statusNote: Record<TechStatus, string> = {
  detected: '在既有公開回應中辨識到下列技術線索。',
  unknown: '已觀測，但既有回應中沒有可辨識的線索；這不代表網站沒有使用任何技術。',
  failed: '最近一次觀測沒有成功（例如逾時或連線失敗），所以目前無法確認。',
  blocked: '最近一次觀測被來源拒絕（例如 robots.txt 或網站防護），本站不會繞過限制。',
  'not-observed': '還沒有可供辨識的公開回應（尚未有觀測紀錄），不能當成「未使用」。',
};
export const statusTone: Record<TechStatus, string> = {
  detected: 'text-brand-700 dark:text-brand-400',
  unknown: 'text-zinc-600 dark:text-zinc-400',
  failed: 'text-amber-700 dark:text-amber-400',
  blocked: 'text-amber-700 dark:text-amber-400',
  'not-observed': 'text-zinc-500 dark:text-zinc-400',
};
export const coverageKey: Record<TechStatus, Exclude<keyof TechCoverage, 'totalBlogs' | 'scannedBlogs' | 'truncated'>> = {
  detected: 'detected',
  unknown: 'unknown',
  failed: 'failed',
  blocked: 'blocked',
  'not-observed': 'notObserved',
};
/** A chip's count: 未辨識 adds the blogs with no observation yet. */
export const chipCount = (coverage: TechCoverage, state: TechStatus) =>
  state === 'unknown' ? coverage.unknown + coverage.notObserved : coverage[coverageKey[state]];
export const isTechStatus = (value: string): value is TechStatus => (TECH_STATUSES as string[]).includes(value);

export const errorText: Record<string, string> = {
  robots: 'robots.txt 不允許',
  waf: '網站防護擋下',
  'rate-limit': '來源限制請求頻率',
  'http-error': '來源回應 HTTP 錯誤',
  timeout: '連線逾時',
  network: '連線失敗',
  'invalid-response': '回應無法辨識',
};
export const errorLabel = (code: string | null) => (code ? (errorText[code] ?? '原因未記錄') : '原因未記錄');

export const categoryText: Record<TechCategory, string> = {
  cms: 'CMS／平台',
  framework: '網站框架',
  theme: '佈景主題',
  plugin: '外掛',
  analytics: '分析工具',
  hosting: '主機',
  cdn: 'CDN',
};
/** Site software, ranked apart from the infrastructure hints below. */
export const SOFTWARE_CATEGORIES: TechCategory[] = ['cms', 'framework', 'theme', 'plugin', 'analytics'];
/** Low-confidence header hints: where the site is served from, never what it is built with. */
export const INFRA_CATEGORIES: TechCategory[] = ['hosting', 'cdn'];
export const isInfra = (category: string) => (INFRA_CATEGORIES as string[]).includes(category);

export const sourceTypeText: Record<TechCoverageOfBlog['sourceType'], string> = {
  // A success snapshot's HTML may be the home page or an article page the crawler already read; never assume the home page.
  html: '公開 HTML（首頁或文章）',
  'body-fragment': '文章內文片段',
  header: '回應標頭',
};
/** What one observation looked at; a body fragment is never the whole site. */
export function coverageNote(coverage: TechCoverageOfBlog | null): string {
  if (!coverage) return '沒有觀測範圍紀錄。';
  const parts = [
    coverage.sourceType === 'body-fragment'
      ? '只檢查 RSS／文章內文片段，屬部分覆蓋，不代表已掃描全站'
      : coverage.sourceType === 'header'
        ? '只檢查回應標頭'
        : '檢查既有的公開 HTML 回應（首頁或文章）',
  ];
  if (coverage.htmlTruncated) parts.push('HTML 超過檢查上限，只看了前段');
  return `${parts.join('；')}。`;
}

/** The gateway's confidence buckets (0.95 / 0.7 / 0.3). */
export function confidenceLabel(value: number) {
  if (!Number.isFinite(value)) return '未記錄';
  return value >= 0.9 ? '高' : value >= 0.6 ? '中' : '低';
}
const knownVersion = (version: string | null | undefined): version is string => !!version && version !== 'unknown';
/** 'unknown' (or anything empty) is 未知; a version is never guessed. */
export const versionLabel = (version: string | null | undefined) => (knownVersion(version) ? version : '未知');
/** The version a detection may show: one the gateway sent together with its evidence, else null. */
export const shownVersion = (detection: Pick<TechDetection, 'version' | 'evidence'>) =>
  knownVersion(detection.version) && detection.evidence.length > 0 ? detection.version : null;
/** Aggregated versions worth listing: the gateway's explicit ones, never 'unknown'. */
export const explicitVersions = (technology: TechTechnology) => technology.versions.filter((v) => knownVersion(v.version));

export const evidenceKindText: Record<TechEvidence['kind'], string> = {
  generator: 'generator 標記',
  asset: '資源路徑',
  marker: '頁面標記',
  header: '回應標頭',
};

/** True while the detections shown are the last success, not this attempt's answer. */
export const isHistorical = (blog: Pick<TechBlog, 'status' | 'detections'>) =>
  (blog.status === 'failed' || blog.status === 'blocked') && blog.detections.length > 0;

/** Percent of `total`, one decimal; '—' without a denominator. */
export function share(count: number, total: number) {
  if (!(total > 0)) return '—';
  return `${((count / total) * 100).toLocaleString('zh-TW', { maximumFractionDigits: 1 })}%`;
}

/** Below this many blogs with any observation, rankings and shares say they are thin. */
export const LOW_DATA_BLOGS = 20;
/** Scanned blogs with an attempt on record (everything but not-observed). */
export const observedBlogs = (coverage: TechCoverage) => coverage.detected + coverage.unknown + coverage.failed + coverage.blocked;

/** The internal /blogs/<key>/ path of the payload's canonical URL, or null (never built from the slug). */
export function canonicalBlogPath(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.search || parsed.hash) return null;
  return isCanonicalPagePath('blog', parsed.pathname) ? parsed.pathname : null;
}

/** An http(s) URL for an external link, else null. */
export function externalHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}
export const hostOf = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/* URL query --------------------------------------------------------------- */

const TECH_KEYS = ['q', 'technology', 'status', 'cursor'] as const;
export type TechQuery = Partial<Record<(typeof TECH_KEYS)[number], string>>;

/** The gateway's technology id shape (techFilters in app/src/tech/routes.ts). */
export const isTechId = (id: string) => id.length <= 64 && /^(?:(?:wp-theme|wp-plugin):)?[a-z0-9][a-z0-9-]*$/.test(id);
const validQ = (q: string) => [...q].length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(q);
const validCursor = (cursor: string) => /^\d{1,15}$/.test(cursor) && Number.isSafeInteger(Number(cursor));

/**
 * The tech keys in the URL that the gateway would accept; anything it would
 * answer 400 to is dropped (reported by `ignored`) instead of being sent.
 */
export function techQueryOf(query: QueryReader): { query: TechQuery; ignored: boolean } {
  const picked: TechQuery = {};
  let ignored = false;
  const q = (query.get('q') ?? '').trim();
  if (q) {
    if (validQ(q)) picked.q = q;
    else ignored = true;
  }
  const technology = query.get('technology') ?? '';
  if (technology) {
    if (isTechId(technology)) picked.technology = technology;
    else ignored = true;
  }
  const status = query.get('status') ?? '';
  if (status) {
    if (isTechStatus(status)) picked.status = status;
    else ignored = true;
  }
  const cursor = query.get('cursor') ?? '';
  if (cursor) {
    if (validCursor(cursor)) picked.cursor = cursor;
    else ignored = true;
  }
  return { query: picked, ignored };
}

export const isTechBaseline = (query: TechQuery) => TECH_KEYS.every((key) => query[key] === undefined);

/** Same-origin gateway path for a tech query, keys in a fixed order. */
export function techApiPath(query: TechQuery = {}): string {
  const params = new URLSearchParams();
  for (const key of TECH_KEYS) if (typeof query[key] === 'string' && query[key]) params.set(key, query[key]);
  const search = params.toString();
  return search ? `/api/tech?${search}` : '/api/tech';
}

/** /tech/ with the given filters (cursor dropped unless asked for); technology ids are URL-encoded. */
export function techHref(filters: TechQuery) {
  const params = new URLSearchParams();
  for (const key of TECH_KEYS) if (filters[key]) params.set(key, filters[key]);
  const search = params.toString();
  return search ? `/tech/?${search}` : '/tech/';
}
/** /tech/'s 資料來源與計算方式 (FooterMethod's #method), for links from elsewhere. */
export const TECH_METHOD_HREF = '/tech/#method';

export const blogTechApiPath = (slug: string) => `/api/blogs/${encodeURIComponent(slug)}/tech`;
