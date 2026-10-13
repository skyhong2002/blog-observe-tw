import { bigint, char, datetime, double, index, int, json, longtext, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';

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
    importPageIndex: int('import_page_index'),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.id] }),
    index('topic_terms_label').on(t.snapshotId, t.normalizedLabel),
    index('topic_terms_import_page').on(t.snapshotId, t.importPageIndex, t.id),
  ],
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
  coverageSince: varchar('coverage_since', { length: 30 }),
  parentRunId: char('parent_run_id', { length: 36 }),
  syncStrategy: varchar('sync_strategy', { length: 32 }).notNull().default('full-window'),
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
    publishedAt: datetime('published_at'),
    payload: json('payload').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.articleId] }), index('topic_window_articles_time').on(t.runId, t.publishedAt)],
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
    articleCount: int('article_count').notNull().default(0),
    lastPublishedAt: datetime('last_published_at'),
    winnerId: char('winner_id', { length: 64 }),
    winnerCount: int('winner_count').notNull().default(0),
    inactiveReason: varchar('inactive_reason', { length: 64 }),
    policyVersion: varchar('policy_version', { length: 128 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.id] }),
    index('topic_canonical_label').on(t.snapshotId, t.normalizedLabel),
    index('topic_canonical_activity').on(t.snapshotId, t.articleCount, t.id),
  ],
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
    needsRefresh: int('needs_refresh').notNull().default(0),
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

/** Download checkpoints retain the immutable upstream version; never replace last-good on partial import. */
export const topicSnapshotRuns = mysqlTable(
  'topic_snapshot_runs',
  {
    snapshotId: char('snapshot_id', { length: 36 }).primaryKey(),
    payloadMode: varchar('payload_mode', { length: 24 }).notNull().default('legacy-dual'),
    receiptBytes: bigint('receipt_bytes', { mode: 'number' }).notNull().default(0),
    checksumCheckpoint: json('checksum_checkpoint'),
    checkpointLastLabel: varchar('checkpoint_last_label', { length: 255 }),
    validationNextPage: int('validation_next_page').notNull().default(0),
    validatedTerms: int('validated_terms').notNull().default(0),
    validatedBytes: bigint('validated_bytes', { mode: 'number' }).notNull().default(0),
    manifest: json('manifest').notNull(),
    nextPage: int('next_page').notNull().default(0),
    stagedTerms: int('staged_terms').notNull().default(0),
    stagedBytes: bigint('staged_bytes', { mode: 'number' }).notNull().default(0),
    lastLabel: varchar('last_label', { length: 255 }),
    status: varchar('status', { length: 24 }).notNull().default('scanning'),
    nextAttemptAt: datetime('next_attempt_at'),
    errorCode: varchar('error_code', { length: 64 }),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [index('topic_snapshot_runs_status').on(t.status, t.updatedAt)],
);

export const topicSnapshotPages = mysqlTable(
  'topic_snapshot_pages',
  {
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    pageIndex: int('page_index').notNull(),
    // Legacy: exact JSON.stringify(entries). single-copy-v1: bounded hashed receipt metadata; run mode prevents reinterpretation.
    entriesJson: longtext('entries_json').notNull(),
    sha256: char('sha256', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.pageIndex] })],
);

export const topicPolicySelections = mysqlTable('topic_policy_selections', {
  snapshotId: char('snapshot_id', { length: 36 }).primaryKey(),
  policyVersion: varchar('policy_version', { length: 128 }).notNull(),
  selectionId: char('selection_id', { length: 64 }),
  status: varchar('status', { length: 24 }).notNull().default('building'),
  cursor: char('cursor', { length: 64 }),
  asOf: datetime('as_of').notNull(),
  totalTerms: int('total_terms').notNull().default(0),
  eligibleTerms: int('eligible_terms').notNull().default(0),
  activeTerms: int('active_terms').notNull().default(0),
  codePoints: int('code_points').notNull().default(0),
  estimatedBytes: int('estimated_bytes').notNull().default(0),
  config: json('config').notNull(),
});

/** Precomputed observed document frequency; raw body matches are retained even for title-only ranking. */
export const topicFrequencyRuns = mysqlTable('topic_frequency_runs', {
  snapshotId: char('snapshot_id', { length: 36 }).primaryKey(),
  baselineFrom: datetime('baseline_from').notNull(),
  baselineUntil: datetime('baseline_until').notNull(),
  totalPosts: int('total_posts').notNull(),
  coveredPosts: int('covered_posts').notNull(),
  thresholdRatio: double('threshold_ratio').notNull(),
  policyVersion: varchar('policy_version', { length: 128 }).notNull(),
  updatedAt: datetime('updated_at').notNull(),
});
export const topicTermFrequencies = mysqlTable(
  'topic_term_frequencies',
  {
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    termId: char('term_id', { length: 64 }).notNull(),
    matchedPosts: int('matched_posts').notNull(),
    titlePosts: int('title_posts').notNull(),
    highFrequency: int('high_frequency').notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.termId] })],
);

/** Shadow tables preserve the deployed v2 index throughout warmup and rollback; generations are immutable outside their own matching progress. */
export const topicCanonicalTermsV3 = mysqlTable(
  'topic_canonical_terms_v3',
  {
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    id: char('id', { length: 64 }).notNull(),
    normalizedLabel: varchar('normalized_label', { length: 255 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    exclusionReason: varchar('exclusion_reason', { length: 64 }),
    occurrences: int('occurrences').notNull().default(0),
    articleCount: int('article_count').notNull().default(0),
    lastPublishedAt: datetime('last_published_at'),
    winnerId: char('winner_id', { length: 64 }),
    winnerCount: int('winner_count').notNull().default(0),
    inactiveReason: varchar('inactive_reason', { length: 64 }),
    policyVersion: varchar('policy_version', { length: 128 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.snapshotId, t.id] }),
    index('topic_canonical_label').on(t.snapshotId, t.normalizedLabel),
    index('topic_canonical_activity').on(t.snapshotId, t.articleCount, t.id),
  ],
);
export const topicTermAliasesV3 = mysqlTable(
  'topic_term_aliases_v3',
  {
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    termId: char('term_id', { length: 64 }).notNull(),
    canonicalId: char('canonical_id', { length: 64 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.termId] }), index('topic_alias_canonical').on(t.snapshotId, t.canonicalId)],
);
export const topicPostIndexesV3 = mysqlTable(
  'topic_post_indexes_v3',
  {
    postId: int('post_id').notNull(),
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    inputHash: char('input_hash', { length: 64 }).notNull(),
    postHash: char('post_hash', { length: 64 }),
    bodyHash: char('body_hash', { length: 64 }),
    matchedAt: datetime('matched_at').notNull(),
    status: varchar('status', { length: 16 }).notNull().default('ok'),
    matcherVersion: varchar('matcher_version', { length: 128 }).notNull(),
    needsRefresh: int('needs_refresh').notNull().default(0),
    cleanupVersion: varchar('cleanup_version', { length: 64 }).notNull(),
    bodyKind: varchar('body_kind', { length: 16 }).notNull(),
    bodyObtainedAt: datetime('body_obtained_at'),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.postId] }), index('topic_indexes_v3_version').on(t.snapshotId, t.matcherVersion)],
);
export const topicMatchesV3 = mysqlTable(
  'topic_matches_v3',
  {
    postId: int('post_id').notNull(),
    termId: char('term_id', { length: 64 }).notNull(),
    snapshotId: char('snapshot_id', { length: 36 }).notNull(),
    source: varchar('source', { length: 16 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.postId, t.termId, t.source] }), index('topic_matches_v2_term').on(t.snapshotId, t.termId)],
);

export const topicStagedScanRuns = mysqlTable(
  'topic_staged_scan_runs',
  {
    runId: char('run_id', { length: 36 }).primaryKey(),
    targetSnapshotId: char('target_snapshot_id', { length: 36 }).notNull(),
    status: varchar('status', { length: 24 }).notNull(),
    stateJson: json('state_json').notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [index('topic_staged_scan_target').on(t.targetSnapshotId, t.status)],
);
export const topicStagedScanOwner = mysqlTable('topic_staged_scan_owner', {
  source: varchar('source', { length: 128 }).primaryKey(),
  runId: char('run_id', { length: 36 }),
});
