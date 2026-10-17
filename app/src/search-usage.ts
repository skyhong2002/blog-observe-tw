/** Daily counts that show whether the historical body index earns its cost: how often
 * the site's search runs and how often only article bodies matched. Never stores query
 * text, results, addresses or user agents. Counts collect in memory and are added to
 * search_usage_daily once a minute and when the gateway closes.
 */
import type { Pool } from 'mysql2/promise';

export const SEARCH_USAGE_FLUSH_MS = 60_000;
export const SEARCH_USAGE_COLUMNS = [
  'site_searches',
  'site_later_pages',
  'with_results',
  'body_matches',
  'body_only',
  'site_failures',
  'api_requests',
] as const;
type Column = (typeof SEARCH_USAGE_COLUMNS)[number];
// Columns in SEARCH_USAGE_COLUMNS order (search-usage.spec.ts checks it).
const UPSERT_SQL = `SET STATEMENT max_statement_time=1 FOR INSERT INTO search_usage_daily
  (day,site_searches,site_later_pages,with_results,body_matches,body_only,site_failures,api_requests,updated_at)
  VALUES(?,?,?,?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE site_searches=site_searches+VALUES(site_searches),
  site_later_pages=site_later_pages+VALUES(site_later_pages),with_results=with_results+VALUES(with_results),
  body_matches=body_matches+VALUES(body_matches),body_only=body_only+VALUES(body_only),
  site_failures=site_failures+VALUES(site_failures),api_requests=api_requests+VALUES(api_requests),updated_at=VALUES(updated_at)`;
export type SearchUsageCounts = Partial<Record<Column, number>>;

/** One answered request. `matched` is every validated match across all pages, and how many matched only in a body. */
export type SearchOutcome = { site: boolean; page: number; matched: { total: number; body: number } | null };

/** Taiwan calendar day (UTC+8, no daylight saving), YYYY-MM-DD. */
export const searchUsageDay = (now: Date) => new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10);

/** Browsers mark fetches from our own pages same-origin; anything else counts as an API request. */
export const fromSitePage = (headers: Record<string, unknown>) => headers['sec-fetch-site'] === 'same-origin';

export function tallySearch({ site, page, matched }: SearchOutcome): SearchUsageCounts {
  if (!site) return { api_requests: 1 };
  if (!matched) return { site_failures: 1 };
  if (page > 1) return { site_later_pages: 1 };
  const counts: SearchUsageCounts = { site_searches: 1 };
  if (matched.total > 0) counts.with_results = 1;
  if (matched.body > 0) counts.body_matches = 1;
  if (matched.total > 0 && matched.body === matched.total) counts.body_only = 1;
  return counts;
}

export function createSearchUsage(pool: Pool, options: { flushMs?: number; now?: () => Date; onError?: (error: unknown) => void } = {}) {
  const now = options.now ?? (() => new Date());
  let pending = new Map<string, SearchUsageCounts>();
  const add = (into: Map<string, SearchUsageCounts>, day: string, counts: SearchUsageCounts) => {
    const row = into.get(day) ?? {};
    for (const [column, value] of Object.entries(counts) as [Column, number][]) row[column] = (row[column] ?? 0) + value;
    into.set(day, row);
  };
  let flushing: Promise<void> | null = null;
  const flush = () =>
    (flushing ??= (async () => {
      const batch = pending;
      pending = new Map();
      for (const [day, counts] of batch) {
        const values = SEARCH_USAGE_COLUMNS.map((column) => counts[column] ?? 0);
        try {
          await pool.query(UPSERT_SQL, [day, ...values]);
        } catch (error) {
          // Kept for the next flush; counts are small and a dropped minute would bias a slow-DB day.
          add(pending, day, counts);
          options.onError?.(error);
        }
      }
    })().finally(() => {
      flushing = null;
    }));
  const timer = setInterval(flush, options.flushMs ?? SEARCH_USAGE_FLUSH_MS);
  timer.unref();
  return {
    record: (outcome: SearchOutcome) => add(pending, searchUsageDay(now()), tallySearch(outcome)),
    flush,
    async close() {
      clearInterval(timer);
      await flushing;
      await flush();
    },
  };
}
export type SearchUsage = ReturnType<typeof createSearchUsage>;
