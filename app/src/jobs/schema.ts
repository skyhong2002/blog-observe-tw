import { char, datetime, int, mysqlTable, primaryKey, varchar } from 'drizzle-orm/mysql-core';

/** UTC budget reservations survive crashes; failed attempts intentionally remain charged. */
export const workBudgets = mysqlTable(
  'work_budgets',
  {
    day: char('day', { length: 10 }).notNull(),
    scope: varchar('scope', { length: 191 }).notNull(),
    used: int('used').notNull().default(0),
    updatedAt: datetime('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.scope] })],
);
