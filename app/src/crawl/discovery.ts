import type { Pool } from 'mysql2/promise';
import { discoverBlogrolls } from './blogroll.ts';
import type { BlogrollOptions } from './blogroll-contract.ts';
import { createBlogrollStore } from './blogroll-store.ts';
import { type SyncOptions, syncSimilarweb } from './similarweb-sync.ts';

export async function discoverBlogblog(pool: Pool, userAgent?: string, options: BlogrollOptions = {}) {
  return discoverBlogrolls(createBlogrollStore(pool), { userAgent, ...options });
}

export async function discoverSimilar(pool: Pool, domains: string[], options: SyncOptions = {}) {
  return syncSimilarweb(pool, domains, options);
}
