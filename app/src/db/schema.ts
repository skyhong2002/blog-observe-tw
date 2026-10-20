import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  datetime,
  index,
  int,
  json,
  mediumtext,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { BlogrollLink } from '../crawl/blogroll-contract.ts';

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
    // URL equality remains exact; this nonunique prefix only narrows the lookup.
    // 512 utf8mb4 characters + blog_id stay below InnoDB's 3072-byte key limit.
    index('posts_blog_url_prefix').on(table.blogId, sql`${sql.identifier(table.url.name)}(512)`),
  ],
);

export const users = mysqlTable(
  'users',
  {
    id: int('id').autoincrement().primaryKey(),
    googleSub: varchar('google_sub', { length: 255 }).notNull(),
    role: varchar('role', { length: 16 }).notNull().default('reader'),
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

// Blog-side durable coordination only. tag remains the sole Similarweb requester.
export const similarwebDomains = mysqlTable(
  'similarweb_domains',
  {
    domain: varchar('domain', { length: 253 }).primaryKey(),
    submittedKinds: json('submitted_kinds').$type<Partial<Record<'traffic' | 'similar_sites', string>>>().notNull(),
    lastSubmittedAt: datetime('last_submitted_at'),
    lastPolledAt: datetime('last_polled_at'),
    nextPollAt: datetime('next_poll_at').notNull(),
    lastResultFetchedAt: datetime('last_result_fetched_at'),
    result: json('result').$type<Record<string, unknown>>(),
    lastAppliedFingerprint: char('last_applied_fingerprint', { length: 64 }),
    lastErrorCode: varchar('last_error_code', { length: 64 }),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [index('similarweb_domains_poll').on(table.nextPollAt)],
);

export const similarwebControl = mysqlTable('similarweb_control', {
  id: varchar('id', { length: 32 }).primaryKey(),
  budgetDay: char('budget_day', { length: 10 }).notNull(),
  submittedCount: int('submitted_count').notNull().default(0),
  nextRoundAt: datetime('next_round_at').notNull(),
  cooldownUntil: datetime('cooldown_until'),
});

/** Cached parsed links, not raw HTML; digest primary keys avoid oversized UTF-8 URL indexes. */
export const discoveryPages = mysqlTable(
  'discovery_pages',
  {
    urlSha256: char('url_sha256', { length: 64 }).primaryKey(),
    url: varchar('url', { length: 1024 }).notNull(),
    finalUrl: varchar('final_url', { length: 1024 }).notNull(),
    parserVersion: int('parser_version').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    etag: varchar('etag', { length: 512 }),
    lastModified: varchar('last_modified', { length: 255 }),
    bodySha256: char('body_sha256', { length: 64 }).notNull(),
    links: json('links').$type<BlogrollLink[]>().notNull(),
    fetchedAt: datetime('fetched_at').notNull(),
  },
  (table) => [index('discovery_pages_fetched').on(table.fetchedAt)],
);

/** Observed links preserve every root/source/target relationship independently of candidate review status. */
export const discoveryEdges = mysqlTable(
  'discovery_edges',
  {
    edgeSha256: char('edge_sha256', { length: 64 }).primaryKey(),
    rootUrl: varchar('root_url', { length: 1024 }).notNull(),
    sourceUrl: varchar('source_url', { length: 1024 }).notNull(),
    targetUrl: varchar('target_url', { length: 1024 }).notNull(),
    path: json('path').$type<string[]>().notNull(),
    anchorText: varchar('anchor_text', { length: 512 }).notNull(),
    relation: varchar('relation', { length: 32 }).notNull(),
    bodySha256: char('body_sha256', { length: 64 }).notNull(),
    firstSeenAt: datetime('first_seen_at').notNull(),
    lastSeenAt: datetime('last_seen_at').notNull(),
  },
  (table) => [index('discovery_edges_seen').on(table.lastSeenAt)],
);

/** History completion is a durable queue state, never inferred from one successful feed poll. */
export const historyRuns = mysqlTable(
  'history_runs',
  {
    blogId: int('blog_id').primaryKey(),
    status: varchar('status', { length: 16 }).notNull().default('partial'),
    pagesFetched: int('pages_fetched').notNull().default(0),
    articlesWritten: int('articles_written').notNull().default(0),
    tasksTotal: int('tasks_total').notNull().default(0),
    tasksDone: int('tasks_done').notNull().default(0),
    archiveSeen: boolean('archive_seen').notNull().default(false),
    warnings: json('warnings').$type<string[]>().notNull(),
    lastError: varchar('last_error', { length: 255 }),
    nextAttemptAt: datetime('next_attempt_at'),
    startedAt: datetime('started_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
    completedAt: datetime('completed_at'),
  },
  (table) => [index('history_runs_schedule').on(table.status, table.nextAttemptAt, table.updatedAt)],
);

export const historyTasks = mysqlTable(
  'history_tasks',
  {
    id: char('id', { length: 64 }).primaryKey(),
    blogId: int('blog_id').notNull(),
    url: varchar('url', { length: 1024 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    sourceUrl: varchar('source_url', { length: 1024 }).notNull(),
    sourceType: varchar('source_type', { length: 16 }).notNull(),
    depth: int('depth').notNull().default(0),
    payload: json('payload').$type<Record<string, unknown>>().notNull(),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    attempts: int('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: 255 }),
    responseHash: char('response_hash', { length: 64 }),
    createdAt: datetime('created_at').notNull(),
    completedAt: datetime('completed_at'),
  },
  (table) => [
    index('history_tasks_pending').on(table.blogId, table.status, table.kind),
    index('history_tasks_response').on(table.blogId, table.responseHash),
  ],
);

export * from '../admin/schema.ts';
export * from '../ai/schema.ts';
export * from '../content/schema.ts';
export * from '../jobs/schema.ts';
export * from '../reader/schema.ts';
export * from '../relations/schema.ts';
export * from '../search-index-schema.ts';
export * from '../seo/schema.ts';
export * from '../tech/schema.ts';
export * from '../topics/history-schema.ts';
export * from '../topics/schema.ts';
export * from '../topics/shared-label-schema.ts';

/** Encoded bigram FULLTEXT is created by additive migration 0027; Drizzle's MySQL
 * index builder does not represent FULLTEXT, so do not replace it with a BTREE index. */
export const postSearchDocuments = mysqlTable('post_search_documents', {
  postId: int('post_id').primaryKey(),
  indexVersion: varchar('index_version', { length: 64 }).notNull(),
  metadataHash: char('metadata_hash', { length: 64 }).notNull(),
  bodyHash: char('body_hash', { length: 64 }),
  tokens: mediumtext('tokens').notNull(),
  indexedAt: datetime('indexed_at').notNull(),
});

export const blogGenreAssignments = mysqlTable(
  'blog_genre_assignments',
  {
    blogId: int('blog_id').notNull(),
    genre: varchar('genre', { length: 32 }).notNull(),
    source: varchar('source', { length: 16 }).$type<'ai' | 'admin' | 'community'>().notNull(),
    status: varchar('status', { length: 16 }).$type<'active' | 'candidate' | 'hidden'>().notNull(),
    reason: text('reason'),
    actorUserId: int('actor_user_id'),
    createdAt: datetime('created_at').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (table) => [primaryKey({ columns: [table.blogId, table.genre, table.source] })],
);

export const blogGenreVotes = mysqlTable(
  'blog_genre_votes',
  {
    blogId: int('blog_id').notNull(),
    genre: varchar('genre', { length: 32 }).notNull(),
    userId: int('user_id').notNull(),
    vote: int('vote').notNull(),
    at: datetime('at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.blogId, table.genre, table.userId] }),
    index('blog_genre_vote_counts').on(table.blogId, table.genre, table.vote),
    check('blog_genre_vote_value', sql`${table.vote} IN (-1, 1)`),
  ],
);

/** Generated per-blog scrapers (app/src/scrapers): code only ever runs in the sandbox, at most one active per blog. */
export const blogScrapers = mysqlTable(
  'blog_scrapers',
  {
    id: int('id').autoincrement().primaryKey(),
    blogId: int('blog_id'),
    candidateId: int('candidate_id'),
    revision: int('revision').notNull().default(1),
    status: varchar('status', { length: 16 }).$type<'validated' | 'active' | 'superseded' | 'rejected'>().notNull(),
    trigger: varchar('trigger', { length: 32 }).notNull(),
    code: mediumtext('code').notNull(),
    codeSha256: char('code_sha256', { length: 64 }).notNull(),
    listUrls: json('list_urls').$type<string[]>().notNull(),
    maxPages: int('max_pages').notNull().default(1),
    /** Pages are read after a headless browser runs their scripts (scrapers/render.ts). */
    render: boolean('render').notNull().default(false),
    model: varchar('model', { length: 64 }).notNull(),
    actualModel: varchar('actual_model', { length: 180 }),
    validation: json('validation'),
    createdAt: datetime('created_at').notNull(),
    activatedAt: datetime('activated_at'),
    lastRunAt: datetime('last_run_at'),
    lastSuccessAt: datetime('last_success_at'),
    lastErrorAt: datetime('last_error_at'),
    consecutiveFailures: int('consecutive_failures').notNull().default(0),
    lastError: varchar('last_error', { length: 255 }),
  },
  (table) => [index('blog_scrapers_blog').on(table.blogId, table.status), index('blog_scrapers_candidate').on(table.candidateId)],
);

export const scraperGenerationAttempts = mysqlTable(
  'scraper_generation_attempts',
  {
    id: int('id').autoincrement().primaryKey(),
    targetType: varchar('target_type', { length: 16 }).$type<'candidate' | 'blog'>().notNull(),
    targetId: int('target_id').notNull(),
    trigger: varchar('trigger', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    reason: varchar('reason', { length: 255 }),
    rounds: int('rounds').notNull().default(0),
    scraperId: int('scraper_id'),
    actualModel: varchar('actual_model', { length: 180 }),
    report: json('report'),
    createdAt: datetime('created_at').notNull(),
  },
  (table) => [index('scraper_attempts_target').on(table.targetType, table.targetId, table.createdAt)],
);

/** The latest robots.txt read per host (crawl/robots-observations.ts), shown next to blogs and candidates. */
export const robotsObservations = mysqlTable('robots_observations', {
  host: varchar('host', { length: 255 }).primaryKey(),
  outcome: varchar('outcome', { length: 16 }).$type<'allowed' | 'missing' | 'partial' | 'blocked' | 'unreachable'>().notNull(),
  httpStatus: int('http_status'),
  error: varchar('error', { length: 32 }),
  disallow: json('disallow').$type<string[]>(),
  checkedAt: datetime('checked_at').notNull(),
  /** Last time the file was read at all (any outcome but unreachable). */
  readableAt: datetime('readable_at'),
});

/** The latest read of a blog's homepage (crawl/site-observation.ts): who it names as its author and whether it
 * introduces one person or an organisation. The directory's 經營者 filter is derived from it and the author rows. */
export const blogSiteObservations = mysqlTable('blog_site_observations', {
  blogId: int('blog_id').primaryKey(),
  homepageUrl: varchar('homepage_url', { length: 1024 }).notNull(),
  httpStatus: int('http_status'),
  /** A person's name from JSON-LD, meta author or an h-card; never the site's own name. */
  authorName: varchar('author_name', { length: 255 }),
  personal: boolean('personal'),
  organization: boolean('organization'),
  reason: varchar('reason', { length: 64 }).notNull(),
  identitySnippet: text('identity_snippet'),
  observedAt: datetime('observed_at').notNull(),
});

/** Daily /api/search counts (app/src/search-usage.ts), Taiwan calendar days. No query text, results or client details. */
export const searchUsageDaily = mysqlTable('search_usage_daily', {
  day: char('day', { length: 10 }).primaryKey(),
  /** First result pages requested by the site's own search page (Sec-Fetch-Site: same-origin). */
  siteSearches: int('site_searches').notNull().default(0),
  siteLaterPages: int('site_later_pages').notNull().default(0),
  /** Of siteSearches: any match, any match found only in an article body, every match only in bodies. */
  withResults: int('with_results').notNull().default(0),
  bodyMatches: int('body_matches').notNull().default(0),
  bodyOnly: int('body_only').notNull().default(0),
  siteFailures: int('site_failures').notNull().default(0),
  /** Valid requests from anything but the site's pages (scripts, other sites, API users). */
  apiRequests: int('api_requests').notNull().default(0),
  updatedAt: datetime('updated_at').notNull(),
});
