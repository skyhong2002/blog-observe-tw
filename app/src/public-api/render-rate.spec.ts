import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { describe, expect, it } from 'vitest';
import { registerFavicons } from '../v1/favicon-routes.ts';
import { gatewayRateKey, gatewayRateMax, internalRenderRead } from './client-ip.ts';

function request(url = '/api/overview', headers = {}, remoteAddress = '127.0.0.1', method = 'GET') {
  return { url, headers, method, ip: remoteAddress, raw: { socket: { remoteAddress } } } as FastifyRequest;
}
describe('server render rate bucket isolation', () => {
  it('does not charge static favicon loads against dynamic requests', async () => {
    const app = Fastify();
    await app.register(rateLimit, { global: true, max: 2, timeWindow: '1 minute' });
    registerFavicons(app);
    app.get('/dynamic', async () => ({ ok: true }));
    try {
      for (let i = 0; i < 8; i++) {
        const icon = await app.inject('/favicons/rate-fixture-not-present.png');
        expect(icon.statusCode).toBe(404);
        expect(icon.headers['x-ratelimit-remaining']).toBeUndefined();
      }
      expect((await app.inject('/favicons/..%2Fprivate.png')).statusCode).toBe(404);
      expect((await app.inject('/dynamic')).statusCode).toBe(200);
      expect((await app.inject('/dynamic')).statusCode).toBe(200);
      expect((await app.inject('/dynamic')).statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
  it('keeps an explicit limit for direct anonymous public-data rendering', () => {
    const r = request('/api/topics/example?days=90');
    expect(internalRenderRead(r)).toBe(true);
    expect(gatewayRateMax(r)).toBe(2000);
    expect(gatewayRateKey(r)).toBe('internal-render-read');
  });
  it.each([
    'cf-connecting-ip',
    'x-real-ip',
    'true-client-ip',
    'x-forwarded-port',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'forwarded',
    'cookie',
    'authorization',
    'x-api-key',
    'x-service-token',
  ])('does not trust a forwarded or credentialed request with %s', (header) => {
    const r = request('/api/overview', { [header]: '203.0.113.5' });
    expect(internalRenderRead(r)).toBe(false);
    expect(gatewayRateMax(r)).toBe(240);
  });
  it.each([
    '/api/v1/articles',
    '/api/admin/discovery',
    '/auth/google',
    '/api/me/follows',
    '/api/blogs/example/follow',
    '//api/overview',
    '/api/%61dmin',
  ])('does not widen protected or unrelated route %s', (path) => expect(internalRenderRead(request(path))).toBe(false));
  it('rejects non-loopback sockets and writes', () => {
    expect(internalRenderRead(request('/api/overview', {}, '203.0.113.7'))).toBe(false);
    expect(internalRenderRead(request('/api/overview', {}, '127.0.0.1', 'POST'))).toBe(false);
    expect(internalRenderRead(request('/api/overview?q=example', {}, '127.0.0.1', 'HEAD'))).toBe(true);
    expect(internalRenderRead(request('/api/%6fverview'))).toBe(false);
    expect(internalRenderRead(request('/api/topics/x%2f..%2fadmin'))).toBe(true); // A topic parameter, never an admin route.
  });
});
