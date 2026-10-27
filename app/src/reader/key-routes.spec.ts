import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../auth/google-login.ts';
import { ApiKeyError } from './api-keys.ts';
import { apiKeyCsrfToken, registerApiKeyRoutes } from './key-routes.ts';

const secret = 'test-api-session-secret-with-32-characters';
const session = 'test-cookie-token';
const origin = 'https://weblog.tw';
const user: SessionUser = { id: 1, sub: 'google-test-sub', email: 'reader@example.test', name: null, picture: null };
const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});
function setup(signedIn = true) {
  const app = Fastify();
  apps.push(app);
  const keys = {
    identify: vi.fn(),
    isCachedValid: vi.fn().mockReturnValue(false),
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ key: 'one-time-secret', keys: [], max: 3 }),
    revoke: vi.fn().mockResolvedValue(undefined),
  };
  registerApiKeyRoutes(app, {
    pool: {} as Pool,
    login: { currentUser: async () => (signedIn ? user : null) },
    keys,
    publicOrigin: origin,
    sessionSecret: secret,
  });
  return { app, keys };
}
const headers = { cookie: `blog_session=${session}`, origin, 'x-blog-csrf': apiKeyCsrfToken(session, secret) };
describe('personal API key management session boundary', () => {
  it('requires a login for every operation; API key does not authenticate', async () => {
    const { app, keys } = setup(false);
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/auth/me/api-keys${method === 'DELETE' ? '/1' : ''}`,
        headers: { 'x-api-key': `blog_${'a'.repeat(32)}` },
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
      expect(response.headers['cache-control']).toBe('private, no-store');
    }
    expect(keys.create).not.toHaveBeenCalled();
    expect(keys.revoke).not.toHaveBeenCalled();
  });
  it('provides a session-bound CSRF token without CORS or public caching', async () => {
    const { app } = setup();
    const response = await app.inject({ url: '/auth/me/api-keys', headers });
    expect(response.json()).toEqual({ keys: [], max: 3, csrfToken: headers['x-blog-csrf'] });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(apiKeyCsrfToken('different-session', secret)).not.toBe(headers['x-blog-csrf']);
  });
  it('rejects missing Origin, foreign Origin, missing token and another session token', async () => {
    const { app, keys } = setup();
    for (const bad of [
      { cookie: headers.cookie, 'x-blog-csrf': headers['x-blog-csrf'] },
      { ...headers, origin: 'https://evil.test' },
      { cookie: headers.cookie, origin },
      { ...headers, 'x-blog-csrf': apiKeyCsrfToken('other', secret) },
    ]) {
      for (const method of ['POST', 'DELETE'] as const) {
        const response = await app.inject({
          method,
          url: `/auth/me/api-keys${method === 'DELETE' ? '/1' : ''}`,
          headers: bad,
          ...(method === 'POST' ? { payload: {} } : {}),
        });
        expect(response.statusCode).toBe(403);
      }
    }
    expect(keys.create).not.toHaveBeenCalled();
    expect(keys.revoke).not.toHaveBeenCalled();
  });
  it('returns the full key once on creation and 204 on owner-scoped revocation', async () => {
    const { app, keys } = setup();
    const created = await app.inject({ method: 'POST', url: '/auth/me/api-keys', headers, payload: { label: '我的程式' } });
    expect(created.statusCode).toBe(201);
    expect(created.json().key).toBe('one-time-secret');
    expect(keys.create).toHaveBeenCalledWith(1, '我的程式');
    const removed = await app.inject({ method: 'DELETE', url: '/auth/me/api-keys/3', headers });
    expect(removed.statusCode).toBe(204);
    expect(removed.body).toBe('');
    expect(keys.revoke).toHaveBeenCalledWith(1, 3);
    expect((await app.inject({ url: '/auth/me/api-keys', headers })).body).not.toContain('one-time-secret');
  });
  it('never exposes or logs database driver errors on management routes', async () => {
    const { app, keys } = setup();
    const error = new Error('SQL failure containing private-driver-detail');
    keys.list.mockRejectedValueOnce(error);
    keys.create.mockRejectedValueOnce(error);
    keys.revoke.mockRejectedValueOnce(error);
    for (const method of ['GET', 'POST', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/auth/me/api-keys${method === 'DELETE' ? '/1' : ''}`,
        headers,
        ...(method === 'POST' ? { payload: {} } : {}),
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ error: 'unavailable' });
      expect(response.body).not.toContain('private-driver-detail');
    }
  });
  it('normalizes quota and ownership failures, rejecting unexpected bodies', async () => {
    const { app, keys } = setup();
    keys.create.mockRejectedValueOnce(new ApiKeyError('key_limit', 409));
    const limited = await app.inject({ method: 'POST', url: '/auth/me/api-keys', headers, payload: {} });
    expect(limited.statusCode).toBe(409);
    expect(limited.json()).toEqual({ error: 'key_limit' });
    keys.revoke.mockRejectedValueOnce(new ApiKeyError('not_found', 404));
    expect((await app.inject({ method: 'DELETE', url: '/auth/me/api-keys/99', headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/auth/me/api-keys', headers, payload: { userId: 2 } })).statusCode).toBe(400);
  });
});
