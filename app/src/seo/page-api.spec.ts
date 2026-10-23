import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPageApi } from './page-api.ts';

const { resolve, metadata, disposition } = vi.hoisted(() => ({ resolve: vi.fn(), metadata: vi.fn(), disposition: vi.fn() }));
vi.mock('./page-routes.ts', () => ({ resolvePublicPage: resolve }));
vi.mock('./indexability.ts', () => ({ getPageIndexability: metadata }));
vi.mock('../topics/history-read.ts', () => ({ topicHistoryDisposition: disposition }));
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});
describe('read-only public page resolver API', () => {
  it('decodes a Chinese key exactly once without imposing a thin-page noindex gate', async () => {
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
      indexable: true,
      indexabilityReason: null,
      posts: 1,
      blogs: 1,
      windowDays: 90,
      currentVersion: 'current',
    });
    try {
      const response = await app.inject('/api/pages/topics/%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7');
      expect(response.statusCode).toBe(200);
      expect(resolve).toHaveBeenCalledWith(pool, 'topic', '人工智慧', undefined);
      expect(response.json().page.indexable).toBe(true);
      expect(response.headers['cache-control']).toBe('no-store');
      await app.inject('/api/pages/topics/%252F');
      expect(resolve).toHaveBeenLastCalledWith(pool, 'topic', '%2F', undefined);
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
  it('reads a topic disposition once per request and hands it to the page and its counts', async () => {
    vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
    const app = Fastify();
    const pool = {} as Pool;
    registerPageApi(app, pool);
    const id = 'b'.repeat(64);
    const state = { status: 'available', canonicalId: id, label: '火車站', merged: false };
    disposition.mockResolvedValue(state);
    resolve.mockResolvedValue({
      entityId: id,
      stableId: `tag:${id}`,
      slug: '火車站',
      canonicalPath: '/topics/%E7%81%AB%E8%BB%8A%E7%AB%99/',
    });
    metadata.mockResolvedValue({ indexable: true, indexabilityReason: null, posts: 2, blogs: 1, windowDays: null, currentVersion: null });
    try {
      const response = await app.inject('/api/pages/topics/%E7%81%AB%E8%BB%8A%E7%AB%99');
      expect(response.statusCode).toBe(200);
      expect(disposition).toHaveBeenCalledTimes(1);
      expect(disposition).toHaveBeenCalledWith(pool, '火車站');
      expect(resolve).toHaveBeenCalledWith(pool, 'topic', '火車站', state);
      expect(metadata).toHaveBeenCalledWith(pool, 'topic', id, state);
      expect(response.json().page).toMatchObject({ entityId: id, posts: 2, blogs: 1, indexable: true });
      // Withdrawn and masked topics still answer 410/404 from that same read, before any page or count query.
      disposition.mockResolvedValueOnce({ status: 'gone', canonicalId: id, label: '火車站', reason: 'evidence-revoked' });
      expect((await app.inject('/api/pages/topics/%E7%81%AB%E8%BB%8A%E7%AB%99')).statusCode).toBe(410);
      disposition.mockResolvedValueOnce({ status: 'masked', canonicalId: id, reason: 'not-public' });
      expect((await app.inject('/api/pages/topics/%E7%81%AB%E8%BB%8A%E7%AB%99')).statusCode).toBe(404);
      expect(resolve).toHaveBeenCalledTimes(1);
      expect(metadata).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
