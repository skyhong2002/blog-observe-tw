import { boolean, char, datetime, index, int, json, mysqlTable, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
export const adminGoogleIdentities = mysqlTable(
  'admin_google_identities',
  {
    id: int('id').autoincrement().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    googleSub: varchar('google_sub', { length: 255 }).notNull(),
    userId: int('user_id').notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('admin_pin_email').on(t.email),
    uniqueIndex('admin_pin_sub').on(t.googleSub),
    uniqueIndex('admin_pin_user').on(t.userId),
  ],
);
export const adminAudits = mysqlTable(
  'admin_audits',
  {
    id: int('id').autoincrement().primaryKey(),
    actorUserId: int('actor_user_id'),
    action: varchar('action', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    entityId: varchar('entity_id', { length: 191 }).notNull(),
    beforeJson: json('before_json'),
    afterJson: json('after_json'),
    note: varchar('note', { length: 500 }),
    createdAt: datetime('created_at').notNull(),
  },
  (t) => [index('admin_audit_time').on(t.createdAt)],
);
export const adminIntents = mysqlTable('admin_intents', {
  id: char('id', { length: 64 }).primaryKey(),
  actorUserId: int('actor_user_id').notNull(),
  action: varchar('action', { length: 64 }).notNull(),
  payloadHash: char('payload_hash', { length: 64 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(),
  resultJson: json('result_json'),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
});
export const adminRelationOverrides = mysqlTable(
  'admin_relation_overrides',
  {
    fingerprint: char('fingerprint', { length: 64 }).primaryKey(),
    sourcePostId: int('source_post_id').notNull(),
    targetUrlHash: char('target_url_hash', { length: 64 }).notNull(),
    targetUrl: varchar('target_url', { length: 2048 }).notNull(),
    location: varchar('location', { length: 16 }).notNull(),
    hidden: boolean('hidden').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    actorUserId: int('actor_user_id').notNull(),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [index('admin_relation_source').on(t.sourcePostId, t.targetUrlHash, t.location)],
);
