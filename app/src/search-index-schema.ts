import { boolean, char, index, int, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';
export const postBodySearchTerms = mysqlTable(
  'post_body_search_terms',
  {
    gramHash: char('gram_hash', { length: 64 }).notNull(),
    postId: int('post_id').notNull(),
    contentHash: char('content_hash', { length: 64 }).notNull(),
    bodyTextHash: char('body_text_hash', { length: 64 }).notNull(),
    prefixCharacters: int('prefix_characters').notNull(),
    prefixTruncated: boolean('prefix_truncated').notNull(),
    indexVersion: varchar('index_version', { length: 64 }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.gramHash, table.postId] }), index('body_search_post').on(table.postId)],
);
