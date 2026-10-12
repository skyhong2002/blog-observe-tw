import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { registerAiRoutes } from './routes.ts';

describe('public inference visibility', () => {
  it('requires a currently verified publication and excludes scheduled articles', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[{ id: 1 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    const app = Fastify();
    registerAiRoutes(app, { query } as unknown as Pool);
    try {
      expect((await app.inject('/api/blogs/writer/inference')).statusCode).toBe(200);
      expect(query.mock.calls[0][0]).toContain("status='verified'");
      expect(query.mock.calls[3][0]).toContain('(p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())');
      query.mockResolvedValueOnce([[]]);
      expect((await app.inject('/api/blogs/writer/inference')).statusCode).toBe(404);
      expect(query).toHaveBeenCalledTimes(5);
    } finally {
      await app.close();
    }
  });
});
