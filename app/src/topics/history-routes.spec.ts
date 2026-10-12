import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { detail } = vi.hoisted(() => ({ detail: vi.fn() }));
vi.mock('./history-read.ts', () => ({ durableTopicDetail: detail }));

import { registerPublicApi } from '../v1/routes.ts';
import { registerTopicRoutes } from './routes.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  detail.mockReset();
});
describe('durable route status is determined by the final detail result', () => {
  for (const version of ['legacy', 'v1']) {
    it(`${version}: a masked detail is 404, never 200 null/metadata`, async () => {
      vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
      detail.mockResolvedValue(null);
      const app = Fastify();
      const pool = new Proxy({} as Pool, {
        get() {
          throw Error('unexpected second lookup');
        },
      });
      if (version === 'v1') registerPublicApi(app, pool);
      else registerTopicRoutes(app, pool);
      try {
        const result = await app.inject(`${version === 'v1' ? '/api/v1' : '/api'}/topics/tag:${'a'.repeat(64)}`);
        expect(result.statusCode).toBe(404);
        expect(result.headers['cache-control']).toContain('no-store');
        expect(result.json()).toEqual({ error: version === 'v1' ? 'not_found' : 'topic_not_found' });
        expect(detail).toHaveBeenCalledOnce();
      } finally {
        await app.close();
      }
    });
    it(`${version}: a revoked detail is 410, never 503`, async () => {
      vi.stubEnv('BLOG_TOPIC_HISTORY_READ_ENABLED', 'true');
      detail.mockRejectedValue(Object.assign(Error('topic_gone'), { statusCode: 410 }));
      const app = Fastify();
      if (version === 'v1') registerPublicApi(app, {} as Pool);
      else registerTopicRoutes(app, {} as Pool);
      try {
        const result = await app.inject(`${version === 'v1' ? '/api/v1' : '/api'}/topics/tag:${'a'.repeat(64)}`);
        expect(result.statusCode).toBe(410);
        expect(result.headers['cache-control']).toContain('no-store');
        expect(result.json()).toEqual({ error: 'topic_gone' });
      } finally {
        await app.close();
      }
    });
  }
});
