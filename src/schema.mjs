import { boolean, datetime, index, int, json, mysqlTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

export const blogs = mysqlTable("blogs", {
  id: int("id").autoincrement().primaryKey(),
  slug: varchar("slug", { length: 180 }).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  url: varchar("url", { length: 1024 }),
  canonicalHost: varchar("canonical_host", { length: 255 }),
  category: varchar("category", { length: 255 }).notNull().default("待分類"),
  description: text("description"),
  status: varchar("status", { length: 32 }).notNull().default("seed"),
  statusLabel: varchar("status_label", { length: 64 }).notNull().default("待核對"),
  sourceSha256: varchar("source_sha256", { length: 64 }),
  sourceRow: int("source_row"),
  sourceName: varchar("source_name", { length: 255 }),
  sourceCategory: varchar("source_category", { length: 255 }),
  sourceValues: json("source_values"),
  discoveredAt: datetime("discovered_at").notNull(),
  lastCrawledAt: datetime("last_crawled_at"),
  lastPublishedAt: datetime("last_published_at"),
  expectedIntervalHours: int("expected_interval_hours").notNull().default(168),
}, (t) => [uniqueIndex("blogs_slug").on(t.slug), index("blogs_status").on(t.status), index("blogs_category").on(t.category)]);

export const blogUrls = mysqlTable("blog_urls", {
  id: int("id").autoincrement().primaryKey(),
  blogId: int("blog_id").notNull(),
  url: varchar("url", { length: 1024 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull().default("primary"),
  isPrimary: boolean("is_primary").notNull().default(false),
  discoveredAt: datetime("discovered_at").notNull(),
}, (t) => [uniqueIndex("blog_urls_url").on(t.url), index("blog_urls_blog").on(t.blogId)]);

export const seedRecords = mysqlTable("seed_records", {
  id: int("id").autoincrement().primaryKey(),
  sourcePath: varchar("source_path", { length: 1024 }).notNull(),
  sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
  sourceRow: int("source_row").notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  originalCategory: varchar("original_category", { length: 255 }),
  originalValues: json("original_values").notNull(),
  blogId: int("blog_id"),
  duplicateOf: int("duplicate_of"),
  importedAt: datetime("imported_at").notNull(),
}, (t) => [uniqueIndex("seed_records_source_row").on(t.sourceSha256, t.sourceRow), index("seed_records_name").on(t.originalName)]);

export const feedSources = mysqlTable("feed_sources", {
  id: int("id").autoincrement().primaryKey(),
  blogId: int("blog_id").notNull(),
  url: varchar("url", { length: 1024 }).notNull(),
  type: varchar("type", { length: 32 }).notNull().default("rss"),
  etag: varchar("etag", { length: 512 }),
  lastModified: varchar("last_modified", { length: 255 }),
  lastSuccessAt: datetime("last_success_at"),
  lastErrorAt: datetime("last_error_at"),
  consecutiveFailures: int("consecutive_failures").notNull().default(0),
}, (t) => [uniqueIndex("feed_sources_url").on(t.url), index("feed_sources_blog").on(t.blogId)]);

export const posts = mysqlTable("posts", {
  id: int("id").autoincrement().primaryKey(),
  blogId: int("blog_id").notNull(),
  guid: varchar("guid", { length: 1024 }).notNull(),
  url: varchar("url", { length: 1024 }).notNull(),
  title: varchar("title", { length: 512 }).notNull(),
  summary: text("summary"),
  author: varchar("author", { length: 255 }),
  publishedAt: datetime("published_at"),
  updatedAt: datetime("updated_at"),
  imageUrl: varchar("image_url", { length: 1024 }),
  contentHash: varchar("content_hash", { length: 64 }),
  sourceType: varchar("source_type", { length: 32 }).notNull().default("feed"),
  createdAt: datetime("created_at").notNull(),
}, (t) => [uniqueIndex("posts_blog_guid").on(t.blogId, t.guid), index("posts_published").on(t.publishedAt), index("posts_blog_published").on(t.blogId, t.publishedAt)]);

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  googleSub: varchar("google_sub", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  name: varchar("name", { length: 255 }),
  picture: varchar("picture", { length: 1024 }),
  createdAt: datetime("created_at").notNull(),
  lastLoginAt: datetime("last_login_at").notNull(),
}, (t) => [uniqueIndex("users_google_sub").on(t.googleSub), index("users_email").on(t.email)]);

export const userSessions = mysqlTable("user_sessions", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: int("user_id").notNull(),
  createdAt: datetime("created_at").notNull(),
  expiresAt: datetime("expires_at").notNull(),
}, (t) => [index("user_sessions_expires").on(t.expiresAt), index("user_sessions_user").on(t.userId)]);

export const userFollows = mysqlTable("user_follows", {
  userId: int("user_id").notNull(),
  blogId: int("blog_id").notNull(),
  createdAt: datetime("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.blogId] }), index("user_follows_blog").on(t.blogId)]);

export const discoveryCandidates = mysqlTable("discovery_candidates", {
  id: int("id").autoincrement().primaryKey(),
  url: varchar("url", { length: 1024 }).notNull(),
  name: varchar("name", { length: 255 }),
  sourceType: varchar("source_type", { length: 64 }).notNull(),
  sourceUrl: varchar("source_url", { length: 1024 }),
  sourceEvidence: json("source_evidence"),
  status: varchar("status", { length: 32 }).notNull().default("candidate"),
  discoveredAt: datetime("discovered_at").notNull(),
}, (t) => [uniqueIndex("discovery_candidates_url_source").on(t.url, t.sourceType), index("discovery_candidates_status").on(t.status)]);

export const blogLinks = mysqlTable("blog_links", {
  fromBlogId: int("from_blog_id").notNull(),
  toBlogId: int("to_blog_id").notNull(),
  relation: varchar("relation", { length: 32 }).notNull().default("blogroll"),
  sourceUrl: varchar("source_url", { length: 1024 }),
  discoveredAt: datetime("discovered_at").notNull(),
}, (t) => [primaryKey({ columns: [t.fromBlogId, t.toBlogId, t.relation] })]);
