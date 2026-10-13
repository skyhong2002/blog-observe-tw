import { bigint, char, datetime, index, json, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';
/** Exact UTF-8 label hash plus kind; no raw upstream payload, account, token or guessed payload version. */
export const topicSharedLabelSnapshots = mysqlTable(
  'topic_shared_label_snapshots',
  {
    labelHash: char('label_hash', { length: 64 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
    exactLabel: varchar('exact_label', { length: 60 }).notNull(),
    status: varchar('status', { length: 16 }).notNull(),
    validatedDto: json('validated_dto'),
    fetchedAt: datetime('fetched_at', { mode: 'date', fsp: 3 }).notNull(),
    expiresAt: datetime('expires_at', { mode: 'date', fsp: 3 }).notNull(),
    sourceContractSha: char('source_contract_sha', { length: 40 }).notNull(),
    payloadVersion: varchar('payload_version', { length: 128 }),
  },
  (t) => [primaryKey({ columns: [t.labelHash, t.kind] }), index('shared_label_expiry').on(t.expiresAt)],
);

/** Epoch milliseconds preserve Retry-After beyond MySQL DATETIME's range (up to JS max Date). */
export const sharedLabelSyncControl = mysqlTable('shared_label_sync_control', {
  scope: varchar('scope', { length: 8 }).primaryKey(),
  retryAfterEpochMs: bigint('retry_after_epoch_ms', { mode: 'number' }).notNull(),
  updatedAt: datetime('updated_at', { mode: 'date', fsp: 3 }).notNull(),
});
