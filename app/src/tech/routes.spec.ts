import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { registerTechRoutes } from './routes.ts';
import { parseTrafficSites } from './traffic.ts';

const read = vi.hoisted(() => vi.fn());
vi.mock('./traffic.ts', async (original) => ({
  ...(await original<typeof import('./traffic.ts')>()),
  trafficTechClient: () => ({ read }),
}));
vi.mock('../seo/page-routes.ts', () => ({
  getPublicPages: async () => new Map(),
  resolvePublicPage: async () => ({ entityId: 1 }),
  isPublicRouteKey: () => true,
}));
vi.mock('../v1/favicon-routes.ts', () => ({ iconManifest: async () => ({}) }));
vi.mock('../v1/icons.ts', () => ({ iconUrl: () => null }));
const rows = [
  { id: 1, slug: 'one', name: 'One', url: 'https://www.Example.tw/', canonical_host: 'www.Example.tw' },
  { id: 2, slug: 'two', name: 'Two', url: 'https://new.tw/', canonical_host: 'new.tw' },
];
function pool() {
  return {
    getConnection: async () => ({
      query: async ({ sql }: { sql: string }) => {
        expect(sql).not.toContain('blog_tech_scans');
        return [sql.includes('COUNT(*)') ? [{ total: 2 }] : rows];
      },
      release() {},
      destroy() {},
    }),
  } as unknown as Pool;
}
describe('traffic technology routes', () => {
  it('maps normalized domains to slugs, counts history and resolves aliases with one batch per read', async () => {
    read.mockResolvedValue(
      parseTrafficSites({
        sites: {
          'example.tw': {
            status: 'blocked',
            errorCode: 'robots',
            observedAt: '2026-10-01T00:00:00Z',
            lastAttemptAt: '2026-10-24T00:00:00Z',
            sourceUrl: 'https://example.tw/',
            detections: [
              {
                id: 'hugo',
                name: 'Hugo',
                category: 'cms',
                confidence: 1,
                version: 'unknown',
                ruleId: 'wappalyzer:hugo',
                ruleVersion: 'pin',
                observedAt: '2026-10-01T00:00:00Z',
                evidence: [],
              },
            ],
          },
        },
        notChecked: ['new.tw'],
      }),
    );
    const app = Fastify();
    registerTechRoutes(app, pool(), { enabled: true });
    try {
      const response = await app.inject('/api/tech?technology=hugo');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        coverage: { blocked: 1, notObserved: 1 },
        technologies: [{ id: 'hugo', blogs: 1 }],
        items: [{ slug: 'one', status: 'blocked' }],
      });
      expect(read).toHaveBeenLastCalledWith(['www.Example.tw', 'new.tw']);
      const before = read.mock.calls.length;
      const detail = await app.inject('/api/blogs/alias/tech');
      expect(detail.json().blog).toMatchObject({ slug: 'one', status: 'blocked', observedAt: '2026-10-01T00:00:00Z' });
      expect(read.mock.calls.length).toBe(before + 1);
      expect((await app.inject('/api/tech?status=unknown')).json().items).toMatchObject([{ slug: 'two', status: 'not-observed' }]);
      read.mockRejectedValueOnce(Error('upstream secret'));
      const failure = await app.inject('/api/tech');
      expect(failure.statusCode).toBe(503);
      expect(failure.json()).toEqual({ error: 'technology_unavailable' });
      expect(failure.headers['cache-control']).toContain('no-store');
    } finally {
      await app.close();
    }
  });
});
