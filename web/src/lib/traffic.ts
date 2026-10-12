/**
 * Blog traffic from the local gateway's /api/traffic (Similarweb extension,
 * whole-domain estimates). Sorting, month and change helpers adapted from
 * tag.observe.tw lib/traffic-comparison.mts and lib/media-traffic.mts (afe0a65).
 *
 * Nothing here fills gaps: a month the source did not report stays missing,
 * a blog without an estimate has `traffic: null`, and zero only appears when
 * the source itself said zero.
 */
import { isCanonicalPagePath } from './page-links.ts';
export type TrafficStatus = 'ready' | 'pending' | 'blocked' | 'no-data' | 'unavailable';
export type TrafficPoint = { month: string; visits: number };
export type TrafficBlog = {
  slug: string;
  /** Readable blog page when the gateway sent a valid one (page-links.ts). */
  canonicalPath?: string;
  name: string;
  domain: string;
  status: TrafficStatus;
  fetchedAt: string | null;
  traffic: {
    /** Oldest first, one point per month. */
    monthly: TrafficPoint[];
    globalRank: number | null;
    countryRank: { code: string; rank: number } | null;
    category: string | null;
    topCountries: Array<{ code: string; share: number }>;
  } | null;
};
export type TrafficData = { source: string; scope: string; limitations: string; blogs: TrafficBlog[] };

/** What a row can say about its figures. `stale` is a non-ready fetch that still carries the last estimate. */
export type TrafficState = 'ready' | 'stale' | 'pending' | 'blocked' | 'no-data' | 'unavailable';
export const stateText: Record<TrafficState, string> = {
  ready: '已取得',
  stale: '保留上次估計',
  pending: '等待抓取',
  blocked: '來源暫緩',
  'no-data': '來源無估計',
  unavailable: '暫時無法取得',
};
export const stateHint: Record<TrafficState, string> = {
  ready: '已取得最新一次的網域估計',
  stale: '這次更新沒有成功，顯示的是上次取得的估計',
  pending: '尚未取得資料，有資料後才會顯示，不以零補值',
  blocked: '資料來源暫時不提供這個網域的估計',
  'no-data': '資料來源沒有這個網域的估計；低流量網站常見，不代表沒有讀者',
  unavailable: '資料暫時無法取得或格式不符，稍後會再試',
};
export const stateTone: Record<TrafficState, string> = {
  ready: 'text-brand-700 dark:text-brand-400',
  stale: 'text-amber-700 dark:text-amber-400',
  pending: 'text-zinc-500 dark:text-zinc-400',
  blocked: 'text-amber-700 dark:text-amber-400',
  'no-data': 'text-zinc-500 dark:text-zinc-400',
  unavailable: 'text-zinc-500 dark:text-zinc-400',
};
export const trafficStates = Object.keys(stateText) as TrafficState[];
const statuses = new Set<TrafficStatus>(['ready', 'pending', 'blocked', 'no-data', 'unavailable']);

export function stateOf(blog: TrafficBlog): TrafficState {
  if (blog.status === 'ready') return blog.traffic ? 'ready' : 'unavailable';
  return blog.traffic?.monthly.length ? 'stale' : blog.status;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max = 255) => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);
const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);
const rank = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null);
const country = (value: unknown) => (typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : null);
const isMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{6}$/.test(value) && Number(value.slice(4)) >= 1 && Number(value.slice(4)) <= 12;

/** Validates a gateway payload; anything malformed is dropped rather than guessed. Returns null when unusable. */
export function normalizeTraffic(raw: unknown): TrafficData | null {
  if (!record(raw) || !Array.isArray(raw.blogs)) return null;
  const blogs: TrafficBlog[] = [];
  const seen = new Set<string>();
  for (const item of raw.blogs) {
    if (!record(item)) continue;
    const slug = text(item.slug);
    const domain = text(item.domain);
    if (!slug || !domain || seen.has(slug)) continue;
    seen.add(slug);
    const status = statuses.has(item.status as TrafficStatus) ? (item.status as TrafficStatus) : 'unavailable';
    const fetchedAt = text(item.fetchedAt, 40);
    let traffic: TrafficBlog['traffic'] = null;
    if (record(item.traffic)) {
      const t = item.traffic;
      const byMonth = new Map<string, number>();
      for (const point of Array.isArray(t.monthly) ? t.monthly : []) {
        if (!record(point) || !isMonth(point.month)) continue;
        const visits = count(point.visits);
        if (visits !== null) byMonth.set(point.month, visits);
      }
      const cr = record(t.countryRank) ? { code: country(t.countryRank.code), rank: rank(t.countryRank.rank) } : null;
      traffic = {
        monthly: [...byMonth].map(([month, visits]) => ({ month, visits })).sort((a, b) => a.month.localeCompare(b.month)),
        globalRank: rank(t.globalRank),
        countryRank: cr?.code && cr.rank ? { code: cr.code, rank: cr.rank } : null,
        category: text(t.category, 120),
        topCountries: (Array.isArray(t.topCountries) ? t.topCountries : [])
          .flatMap((c) => {
            if (!record(c)) return [];
            const code = country(c.code);
            const share = count(c.share);
            return code && share !== null && share <= 1 ? [{ code, share }] : [];
          })
          .sort((a, b) => b.share - a.share)
          .slice(0, 5),
      };
    }
    blogs.push({
      slug,
      ...(isCanonicalPagePath('blog', item.canonicalPath) ? { canonicalPath: item.canonicalPath } : {}),
      name: text(item.name) ?? slug,
      domain,
      status,
      fetchedAt: fetchedAt && Number.isFinite(Date.parse(fetchedAt)) ? fetchedAt : null,
      traffic,
    });
  }
  return {
    source: text(raw.source) ?? 'similarweb-extension',
    scope: text(raw.scope) ?? 'domain',
    limitations: text(raw.limitations, 2000) ?? '',
    blogs,
  };
}

/** Every month any blog has a figure for, oldest first. */
export function trafficMonths(blogs: TrafficBlog[]): string[] {
  return [...new Set(blogs.flatMap((blog) => blog.traffic?.monthly.map((p) => p.month) ?? []))].sort();
}
export const visitsAt = (blog: TrafficBlog, month: string) => blog.traffic?.monthly.find((p) => p.month === month)?.visits ?? null;
export const latestPoint = (blog: TrafficBlog) => blog.traffic?.monthly.at(-1) ?? null;
export function previousMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(4));
  return m === 1 ? `${year - 1}12` : `${year}${String(m - 1).padStart(2, '0')}`;
}

/** `count` consecutive calendar months ending at `month`, oldest first; a month without data stays in as a gap. */
export function monthsEnding(month: string, count: number): string[] {
  if (!/^\d{6}$/.test(month)) return [];
  const out = [month];
  while (out.length < count) out.unshift(previousMonth(out[0]));
  return out;
}

/** Change against the blog's own figure for the calendar month before; null when either is missing or the base is 0. */
export function monthChange(blog: TrafficBlog, month: string): number | null {
  const now = visitsAt(blog, month);
  const then = visitsAt(blog, previousMonth(month));
  return now !== null && then ? (now - then) / then : null;
}

export type TrafficSort = 'visits' | 'change' | 'global' | 'country' | 'category' | 'status' | 'fetched' | 'name';
export const trafficSorts: TrafficSort[] = ['visits', 'change', 'global', 'country', 'category', 'status', 'fetched', 'name'];
/** Sorts that read best smallest-first on the first click. */
export const ascendingFirst = new Set<TrafficSort>(['global', 'country', 'name', 'category', 'status']);
const stateOrder: Record<TrafficState, number> = { ready: 0, stale: 1, pending: 2, blocked: 3, 'no-data': 4, unavailable: 5 };

export function sortValue(blog: TrafficBlog, sort: TrafficSort, month: string): number | string | null {
  switch (sort) {
    case 'visits':
      return visitsAt(blog, month);
    case 'change':
      return monthChange(blog, month);
    case 'global':
      return blog.traffic?.globalRank ?? null;
    case 'country':
      return blog.traffic?.countryRank?.rank ?? null;
    case 'category':
      return blog.traffic?.category ?? null;
    case 'status':
      return stateOrder[stateOf(blog)];
    case 'fetched':
      return blog.fetchedAt ? Date.parse(blog.fetchedAt) : null;
    default:
      return blog.name;
  }
}

/** Filters by name/domain and state, then sorts; missing values always stay last in either direction. */
export function selectTraffic(
  blogs: TrafficBlog[],
  options: { query?: string; state?: TrafficState | ''; sort: TrafficSort; ascending: boolean; month: string },
): TrafficBlog[] {
  const needle = (options.query ?? '').trim().toLocaleLowerCase();
  return blogs
    .filter((blog) => !needle || `${blog.name} ${blog.domain} ${blog.slug}`.toLocaleLowerCase().includes(needle))
    .filter((blog) => !options.state || stateOf(blog) === options.state)
    .sort((a, b) => {
      const x = sortValue(a, options.sort, options.month);
      const y = sortValue(b, options.sort, options.month);
      if (x === null || y === null) return x === null && y === null ? a.name.localeCompare(b.name, 'zh-Hant') : x === null ? 1 : -1;
      const order = typeof x === 'string' ? x.localeCompare(y as string, 'zh-Hant') : x - (y as number);
      return (options.ascending ? order : -order) || a.name.localeCompare(b.name, 'zh-Hant');
    });
}

export const PAGE_SIZE = 50;
export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, pages };
}

/** Blogs worth drawing in the trend chart: at least two real monthly figures. */
export const chartable = (blog: TrafficBlog) => (blog.traffic?.monthly.length ?? 0) >= 2;
/** Most compared at once; one shared chart instance draws them all. */
export const COMPARE_LIMIT = 6;
/** Default comparison: the largest latest-month figures among chartable blogs. */
export function defaultCompare(blogs: TrafficBlog[], limit = 3): string[] {
  return blogs
    .filter(chartable)
    .toSorted((a, b) => (latestPoint(b)?.visits ?? 0) - (latestPoint(a)?.visits ?? 0))
    .slice(0, limit)
    .map((blog) => blog.slug);
}

export const shortMonth = (month: string) => `${month.slice(0, 4)}/${month.slice(4)}`;
export const monthLabel = (month: string) => `${month.slice(0, 4)} 年 ${Number(month.slice(4))} 月`;
export const trafficNumber = (value: number | null) => (value === null ? '—' : Math.round(value).toLocaleString('zh-TW'));
export const trafficGrowth = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${(value * 100).toLocaleString('zh-TW', { maximumFractionDigits: 1 })}%`;
export const percent = (share: number) => `${(share * 100).toLocaleString('zh-TW', { maximumFractionDigits: 1 })}%`;
export const rankText = (value: number | null | undefined) => (value ? `第 ${value.toLocaleString('zh-TW')} 名` : '—');
export const dateText = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'numeric', day: 'numeric' })
    : null;

let regions: Intl.DisplayNames | null | undefined;
export function countryName(code: string): string {
  if (code === 'TW') return '台灣';
  if (regions === undefined) {
    try {
      regions = new Intl.DisplayNames(['zh-TW'], { type: 'region' });
    } catch {
      regions = null;
    }
  }
  try {
    return regions?.of(code) ?? code;
  } catch {
    return code;
  }
}
const categories: Record<string, string> = {
  news_and_media: '新聞與媒體',
  arts_and_entertainment: '藝術與娛樂',
  computers_electronics_and_technology: '電腦與科技',
  lifestyle: '生活風格',
  travel_and_tourism: '旅遊',
  food_and_drink: '飲食',
  hobbies_and_leisure: '嗜好與休閒',
  science_and_education: '科學與教育',
};
/** Similarweb category ids; unknown ones print with spaces instead of underscores. */
export function categoryName(category: string): string {
  const [head, ...rest] = category.split('/');
  const known = categories[head.toLowerCase()];
  if (known) return rest.length ? `${known} / ${rest.join(' / ').replace(/_/g, ' ')}` : known;
  return category.replace(/_/g, ' ').replace(/\//g, ' / ');
}
