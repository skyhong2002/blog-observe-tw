import { boolean, char, datetime, index, int, json, mysqlTable, primaryKey, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

/**
 * The database is deliberately owned by blog-observe.  These tables mirror
 * the schema created by the legacy `db/001_init.sql`; changing a column here
 * requires a new, explicit migration and a production compatibility check.
 */

export type SeedValues = Record<string, unknown>;
export type DiscoveryEvidence = Record<string, unknown>;
export type ProvenanceEvidence = Record<string, unknown>;
export type ProvenanceSource = 'crawler' | 'community' | 'manual' | 'author' | 'reader' | 'admin' | 'system';

export const blogs = mysqlTable(
  'blogs',
  {
    id: int('id').autoincrement().primaryKey(),
    slug: varchar('slug', { length: 180 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    url: varchar('url', { length: 1024 }),
    canonicalHost: varchar('canonical_host', { length: 255 }),
    category: varchar('category', { length: 255 }).notNull().default('待分類'),
    description: text('description'),
    status: varchar('status', { length: 32 }).notNull().default('seed'),
    statusLabel: varchar('status_label', { length: 64 }).notNull().default('待核對'),
    sourceSha256: char('source_sha256', { length: 64 }),
    sourceRow: int('source_row'),
    sourceName: varchar('source_name', { length: 255 }),
    sourceCategory: varchar('source_category', { length: 255 }),
    sourceValues: json('source_values').$type<SeedValues>(),
    discoveredAt: datetime('discovered_at').notNull(),
    lastCrawledAt: datetime('last_crawled_at'),
    lastCrawlSuccessAt: datetime('last_crawl_success_at'),
    lastPublishedAt: datetime('last_published_at'),
    historyImportedAt: datetime('history_imported_at'),
    stalePolicy: varchar('stale_policy', { length: 32 }).notNull().default('low_frequency'),
    expectedIntervalHours: int('expected_interval_hours').notNull().default(168),
  },
  (table) => [
    // Existing db/001_init.sql lets MySQL name this key `slug`.
    uniqueIndex('slug').on(table.slug),
    index('blogs_status').on(table.status),
    index('blogs_category').on(table.category),
  ],
);

export const blogUrls = mysqlTable(
  'blog_urls',
  {
    id: int('id').autoincrement().primaryKey(),
    blogId: int('blog_id').notNull(),
    url: varchar('url', { length: 1024 }).notNull(),
    kind: varchar('kind', { length: 32 }).notNull().default('primary'),
    isPrimary: boolean('is_primary').notNull().default(false),
    discoveredAt: datetime('discovered_at').notNull(),
  },
  (table) => [uniqueIndex('url').on(table.url), index('blog_urls_blog').on(table.blogId)],
);

// Authors are independent identities.  A matching display name never merges
// two authors automatically; claim/merge status and provenance are explicit.
export const authors = mysqlTable(
  'authors',
  {
    id: int('id').autoincrement().primaryKey(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    normalizedName: varchar('normalized_name', { length: 255 }),
    bio: text('bio'),
    homepageUrl: varchar('homepage_url', { length: 1024 }),
    status: varchar('status', { length: 32 }).notNull().default('candidate'),
    claimStatus: varchar('claim_status', { length: 32 }).notNull().default('unclaimed'),
    mergeStatus: varchar('merge_status', { length: 32 }).notNull().default('separate'),
    mergedIntoId: int('merged_into_id'),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('crawler'),
    sourceActorId: int('source_actor_id'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceEvidence: json('source_evidence').$type<ProvenanceEvidence>(),
    firstSeenAt: datetime('first_seen_at').notNull(),
    lastSeenAt: datetime('last_seen_at').notNull(),
    lastPublishedAt: datetime('last_published_at'),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    index('authors_normalized_name').on(table.normalizedName),
    index('authors_status').on(table.status),
    index('authors_claim_merge').on(table.claimStatus, table.mergeStatus),
  ],
);

export const blogAuthors = mysqlTable(
  'blog_authors',
  {
    blogId: int('blog_id').notNull(),
    authorId: int('author_id').notNull(),
    role: varchar('role', { length: 32 }).notNull().default('author'),
    status: varchar('status', { length: 32 }).notNull().default('candidate'),
    isPrimary: boolean('is_primary').notNull().default(false),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('crawler'),
    sourceActorId: int('source_actor_id'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceEvidence: json('source_evidence').$type<ProvenanceEvidence>(),
    firstSeenAt: datetime('first_seen_at').notNull(),
    lastSeenAt: datetime('last_seen_at').notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.blogId, table.authorId] }),
    index('blog_authors_author_status').on(table.authorId, table.status),
    index('blog_authors_blog_status').on(table.blogId, table.status),
  ],
);

export const postAuthors = mysqlTable(
  'post_authors',
  {
    postId: int('post_id').notNull(),
    authorId: int('author_id').notNull(),
    role: varchar('role', { length: 32 }).notNull().default('author'),
    position: int('position').notNull().default(0),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('crawler'),
    sourceActorId: int('source_actor_id'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceEvidence: json('source_evidence').$type<ProvenanceEvidence>(),
    firstSeenAt: datetime('first_seen_at').notNull(),
    lastSeenAt: datetime('last_seen_at').notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.authorId] }),
    index('post_authors_author').on(table.authorId, table.status),
    index('post_authors_post_position').on(table.postId, table.position),
  ],
);

// Tags distinguish a site's identity labels from post topics through `kind`.
// canonicalTagId is an explicit alias/normalisation link; no name match is an
// implicit merge.
export const tags = mysqlTable(
  'tags',
  {
    id: int('id').autoincrement().primaryKey(),
    slug: varchar('slug', { length: 180 }).notNull(),
    label: varchar('label', { length: 255 }).notNull(),
    normalizedLabel: varchar('normalized_label', { length: 255 }),
    kind: varchar('kind', { length: 32 }).notNull().default('topic'),
    visibility: varchar('visibility', { length: 32 }).notNull().default('public'),
    status: varchar('status', { length: 32 }).notNull().default('candidate'),
    canonicalTagId: int('canonical_tag_id'),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('crawler'),
    sourceActorId: int('source_actor_id'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceEvidence: json('source_evidence').$type<ProvenanceEvidence>(),
    firstSeenAt: datetime('first_seen_at').notNull(),
    lastSeenAt: datetime('last_seen_at').notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('tags_slug').on(table.slug),
    index('tags_normalized_label').on(table.normalizedLabel),
    index('tags_kind_status').on(table.kind, table.status),
    index('tags_canonical').on(table.canonicalTagId),
  ],
);

export const blogTags = mysqlTable(
  'blog_tags',
  {
    blogId: int('blog_id').notNull(),
    tagId: int('tag_id').notNull(),
    role: varchar('role', { length: 32 }).notNull().default('identity'),
    status: varchar('status', { length: 32 }).notNull().default('candidate'),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('crawler'),
    sourceActorId: int('source_actor_id'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceEvidence: json('source_evidence').$type<ProvenanceEvidence>(),
    firstSeenAt: datetime('first_seen_at').notNull(),
    lastSeenAt: datetime('last_seen_at').notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.blogId, table.tagId] }),
    index('blog_tags_tag_status').on(table.tagId, table.status),
    index('blog_tags_blog_status').on(table.blogId, table.status),
  ],
);

export const postTags = mysqlTable(
  'post_tags',
  {
    postId: int('post_id').notNull(),
    tagId: int('tag_id').notNull(),
    role: varchar('role', { length: 32 }).notNull().default('topic'),
    position: int('position').notNull().default(0),
    status: varchar('status', { length: 32 }).notNull().default('active'),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('crawler'),
    sourceActorId: int('source_actor_id'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceEvidence: json('source_evidence').$type<ProvenanceEvidence>(),
    firstSeenAt: datetime('first_seen_at').notNull(),
    lastSeenAt: datetime('last_seen_at').notNull(),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.postId, table.tagId] }),
    index('post_tags_tag_status').on(table.tagId, table.status),
    index('post_tags_post_position').on(table.postId, table.position),
  ],
);

export const seedRecords = mysqlTable(
  'seed_records',
  {
    id: int('id').autoincrement().primaryKey(),
    sourcePath: varchar('source_path', { length: 1024 }).notNull(),
    sourceSha256: char('source_sha256', { length: 64 }).notNull(),
    sourceRow: int('source_row').notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    originalCategory: varchar('original_category', { length: 255 }),
    originalValues: json('original_values').$type<SeedValues>().notNull(),
    blogId: int('blog_id'),
    duplicateOf: int('duplicate_of'),
    importedAt: datetime('imported_at').notNull(),
  },
  (table) => [
    uniqueIndex('seed_records_source_row').on(table.sourceSha256, table.sourceRow),
    index('seed_records_name').on(table.originalName),
  ],
);

export const feedSources = mysqlTable(
  'feed_sources',
  {
    id: int('id').autoincrement().primaryKey(),
    blogId: int('blog_id').notNull(),
    url: varchar('url', { length: 1024 }).notNull(),
    type: varchar('type', { length: 32 }).notNull().default('rss'),
    etag: varchar('etag', { length: 512 }),
    lastModified: varchar('last_modified', { length: 255 }),
    lastSuccessAt: datetime('last_success_at'),
    lastErrorAt: datetime('last_error_at'),
    consecutiveFailures: int('consecutive_failures').notNull().default(0),
  },
  (table) => [uniqueIndex('url').on(table.url), index('feed_sources_blog').on(table.blogId)],
);

export const posts = mysqlTable(
  'posts',
  {
    id: int('id').autoincrement().primaryKey(),
    blogId: int('blog_id').notNull(),
    guid: varchar('guid', { length: 1024 }).notNull(),
    url: varchar('url', { length: 1024 }).notNull(),
    title: varchar('title', { length: 512 }).notNull(),
    summary: text('summary'),
    author: varchar('author', { length: 255 }),
    publishedAt: datetime('published_at'),
    updatedAt: datetime('updated_at'),
    imageUrl: varchar('image_url', { length: 1024 }),
    contentHash: char('content_hash', { length: 64 }),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('feed'),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('posts_blog_guid').on(table.blogId, table.guid),
    index('posts_published').on(table.publishedAt),
    index('posts_blog_published').on(table.blogId, table.publishedAt),
  ],
);

export const users = mysqlTable(
  'users',
  {
    id: int('id').autoincrement().primaryKey(),
    googleSub: varchar('google_sub', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }),
    picture: varchar('picture', { length: 1024 }),
    createdAt: datetime('created_at').notNull(),
    lastLoginAt: datetime('last_login_at').notNull(),
  },
  (table) => [uniqueIndex('google_sub').on(table.googleSub), index('users_email').on(table.email)],
);

export const userSessions = mysqlTable(
  'user_sessions',
  {
    tokenHash: char('token_hash', { length: 64 }).primaryKey(),
    userId: int('user_id').notNull(),
    createdAt: datetime('created_at').notNull(),
    expiresAt: datetime('expires_at').notNull(),
  },
  (table) => [index('user_sessions_expires').on(table.expiresAt), index('user_sessions_user').on(table.userId)],
);

export const userFollows = mysqlTable(
  'user_follows',
  {
    userId: int('user_id').notNull(),
    blogId: int('blog_id').notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.blogId] }), index('user_follows_blog').on(table.blogId)],
);

export const discoveryCandidates = mysqlTable(
  'discovery_candidates',
  {
    id: int('id').autoincrement().primaryKey(),
    url: varchar('url', { length: 1024 }).notNull(),
    name: varchar('name', { length: 255 }),
    sourceType: varchar('source_type', { length: 64 }).notNull(),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceEvidence: json('source_evidence').$type<DiscoveryEvidence>(),
    status: varchar('status', { length: 32 }).notNull().default('candidate'),
    discoveredAt: datetime('discovered_at').notNull(),
  },
  (table) => [
    uniqueIndex('discovery_candidates_url_source').on(table.url, table.sourceType),
    index('discovery_candidates_status').on(table.status),
  ],
);

// Every candidate decision is append-only.  This keeps crawler observations,
// community reports and manual review distinguishable after status changes.
export const discoveryCandidateAudits = mysqlTable(
  'discovery_candidate_audits',
  {
    id: int('id').autoincrement().primaryKey(),
    candidateId: int('candidate_id').notNull(),
    action: varchar('action', { length: 32 }).notNull(),
    previousStatus: varchar('previous_status', { length: 32 }),
    nextStatus: varchar('next_status', { length: 32 }),
    sourceType: varchar('source_type', { length: 32 }).notNull().default('manual'),
    sourceActorId: int('source_actor_id'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    sourceEvidence: json('source_evidence').$type<ProvenanceEvidence>(),
    note: text('note'),
    occurredAt: datetime('occurred_at').notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [
    index('discovery_candidate_audits_candidate_time').on(table.candidateId, table.occurredAt),
    index('discovery_candidate_audits_action_time').on(table.action, table.occurredAt),
    index('discovery_candidate_audits_source_time').on(table.sourceType, table.occurredAt),
  ],
);

export const blogLinks = mysqlTable(
  'blog_links',
  {
    fromBlogId: int('from_blog_id').notNull(),
    toBlogId: int('to_blog_id').notNull(),
    relation: varchar('relation', { length: 32 }).notNull().default('blogroll'),
    sourceUrl: varchar('source_url', { length: 1024 }),
    discoveredAt: datetime('discovered_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.fromBlogId, table.toBlogId, table.relation] })],
);
