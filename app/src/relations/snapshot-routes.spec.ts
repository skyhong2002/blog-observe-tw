import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { MENTION_FEED_AFTER_SQL, MENTION_FEED_SQL } from './home-feed.ts';
import { invalidateRelationCache, registerRelationRoutes } from './routes.ts';

describe('shared /api/mentions first page', () => {
  it('is read once per refresh; later pages read fresh; an admin invalidation drops it', async () => {
    let first = 0;
    let after = 0;
    const query = async (sql: string) => {
      if (sql === MENTION_FEED_SQL) first++;
      if (sql === MENTION_FEED_AFTER_SQL) after++;
      return [[]];
    };
    const connection = { beginTransaction: async () => {}, query, commit: async () => {}, rollback: async () => {}, release: () => {} };
    const pool = { query, getConnection: async () => connection } as unknown as Pool;
    const app = Fastify();
    await registerRelationRoutes(app, pool);
    try {
      expect((await app.inject('/api/mentions')).statusCode).toBe(200);
      await app.inject('/api/mentions');
      expect(first).toBe(1);
      await app.inject('/api/mentions?cursor=2026-10-01T00:00:00Z_5');
      await app.inject('/api/mentions?cursor=2026-10-01T00:00:00Z_5');
      expect(after).toBe(2);
      await invalidateRelationCache(pool);
      await app.inject('/api/mentions');
      expect(first).toBe(2);
    } finally {
      await app.close();
    }
  });
  it('refreshMs 0 reads every request', async () => {
    let first = 0;
    const pool = {
      query: async (sql: string) => {
        if (sql === MENTION_FEED_SQL) first++;
        return [[]];
      },
    } as unknown as Pool;
    const app = Fastify();
    await registerRelationRoutes(app, pool, { refreshMs: 0 });
    try {
      await app.inject('/api/mentions');
      await app.inject('/api/mentions');
      expect(first).toBe(2);
    } finally {
      await app.close();
    }
  });
});
