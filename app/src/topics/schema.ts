import { char, datetime, index, int, json, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';

export const topicSnapshots = mysqlTable('topic_snapshots', {
  id: char('id', { length: 36 }).primaryKey(),
  manifest: json('manifest').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('staging'),
  generatedAt: datetime('generated_at').notNull(),
  syncedAt: datetime('synced_at'),
});
export const topicCurrent = mysqlTable('topic_current', {
  source: varchar('source', { length: 100 }).primaryKey(),
  snapshotId: char('snapshot_id', { length: 36 }).notNull(),
});
export const topicTerms = mysqlTable(
  'topic_terms',
  {
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    id: char('id', { length: 64 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    normalizedLabel: varchar('normalized_label', { length: 255 }).notNull(),
    payload: json('payload').notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.id] }), index('topic_terms_label').on(t.snapshotId, t.normalizedLabel)],
);
export const topicPostIndexes = mysqlTable(
  'topic_post_indexes',
  {
    postId: int('post_id').primaryKey(),
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    inputHash: char('input_hash', { length: 64 }).notNull(),
    postHash: char('post_hash', { length: 64 }),
    bodyHash: char('body_hash', { length: 64 }),
    matchedAt: datetime('matched_at').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('ok'),
  },
  (t) => [index('topic_indexes_version').on(t.snapshotId)],
);
export const topicMatches = mysqlTable(
  'topic_matches',
  {
    postId: int('post_id').notNull(),
    termId: char('term_id', { length: 64 }).notNull(),
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    source: varchar('source', { length: 16 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.termId, t.source] }), index('topic_matches_term').on(t.snapshotId, t.termId)],
);
export const topicWindowRuns = mysqlTable('topic_window_runs', {
  id: char('id', { length: 36 }).primaryKey(),
  since: varchar('since_at', { length: 30 }).notNull(),
  until: varchar('until_at', { length: 30 }).notNull(),
  cursor: varchar('cursor', { length: 64 }),
  nextAttemptAt: datetime('next_attempt_at'),
  pages: int('pages').notNull().default(0),
  status: varchar('status', { length: 16 }).notNull().default('scanning'),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});
export const topicWindowArticles = mysqlTable(
  'topic_window_articles',
  {
    runId: char('run_id', { length: 36 }).notNull(),
    articleId: varchar('article_id', { length: 24 }).notNull(),
    payload: json('payload').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.articleId] })],
);

/** Derived matching policy; raw upstream terms and the legacy index remain intact for rollback. */
export const topicCanonicalTerms = mysqlTable(
  'topic_canonical_terms',
  {
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    id: char('id', { length: 64 }).notNull(),
    normalizedLabel: varchar('normalized_label', { length: 255 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    exclusionReason: varchar('exclusion_reason', { length: 64 }),
    occurrences: int('occurrences').notNull().default(0),
    policyVersion: varchar('policy_version', { length: 128 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.id] }), index('topic_canonical_label').on(t.snapshotId, t.normalizedLabel)],
);
export const topicTermAliases = mysqlTable(
  'topic_term_aliases',
  {
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    termId: char('term_id', { length: 64 }).notNull(),
    canonicalId: char('canonical_id', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.termId] }), index('topic_alias_canonical').on(t.snapshotId, t.canonicalId)],
);
export const topicPostIndexesV2 = mysqlTable(
  'topic_post_indexes_v2',
  {
    postId: int('post_id').primaryKey(),
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    inputHash: char('input_hash', { length: 64 }).notNull(),
    postHash: char('post_hash', { length: 64 }),
    bodyHash: char('body_hash', { length: 64 }),
    matchedAt: datetime('matched_at').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('ok'),
    matcherVersion: varchar('matcher_version', { length: 128 }).notNull(),
    cleanupVersion: varchar('cleanup_version', { length: 64 }).notNull(),
    bodyKind: varchar('body_kind', { length: 16 }).notNull(),
    bodyObtainedAt: datetime('body_obtained_at'),
  },
  (t) => [index('topic_indexes_v2_version').on(t.snapshotId, t.matcherVersion)],
);
export const topicMatchesV2 = mysqlTable(
  'topic_matches_v2',
  {
    postId: int('post_id').notNull(),
    termId: char('term_id', { length: 64 }).notNull(),
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    source: varchar('source', { length: 16 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.termId, t.source] }), index('topic_matches_v2_term').on(t.snapshotId, t.termId)],
);
