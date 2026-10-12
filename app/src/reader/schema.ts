import { char, datetime, index, int, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

// Adapted from tag.observe.tw (afe0a65): only SHA-256 digests persist, never API keys.
export const userApiKeys = mysqlTable(
  'user_api_keys',
  {
    id: int('id').autoincrement().primaryKey(),
    userId: int('user_id').notNull(),
    keyHash: char('key_hash', { length: 64 }).notNull(),
    prefix: varchar('prefix', { length: 16 }).notNull(),
    label: varchar('label', { length: 80 }).notNull().default(''),
    createdAt: datetime('created_at').notNull(),
    lastUsedAt: datetime('last_used_at'),
    revokedAt: datetime('revoked_at'),
  },
  (table) => [uniqueIndex('user_api_keys_hash').on(table.keyHash), index('user_api_keys_user_active').on(table.userId, table.revokedAt)],
);
