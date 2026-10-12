import { datetime, foreignKey, index, mysqlTable, primaryKey, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';

/** Public HTML paths are independent of immutable API IDs and snapshot lifetimes. */
export const publicRouteKeys = mysqlTable(
  'public_route_keys',
  {
    kind: varchar('kind', { length: 16 }).notNull(),
    routeKey: varchar('route_key', { length: 180 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.routeKey] }),
    uniqueIndex('public_route_key_owner').on(t.kind, t.routeKey, t.entityId),
    index('public_route_keys_entity').on(t.kind, t.entityId),
  ],
);
export const publicPageRoutes = mysqlTable(
  'public_page_routes',
  {
    kind: varchar('kind', { length: 16 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }).notNull(),
    canonicalKey: varchar('canonical_key', { length: 180 }).notNull(),
    createdAt: datetime('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.entityId] }),
    uniqueIndex('public_page_canonical').on(t.kind, t.canonicalKey),
    foreignKey({
      name: 'public_page_key_owner_fk',
      columns: [t.kind, t.canonicalKey, t.entityId],
      foreignColumns: [publicRouteKeys.kind, publicRouteKeys.routeKey, publicRouteKeys.entityId],
    }),
  ],
);
