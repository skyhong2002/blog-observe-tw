import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { installPrivateCachePolicy } from './cache-policy.ts';
import { registerCollectionCount } from './collection-count.ts';
import { gatewayRateKey, gatewayRateMax } from './public-api/client-ip.ts';

const COUNT_SQL = "SELECT COUNT(*) AS blogs FROM blogs WHERE status='verified'";
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function fixture(raw: unknown = '1234') {
  const query = vi.fn(async (_sql: string): Promise<unknown> => [[{ blogs: raw }], []]);
  const pool = { query };
  const app = Fastify({ exposeHeadRoutes: true });
  apps.push(app);
  installPrivateCachePolicy(app);
  registerCollectionCount(app, pool as unknown as Pool);
  return { app, pool };
}

describe('public verified-blog count', () => {
  it.each([0, '0', 1234, '1234', Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)])(
    'returns a validated count from one statement for driver value %j',
    async (raw) => {
      const { app, pool } = fixture(raw);
      const response = await app.inject('/api/collection-count');
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ blogs: Number(raw) });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(pool.query.mock.calls).toEqual([[COUNT_SQL]]);
    },
  );

  it.each([undefined, null, '', ' ', true, {}, [], -1, '-1', 1.5, '1.5', Number.NaN, Infinity, '9007199254740993'])(
    'returns generic 503 for malformed or unsafe driver count %j',
    async (raw) => {
      const { app, pool } = fixture();
      pool.query.mockResolvedValue([[{ blogs: raw }], []]);
      const response = await app.inject('/api/collection-count');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'unavailable' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(pool.query).toHaveBeenCalledTimes(1);
    },
  );

  it('handles missing rows and database rejection without exposing private errors', async () => {
    const { app, pool } = fixture();
    pool.query.mockResolvedValueOnce([[], []]).mockRejectedValueOnce(new Error('private SQL credentials'));
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await app.inject('/api/collection-count');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'unavailable' });
    }
  });

  it.each(['limit=1', 'limit=1&limit=2', 'view=home', 'cookie=synthetic', 'blogs=1', 'x=1&x=2'])(
    'rejects query %s before storage with the real query parser',
    async (query) => {
      const { app, pool } = fixture();
      const response = await app.inject(`/api/collection-count?${query}`);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_query' });
      expect(response.headers['cache-control']).toBe('no-store');
      expect(pool.query).not.toHaveBeenCalled();
    },
  );

  it('supports HEAD with the same fresh count and marks credentialed responses private', async () => {
    const { app, pool } = fixture();
    const head = await app.inject({ url: '/api/collection-count', method: 'HEAD' });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['cache-control']).toBe('no-store');
    for (const header of ['cookie', 'authorization', 'x-api-key']) {
      const response = await app.inject({ url: '/api/collection-count', headers: { [header]: 'synthetic' } });
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    expect(pool.query).toHaveBeenCalledTimes(4);
  });

  it('reads afresh after success and never substitutes a previous result on failure', async () => {
    const { app, pool } = fixture();
    pool.query
      .mockResolvedValueOnce([[{ blogs: 2 }], []])
      .mockResolvedValueOnce([[{ blogs: 1 }], []])
      .mockRejectedValueOnce(new Error('down'));
    expect((await app.inject('/api/collection-count')).json()).toEqual({ blogs: 2 });
    expect((await app.inject('/api/collection-count')).json()).toEqual({ blogs: 1 });
    expect((await app.inject('/api/collection-count')).statusCode).toBe(503);
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('does not share concurrent database reads', async () => {
    const { app, pool } = fixture();
    const entered = Promise.withResolvers<void>();
    const answers: Array<(value: unknown) => void> = [];
    pool.query.mockImplementation(
      async () =>
        new Promise((resolve) => {
          answers.push(resolve);
          if (answers.length === 2) entered.resolve();
        }),
    );
    await app.ready();
    const first = Promise.resolve(app.inject('/api/collection-count'));
    const second = Promise.resolve(app.inject('/api/collection-count'));
    await entered.promise;
    answers[1]([[{ blogs: 9 }], []]);
    answers[0]([[{ blogs: 8 }], []]);
    expect((await first).json()).toEqual({ blogs: 8 });
    expect((await second).json()).toEqual({ blogs: 9 });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it('is registered in the gateway without page-link enrichment queries', async () => {
    const { pool } = fixture();
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      // @ts-expect-error JS gateway accepts the injected store despite its null default.
      { store: { pool } },
    );
    apps.push(app);
    const response = await app.inject('/api/collection-count');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ blogs: 1234 });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(pool.query.mock.calls).toEqual([[COUNT_SQL]]);
  });

  it('shares the existing render bucket with catalog GET/HEAD and isolates ordinary requests', async () => {
    const app = Fastify({ exposeHeadRoutes: true });
    apps.push(app);
    await app.register(rateLimit, { global: true, max: gatewayRateMax, keyGenerator: gatewayRateKey, timeWindow: '1 minute' });
    registerCollectionCount(app, { query: async () => [[{ blogs: 1 }], []] } as unknown as Pool);
    app.get('/api/catalog', async () => ({ fixture: true }));
    app.get('/ordinary', async () => ({ fixture: true }));
    const ordinary = await app.inject('/ordinary');
    expect(ordinary.headers['x-ratelimit-limit']).toBe('240');
    expect(ordinary.headers['x-ratelimit-remaining']).toBe('239');
    for (const [url, method, remaining] of [
      ['/api/collection-count', 'GET', '1999'],
      ['/api/catalog?limit=1', 'GET', '1998'],
      ['/api/collection-count', 'HEAD', '1997'],
    ] as const) {
      const response = await app.inject({ url, method });
      expect(response.statusCode).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe('2000');
      expect(response.headers['x-ratelimit-remaining']).toBe(remaining);
    }
    expect((await app.inject('/ordinary')).headers['x-ratelimit-remaining']).toBe('238');
    const external = await app.inject({ url: '/api/collection-count', remoteAddress: '203.0.113.7' });
    expect(external.headers['x-ratelimit-limit']).toBe('240');
    const credentialed = await app.inject({ url: '/api/collection-count', headers: { cookie: 'synthetic' } });
    expect(credentialed.headers['x-ratelimit-limit']).toBe('240');
    expect(credentialed.headers['x-ratelimit-remaining']).toBe('237');
  });
});
