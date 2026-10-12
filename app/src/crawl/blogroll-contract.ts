import type { FeedCrawlerOptions } from './feed.ts';

export type BlogrollLink = { url: string; text: string; follow: boolean };
export type DiscoveryPage = {
  url: string;
  parserVersion: number;
  kind: 'directory' | 'blogroll' | 'party';
  finalUrl: string;
  etag: string | null;
  lastModified: string | null;
  bodySha256: string;
  links: BlogrollLink[];
  fetchedAt: string;
};
export type BlogrollObservation = {
  rootUrl: string;
  sourceUrl: string;
  targetUrl: string;
  anchorText: string;
  relation: 'directory' | 'blogroll' | 'party';
  path: string[];
  bodySha256: string;
  observedAt: string;
};
export interface BlogrollStore {
  /** Cross-process lease, released in finally. No second worker may crawl concurrently. */
  acquire(): Promise<boolean>;
  release(): Promise<void>;
  /** Production SQL stores verify the lock-owning session before further crawling. */
  assertLease?(): Promise<void>;
  getPage(url: string): Promise<DiscoveryPage | null>;
  savePage(page: DiscoveryPage): Promise<void>;
  /** Persist each URL relationship even if target already exists; never change review status. */
  observe(observation: BlogrollObservation): Promise<{ inserted: boolean }>;
}
export type BlogrollOptions = FeedCrawlerOptions & {
  maxPages?: number;
  maxLinksPerPage?: number;
  maxObservations?: number;
  roots?: Array<{ url: string; kind: 'directory' | 'party' }>;
  now?: () => Date;
};
