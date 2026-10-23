import { boolean, char, datetime, index, int, json, mysqlTable, primaryKey, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

/** Derived observations; additive and safe for an older release to ignore. */
export const relationObservations = mysqlTable(
  'relation_observations',
  {
    postId: int('post_id').primaryKey(),
    blogId: int('blog_id').notNull(),
    bodyText: text('body_text'),
    contentHash: char('content_hash', { length: 64 }),
    status: varchar('status', { length: 32 }).notNull(),
    parserVersion: varchar('parser_version', { length: 32 }).notNull(),
    extraction: varchar('extraction', { length: 64 }),
    finalUrl: varchar('final_url', { length: 1024 }),
    etag: varchar('etag', { length: 512 }),
    lastModified: varchar('last_modified', { length: 255 }),
    observedAt: datetime('observed_at').notNull(),
    lastSuccessAt: datetime('last_success_at'),
    nextAttemptAt: datetime('next_attempt_at').notNull(),
    publishedAt: datetime('published_at'),
    truncated: boolean('truncated').notNull().default(false),
    externalLinks: int('external_links').notNull().default(0),
    errorCode: varchar('error_code', { length: 64 }),
  },
  (t) => [
    index('relation_observations_due').on(t.nextAttemptAt),
    index('relation_observations_blog').on(t.blogId),
    // Body freshness reads only status/hash (topicBodyHash), index-only.
    index('relation_observations_hash').on(t.postId, t.blogId, t.status, t.contentHash),
  ],
);

export const relationLinks = mysqlTable(
  'relation_links',
  {
    sourcePostId: int('source_post_id').notNull(),
    sourceBlogId: int('source_blog_id').notNull(),
    ordinal: int('ordinal').notNull(),
    targetUrl: varchar('target_url', { length: 1024 }).notNull(),
    targetBlogId: int('target_blog_id'),
    targetReason: varchar('target_reason', { length: 64 }),
    targetPostId: int('target_post_id'),
    anchorText: varchar('anchor_text', { length: 255 }).notNull(),
    context: varchar('context', { length: 320 }).notNull(),
    location: varchar('location', { length: 16 }).notNull(),
    observedAt: datetime('observed_at').notNull(),
    resolutionCheckedAt: datetime('resolution_checked_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sourcePostId, t.ordinal] }),
    index('relation_links_target').on(t.targetBlogId),
    index('relation_links_source').on(t.sourceBlogId, t.location),
    index('relation_links_unresolved').on(t.targetBlogId, t.sourcePostId),
    index('relation_links_resolution_due').on(t.resolutionCheckedAt, t.sourcePostId),
  ],
);

/** Admission depth is immutable. Existing approved publications are baseline zero. */
export const relationPublications = mysqlTable('relation_publications', {
  blogId: int('blog_id').primaryKey(),
  depth: int('depth').notNull(),
  sourceCandidateId: int('source_candidate_id'),
  admittedAt: datetime('admitted_at').notNull(),
});

/** Unique publication identity avoids repeatedly spending the daily candidate budget. */
export const relationCandidateIdentities = mysqlTable(
  'relation_candidate_identities',
  {
    identityHash: char('identity_hash', { length: 64 }).primaryKey(),
    url: varchar('url', { length: 1024 }).notNull(),
    candidateId: int('candidate_id').notNull(),
    firstObservedAt: datetime('first_observed_at').notNull(),
  },
  (t) => [uniqueIndex('relation_candidate_identity_candidate').on(t.candidateId)],
);

/** Per-publication scan cursor; no article is invented for homepage/blogroll evidence. */
export const relationHomeScans = mysqlTable(
  'relation_home_scans',
  {
    blogId: int('blog_id').primaryKey(),
    status: varchar('status', { length: 32 }).notNull(),
    observedAt: datetime('observed_at').notNull(),
    lastSuccessAt: datetime('last_success_at'),
    nextAttemptAt: datetime('next_attempt_at').notNull(),
    etag: varchar('etag', { length: 512 }),
    lastModified: varchar('last_modified', { length: 255 }),
    childUrl: varchar('child_url', { length: 1024 }),
    errorCode: varchar('error_code', { length: 64 }),
    truncated: boolean('truncated').notNull().default(false),
  },
  (t) => [index('relation_home_scans_due').on(t.nextAttemptAt)],
);
export const relationHomeLinks = mysqlTable(
  'relation_home_links',
  {
    blogId: int('blog_id').notNull(),
    sourcePageHash: char('source_page_hash', { length: 64 }).notNull(),
    ordinal: int('ordinal').notNull(),
    sourcePageUrl: varchar('source_page_url', { length: 1024 }).notNull(),
    targetUrl: varchar('target_url', { length: 1024 }).notNull(),
    targetBlogId: int('target_blog_id'),
    targetReason: varchar('target_reason', { length: 64 }),
    anchorText: varchar('anchor_text', { length: 255 }).notNull(),
    bodySha256: char('body_sha256', { length: 64 }).notNull(),
    path: json('path').$type<string[]>().notNull(),
    observedAt: datetime('observed_at').notNull(),
    resolutionCheckedAt: datetime('resolution_checked_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.blogId, t.sourcePageHash, t.ordinal] }),
    index('relation_home_links_target').on(t.targetBlogId),
    index('relation_home_links_resolution').on(t.resolutionCheckedAt),
  ],
);

/** Shared generation prevents an in-flight rebuild reviving an admin-hidden edge. */
export const relationProjectionState = mysqlTable('relation_projection_state', {
  id: int('id').primaryKey(),
  revision: int('revision').notNull().default(0),
});
export const relationSnapshots = mysqlTable('relation_snapshots', {
  days: int('days').primaryKey(),
  revision: int('revision').notNull(),
  payload: json('payload').notNull(),
  generatedAt: datetime('generated_at').notNull(),
});
