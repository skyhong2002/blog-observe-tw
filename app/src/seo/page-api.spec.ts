import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPageApi } from './page-api.ts';

const { resolve, metadata } = vi.hoisted(() => ({ resolve: vi.fn(), metadata: vi.fn() }));
vi.mock('./page-routes.ts', () => ({ resolvePublicPage: resolve }));
vi.mock('./indexability.ts', () => ({ getPageIndexability: metadata }));
afterEach(() => vi.resetAllMocks());
describe('read-only public page resolver API', () => {
  it('decodes a Chinese key exactly once and returns thin-page metadata with HTTP 200', async () => {
    const app = Fastify();
    const pool = {} as Pool;
    registerPageApi(app, pool);
    resolve.mockResolvedValue({
      entityId: 'a'.repeat(64),
      stableId: `tag:${'a'.repeat(64)}`,
      slug: '人工智慧',
      canonicalPath: '/topics/%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7/',
    });
    metadata.mockResolvedValue({
      indexable: false,
      indexabilityReason: 'insufficient-posts',
      posts: 2,
      blogs: 2,
      windowDays: 90,
      currentVersion: 'current',
    });
    try {
      const response = await app.inject('/api/pages/topics/%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7');
      expect(response.statusCode).toBe(200);
      expect(resolve).toHaveBeenCalledWith(pool, 'topic', '人工智慧');
      expect(response.json().page.indexable).toBe(false);
      expect(response.headers['cache-control']).toContain('s-maxage=300');
      await app.inject('/api/pages/topics/%252F');
      expect(resolve).toHaveBeenLastCalledWith(pool, 'topic', '%2F');
    } finally {
      await app.close();
    }
  });
  it('unknown pages return 404 without a metadata query or writes', async () => {
    const app = Fastify();
    registerPageApi(app, {} as Pool);
    resolve.mockResolvedValue(null);
    try {
      const response = await app.inject('/api/pages/blogs/unknown');
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(metadata).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
