import { char, datetime, index, int, json, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';

/** No cascading FKs: explicit tombstones must survive deleted posts/snapshots. */
export const topicPages = mysqlTable(
  'topic_pages',
  {
    canonicalId: char('canonical_id', { length: 64 }).primaryKey(),
    label: varchar('label', { length: 255 }).notNull(),
    normalizedLabel: varchar('normalized_label', { length: 255 }).notNull(),
    state: varchar('state', { length: 16 }).notNull().default('pending'),
    mergedInto: char('merged_into', { length: 64 }),
    reason: varchar('reason', { length: 100 }),
    firstSnapshotId: char('first_snapshot_id', { length: 36 }).notNull(),
    lastSnapshotId: char('last_snapshot_id', { length: 36 }).notNull(),
    firstObservedAt: datetime('first_observed_at').notNull(),
    lastObservedAt: datetime('last_observed_at').notNull(),
    lastArticleAt: datetime('last_article_at'),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [index('topic_pages_state').on(t.state, t.canonicalId)],
);

export const topicArticleEvidence = mysqlTable(
  'topic_article_evidence',
  {
    canonicalId: char('canonical_id', { length: 64 }).notNull(),
    postId: int('post_id').notNull(),
    source: varchar('source', { length: 16 }).notNull(),
    state: varchar('state', { length: 16 }).notNull().default('pending'),
    reason: varchar('reason', { length: 100 }),
    sourceSnapshotId: char('source_snapshot_id', { length: 36 }).notNull(),
    postHash: char('post_hash', { length: 64 }),
    bodyHash: char('body_hash', { length: 64 }),
    matcherVersion: varchar('matcher_version', { length: 100 }).notNull(),
    firstObservedAt: datetime('first_observed_at').notNull(),
    lastObservedAt: datetime('last_observed_at').notNull(),
    checkedAt: datetime('checked_at').notNull(),
    publishedAt: datetime('published_at'),
  },
  (t) => [
    primaryKey({ columns: [t.canonicalId, t.postId, t.source] }),
    index('topic_history_post').on(t.postId, t.canonicalId),
    index('topic_history_work').on(t.state, t.checkedAt, t.postId),
    index('topic_history_page').on(t.canonicalId, t.state, t.lastObservedAt, t.postId),
  ],
);

export const topicHistoryBackfillRuns = mysqlTable('topic_history_backfill_runs', {
  id: varchar('id', { length: 100 }).primaryKey(),
  status: varchar('status', { length: 24 }).notNull(),
  cursor: json('cursor'),
  processed: int('processed').notNull().default(0),
  updatedAt: datetime('updated_at').notNull(),
});
