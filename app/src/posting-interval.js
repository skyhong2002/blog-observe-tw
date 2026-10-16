/** Median hours between consecutive posts (newest first), from at least 3 posts; null when too few to say. */
export function postingIntervalHours(dates) {
  const times = dates.map((d) => new Date(d).getTime()).filter(Number.isFinite);
  if (times.length < 3) return null;
  const gaps = times
    .slice(1)
    .map((t, i) => (times[i] - t) / 3_600_000)
    .sort((a, b) => a - b);
  const middle = gaps.length >> 1;
  const median = gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
  return Math.max(1, Math.round(median));
}
/** The worker's RSS round (worker.ts blogs-feed): BLOG_CRAWL_INTERVAL_MS, default 6 hours, at least 30 minutes. */
export const crawlIntervalHours = () => Math.max(30 * 60_000, Number(process.env.BLOG_CRAWL_INTERVAL_MS || 6 * 60 * 60_000)) / 3_600_000;
