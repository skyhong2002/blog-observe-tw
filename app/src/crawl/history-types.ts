import type { BlogToCrawl, FeedCrawlerOptions, FeedEntry, FeedSourceType } from './feed.ts';

export type HistoryKind = 'home' | 'feed' | 'sitemap' | 'wordpress' | 'article' | 'entry';
export type StoredEntry = Omit<FeedEntry, 'publishedAt' | 'updatedAt'> & { publishedAt: string | null; updatedAt: string | null };
export type HistoryTaskInput = {
  url: string;
  kind: HistoryKind;
  sourceUrl: string;
  sourceType: FeedSourceType;
  depth: number;
  payload?: { optional?: boolean; entry?: StoredEntry; lastmod?: string | null; paginated?: boolean; lineage?: string[] };
};
export type HistoryTask = HistoryTaskInput & { id: string; blogId: number; status: string; attempts?: number; lastError?: string | null };
export type HistoryStatus = 'partial' | 'blocked' | 'limited' | 'complete' | 'exhausted';
export type HistoryRun = {
  blogId: number;
  status: HistoryStatus;
  pagesFetched: number;
  articlesWritten: number;
  tasksTotal: number;
  tasksDone: number;
  archiveSeen: boolean;
  warnings: string[];
  nextAttemptAt: string | null;
  lastError: string | null;
};
export type HistoryCaps = { maxTotalPages: number; maxTotalArticles: number; maxTasks: number };
export type HistoryPageResult = {
  tasks: HistoryTaskInput[];
  entries: FeedEntry[];
  fetched: boolean;
  fingerprint?: string;
  archiveSeen?: boolean;
  warnings?: string[];
};
export interface HistoryStore {
  acquire(): Promise<boolean>;
  assertLease(): Promise<void>;
  release(): Promise<void>;
  initialize(blog: BlogToCrawl, caps: HistoryCaps, now: Date): Promise<HistoryRun>;
  nextTask(blogId: number, allowed: HistoryKind[]): Promise<HistoryTask | null>;
  commitTask(
    blog: BlogToCrawl,
    task: HistoryTask,
    result: HistoryPageResult,
    caps: HistoryCaps,
    now: Date,
  ): Promise<{ written: number; queued: number }>;
  failTask(blog: BlogToCrawl, task: HistoryTask, reason: string, now: Date): Promise<boolean>;
  defer(blogId: number, reason: string, until: Date | null, status: 'blocked' | 'limited', now: Date): Promise<void>;
  finish(blogId: number, now: Date): Promise<HistoryRun>;
}
export type HistoryOptions = FeedCrawlerOptions &
  Partial<HistoryCaps> & {
    maxPages?: number;
    maxArticles?: number;
    maxDurationMs?: number;
    now?: () => Date;
  };
