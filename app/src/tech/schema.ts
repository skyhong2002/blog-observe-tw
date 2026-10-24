import { datetime, index, int, json, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import type { TechCoverage, TechDetection } from './contracts.ts';

/** Legacy read-only schema retained for rollback; public technology data now comes from traffic. */
export const blogTechScans = mysqlTable(
  'blog_tech_scans',
  {
    blogId: int('blog_id').primaryKey(),
    status: varchar('status', { length: 16 }).notNull(),
    detections: json('detections').$type<TechDetection[]>().notNull(),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceType: varchar('source_type', { length: 24 }),
    sourcePostId: int('source_post_id'),
    coverage: json('coverage').$type<TechCoverage>(),
    ruleVersion: varchar('rule_version', { length: 64 }).notNull(),
    observedAt: datetime('observed_at', { mode: 'date', fsp: 3 }),
    lastAttemptAt: datetime('last_attempt_at', { mode: 'date', fsp: 3 }).notNull(),
    lastAttemptSourceUrl: varchar('last_attempt_source_url', { length: 1024 }),
    lastAttemptSourcePostId: int('last_attempt_source_post_id'),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    createdAt: datetime('created_at', { mode: 'date', fsp: 3 }).notNull(),
    updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
  },
  (t) => [index('blog_tech_attempt').on(t.lastAttemptAt), index('blog_tech_source_post').on(t.sourcePostId)],
);
