import type { FeedCrawlerOptions } from '../crawl/feed.ts';
export type BatchOptions = FeedCrawlerOptions & {
  limit?: number;
  maxDurationMs?: number;
  now?: () => Date;
  signal?: AbortSignal;
};
export type BatchResult = {
  processed: number;
  skipped: number;
  truncated: boolean;
  /** Reservations already charged when a batch stops; never automatically refunded. */
  reservedUnused: number;
};
