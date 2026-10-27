import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { type AdminOptions, adminPath, csrfToken, installAdminGuard, validCsrf } from './guard.ts';
import { bootstrapAdmin, isAdmin } from './identity.ts';

const origin = 'https://weblog.tw',
  secret = 'test-only-secret'.repeat(4);
describe('admin identity and path boundary', () => {
  it('rejects encoded/double encoded/case/dot ambiguous admin paths, not adminx', () => {
    for (const path of [
      '/%61dmin',
      '/%2561dmin',
      '/api/%2561dmin',
      '//admin',
      '/admin%2f..',
      '/ADMIN',
      '/Admin',
      '/API/admin',
      '/foo/../admin',
      '/admin;other',
      '/admin/../blogs',
    ])
      expect(adminPath(path), path).toBe('invalid');
    expect(adminPath('/adminx')).toBe('none');
    expect(adminPath('/admin/discovery?x=1')).toBe('ui');
    expect(adminPath('/api/admin/session')).toBe('api');
  });
  it('CSRF binds exact session and configured Origin, rejects nonASCII safely', () => {
    const config = { publicOrigin: origin, sessionSecret: secret } as AdminOptions;
    const req = (token: string, cookie = 'a', requestOrigin = origin) =>
      ({
        headers: { cookie: `blog_session=${cookie}`, origin: requestOrigin, 'x-blog-csrf': token, 'x-forwarded-host': 'evil.test' },
      }) as unknown as FastifyRequest;
    const token = csrfToken('a', secret);
    expect(validCsrf(req(token), config)).toBe(true);
    expect(validCsrf(req(token, 'b'), config)).toBe(false);
    expect(validCsrf(req('文'.repeat(43)), config)).toBe(false);
    expect(validCsrf(req(token, 'a', 'https://evil.test'), config)).toBe(false);
  });
  it('same email cannot replace a pinned Google sub or authorize a revoked/removed account', async () => {
    let row = { role: 'admin', google_sub: 'pinned', pinned_sub: 'pinned', pinned_email: 'fixture@example.com' };
    const pool = { query: async () => [[row]] } as unknown as Pool;
    const emails = new Set(['fixture@example.com']);
    expect(await isAdmin(pool, { id: 1, sub: 'pinned' }, emails)).toBe(true);
    expect(await isAdmin(pool, { id: 1, sub: 'other' }, emails)).toBe(false);
    row = { ...row, role: 'reader' };
    expect(await isAdmin(pool, { id: 1, sub: 'pinned' }, emails)).toBe(false);
    row = { ...row, role: 'admin' };
    expect(await isAdmin(pool, { id: 1, sub: 'pinned' }, new Set())).toBe(false);
  });
  it('existing permanent pin never regrants a revoked role during login', async () => {
    const c = {
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
      query: async () => [[{ google_sub: 'pinned', role: 'reader' }]],
      execute: vi.fn(async (_sql: string) => [{ affectedRows: 0 }]),
    };
    await bootstrapAdmin(
      { getConnection: async () => c } as unknown as Pool,
      1,
      { sub: 'pinned', email: 'fixture@example.com', name: null, picture: null, emailVerified: true },
      new Set(['fixture@example.com']),
      new Date(),
    );
    expect(c.execute).toHaveBeenCalledTimes(1);
    expect(c.execute.mock.calls[0][0]).not.toContain('UPDATE users');
  });
  it('UI redirects anonymous, API denies, nonadmin403, mutation requires CSRF, all no-store', async () => {
    const app = Fastify();
    let user: { id: number; sub: string; email: string; name: null; picture: null } | null = null;
    let role = 'admin';
    const pool = {
      query: async () => [[{ role, google_sub: 'pin', pinned_sub: 'pin', pinned_email: 'fixture@example.com' }]],
    } as unknown as Pool;
    installAdminGuard(app, {
      pool,
      publicOrigin: origin,
      sessionSecret: secret,
      adminEmails: new Set(['fixture@example.com']),
      login: { currentUser: async () => user },
    });
    app.get('/admin', async () => ({ ok: true }));
    app.get('/api/admin/session', async () => ({ ok: true }));
    app.post('/api/admin/test', async () => ({ ok: true }));
    expect((await app.inject('/admin')).statusCode).toBe(302);
    expect((await app.inject('/api/admin/session')).statusCode).toBe(401);
    user = { id: 1, sub: 'pin', email: 'changed@example.com', name: null, picture: null };
    role = 'reader';
    expect((await app.inject('/admin')).statusCode).toBe(403);
    role = 'admin';
    const response = await app.inject('/api/admin/session');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect((await app.inject({ method: 'POST', url: '/api/admin/test' })).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/admin/test',
          headers: { cookie: 'blog_session=abc', origin, 'x-blog-csrf': csrfToken('abc', secret) },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });
  it('unverified identity cannot bootstrap even an allowlisted email', async () => {
    const pool = { getConnection: vi.fn() } as unknown as Pool;
    await bootstrapAdmin(
      pool,
      1,
      { sub: 'pinned', email: 'fixture@example.com', name: null, picture: null },
      new Set(['fixture@example.com']),
      new Date(),
    );
    expect(pool.getConnection).not.toHaveBeenCalled();
  });
});
