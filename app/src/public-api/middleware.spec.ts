import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { installPrivateCachePolicy } from '../cache-policy.ts';
import { installPublicApiPolicy, publicApiPath } from './middleware.ts';

async function fixture() {
  const app = Fastify();
  installPrivateCachePolicy(app);
  const identify = vi.fn(async (key: string) => (key === 'valid' ? { id: 1 } : key === 'second' ? { id: 2 } : null));
  installPublicApiPolicy(app, { identify });
  await app.register(rateLimit, { max: 240, timeWindow: '1 minute', allowList: (r) => publicApiPath(r.url) });
  app.get('/api/v1/articles', async () => ({ items: [], nextCursor: null }));
  app.get('/api/v1/fail', async (_req, reply) => reply.code(400).send({ error: 'invalid_query' }));
  app.get('/api/v1x', async () => ({ ok: true }));
  return { app, identify };
}
describe('public API gateway policy', () => {
  it('limits anonymous origin reads at 60, including HEAD and invalid credentials, isolated by client', async () => {
    const { app } = await fixture();
    for (let i = 0; i < 60; i++)
      expect((await app.inject({ url: '/api/v1/articles', method: i % 2 ? 'HEAD' : 'GET' })).statusCode).toBe(200);
    const denied = await app.inject('/api/v1/articles');
    expect(denied.statusCode).toBe(429);
    expect(denied.json()).toEqual({ error: 'rate_limit_exceeded' });
    expect(denied.headers['retry-after']).toBeDefined();
    expect(denied.headers['access-control-allow-origin']).toBe('*');
    expect(denied.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ url: '/api/v1/articles', headers: { 'cf-connecting-ip': '203.0.113.9' } })).statusCode).toBe(200);
    await app.close();
  });
  it('allows each valid key 1000 reads independently of the 240 global and shared client address', async () => {
    const { app } = await fixture();
    for (let i = 0; i < 1000; i++)
      expect((await app.inject({ url: '/api/v1/articles', headers: { 'x-api-key': 'valid' } })).statusCode).toBe(200);
    const denied = await app.inject({ url: '/api/v1/articles', headers: { 'x-api-key': 'valid' } });
    expect(denied.statusCode).toBe(429);
    expect(denied.headers['x-ratelimit-limit']).toBe('1000');
    expect(denied.headers['cache-control']).toBe('private, no-store');
    expect((await app.inject({ url: '/api/v1/articles', headers: { 'x-api-key': 'second' } })).statusCode).toBe(200);
    await app.close();
  });
  it('does not downgrade invalid keys; preflight skips quota and authentication', async () => {
    const { app, identify } = await fixture();
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/v1/articles', headers: { 'x-api-key': 'bad' } });
    expect(preflight.statusCode).toBe(204);
    expect(identify).not.toHaveBeenCalled();
    expect(preflight.headers['access-control-allow-headers']).toContain('x-api-key');
    for (let i = 0; i < 60; i++)
      expect((await app.inject({ url: '/api/v1/articles', headers: { 'x-api-key': 'bad' } })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/articles', headers: { 'x-api-key': 'bad' } })).statusCode).toBe(429);
    await app.close();
  });
  it('keeps anonymous reads public, credentials/cookies private, errors uncached, HEAD bodyless', async () => {
    const { app } = await fixture();
    expect((await app.inject('/api/v1/articles')).headers['cache-control']).toContain('s-maxage=120');
    for (const headers of [{ 'x-api-key': 'valid' }, { authorization: 'Bearer irrelevant' }, { cookie: 'blog_session=fake' }]) {
      expect((await app.inject({ url: '/api/v1/articles', headers })).headers['cache-control']).toBe('private, no-store');
    }
    const head = await app.inject({ url: '/api/v1/articles', method: 'HEAD' });
    expect(head.body).toBe('');
    expect((await app.inject('/api/v1/fail')).headers['cache-control']).toBe('no-store');
    expect((await app.inject('/api/v1x')).headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
  it('caps failed database lookups and parallel cold-key admission before more SQL', async () => {
    const app = Fastify();
    const identify = vi.fn(async () => {
      throw Error('driver detail must not escape');
    });
    installPublicApiPolicy(app, { identify });
    app.get('/api/v1/articles', async () => ({ items: [] }));
    for (let i = 0; i < 60; i++)
      expect((await app.inject({ url: '/api/v1/articles', headers: { 'x-api-key': `bad${i}` } })).statusCode).toBe(503);
    expect((await app.inject({ url: '/api/v1/articles', headers: { 'x-api-key': 'last' } })).statusCode).toBe(429);
    expect(identify).toHaveBeenCalledTimes(60);
    await app.close();
    const concurrent = Fastify();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const lookup = vi.fn(async () => {
      await gate;
      return null;
    });
    installPublicApiPolicy(concurrent, { identify: lookup });
    concurrent.get('/api/v1/articles', async () => ({ items: [] }));
    await concurrent.ready();
    const requests = Array.from({ length: 80 }, (_, i) =>
      concurrent.inject({ url: '/api/v1/articles', headers: { 'x-api-key': `invalid${i}` } }),
    );
    await new Promise((r) => setTimeout(r, 15));
    release();
    const results = await Promise.all(requests);
    expect(lookup).toHaveBeenCalledTimes(60);
    expect(results.filter((r) => r.statusCode === 429)).toHaveLength(20);
    await concurrent.close();
  });
  it('ignores forged Cloudflare addresses on non-loopback sockets', async () => {
    const { app } = await fixture();
    for (let i = 0; i < 60; i++)
      expect(
        (
          await app.inject({
            url: '/api/v1/articles',
            remoteAddress: '198.51.100.8',
            headers: { 'cf-connecting-ip': `203.0.113.${i + 1}` },
          })
        ).statusCode,
      ).toBe(200);
    const denied = await app.inject({
      url: '/api/v1/articles',
      remoteAddress: '198.51.100.8',
      headers: { 'cf-connecting-ip': '192.0.2.19' },
    });
    expect(denied.statusCode).toBe(429);
    await app.close();
  });
});
