import { Readable } from 'node:stream';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { installPrivateCachePolicy, privateCachePath } from './cache-policy.ts';
import { createUiProxy } from './ui-proxy.js';

describe('private route cache boundaries', () => {
  it.each([
    '/my/',
    '/my',
    '/auth/me',
    '/api/me/follows',
    '/me/feed.xml',
    '/me/opml',
    '/admin/',
    '/api/admin/audit',
    '/login?error=failed',
    '/api/blogs/a/follow',
    '/%6dy/',
    '/%256dy/',
    '/api%2fme/follows',
    '/articles/../my/',
    '/articles/%2e%2e/me/feed.xml',
    '/MY/',
    '/my;variant',
    '/my\\child',
    '/%25252525256dy/',
  ])('protects %s', (path) => expect(privateCachePath(path)).toBe(true));
  it.each([
    '/',
    '/articles/?q=/my/',
    '/blogs/?next=/admin',
    '/api/topics?days=30',
    '/myth/',
    '/media/',
    '/blogs/my-site/',
    '/%E9%83%A8%E8%90%BD%E6%A0%BC/',
  ])('keeps public cache policy on %s', (path) => expect(privateCachePath(path)).toBe(false));
  it('overrides upstream cache for private UI including 401/403/503 and preserves public ISR/RSC transport', async () => {
    const request = vi.fn(async (_url: URL, _options: { headers: Record<string, string> }) => ({
      statusCode: 200,
      headers: {
        'cache-control': 's-maxage=300, stale-while-revalidate=60',
        vary: 'RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url, Accept-Encoding',
        'cdn-cache-control': 'max-age=999',
        'surrogate-control': 'max-age=999',
      },
      body: Readable.from(['fixture']),
    }));
    const app = Fastify();
    installPrivateCachePolicy(app);
    // @ts-expect-error Test stream implements the response shape used by the proxy.
    const proxy = createUiProxy('http://127.0.0.1:18162', { request });
    app.get('/my/', proxy);
    app.get('/articles/', proxy);
    for (const status of [401, 403, 503])
      app.get(`/api/me/status-${status}`, async (_req, reply) =>
        reply.code(status).header('cache-control', 'public,max-age=300').send({ error: 'fixture' }),
      );
    try {
      const privateResponse = await app.inject('/my/');
      expect(privateResponse.headers['cache-control']).toBe('private, no-store');
      expect(privateResponse.headers['cdn-cache-control']).toBeUndefined();
      expect(privateResponse.headers['surrogate-control']).toBeUndefined();
      for (const status of [401, 403, 503]) {
        const r = await app.inject(`/api/me/status-${status}`);
        expect(r.statusCode).toBe(status);
        expect(r.headers['cache-control']).toBe('private, no-store');
      }
      const url = '/articles/?q=a%26b&_rsc=variant';
      const publicResponse = await app.inject({ url, headers: { rsc: '1', 'next-router-state-tree': 'fixture-state' } });
      expect(publicResponse.headers['cache-control']).toBe('s-maxage=300, stale-while-revalidate=60');
      expect(publicResponse.headers.vary).toBe(
        'RSC, Next-Router-State-Tree, Next-Router-Prefetch, Next-Router-Segment-Prefetch, Next-Url, Accept-Encoding',
      );
      const call = request.mock.calls.at(-1)!;
      expect(String(call[0])).toBe('http://127.0.0.1:18162' + url);
      expect(call[1].headers).toMatchObject({ rsc: '1', 'next-router-state-tree': 'fixture-state' });
    } finally {
      await app.close();
    }
  });
  it('never shares API or sitemap results even when route hooks set CDN overrides', async () => {
    const app = Fastify();
    installPrivateCachePolicy(app);
    for (const path of [
      '/api/catalog',
      '/api/overview',
      '/api/topics',
      '/api/v1/blogs',
      '/api/pages/blogs/a',
      '/sitemap.xml',
      '/sitemaps/topics.xml',
    ]) {
      app.get(
        path,
        {
          onSend: async (_request, reply, payload) => {
            reply.header('cache-control', 'public, s-maxage=300').header('cloudflare-cdn-cache-control', 'max-age=900');
            return payload;
          },
        },
        async () => ({ ok: true }),
      );
    }
    try {
      for (const url of [
        '/api/catalog',
        '/api/overview',
        '/api/topics',
        '/api/v1/blogs',
        '/api/pages/blogs/a',
        '/sitemap.xml',
        '/sitemaps/topics.xml',
      ]) {
        const response = await app.inject(url);
        expect(response.headers['cache-control'], url).toBe('no-store');
        expect(response.headers['cloudflare-cdn-cache-control'], url).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });
  it('forces Set-Cookie responses private even on public paths', async () => {
    const request = async () => ({
      statusCode: 200,
      headers: {
        'cache-control': 'public,s-maxage=300',
        'cdn-cache-control': 'max-age=999',
        vary: 'RSC, Accept-Encoding',
        'set-cookie': 'fixture_cookie=1; HttpOnly; Secure; SameSite=Lax',
      },
      body: Readable.from(['fixture']),
    });
    const app = Fastify();
    installPrivateCachePolicy(app);
    // @ts-expect-error Fixed upstream stream test double.
    app.get('/articles/', createUiProxy('http://127.0.0.1:18162', { request }));
    try {
      const r = await app.inject('/articles/');
      expect(r.headers['cache-control']).toBe('private, no-store');
      expect(r.headers['cdn-cache-control']).toBeUndefined();
      expect(r.headers.vary).toBe('RSC, Accept-Encoding');
      expect(r.headers['set-cookie']).toBe('fixture_cookie=1; HttpOnly; Secure; SameSite=Lax');
    } finally {
      await app.close();
    }
  });
  it('wins after plugin and route-level onSend hooks, including non-GET responses', async () => {
    const app = Fastify();
    installPrivateCachePolicy(app);
    await app.register(async (plugin) => {
      plugin.addHook('onSend', async (_req, reply, payload) => {
        reply.header('cache-control', 'public,max-age=100');
        return payload;
      });
      const onSend = async (_req: unknown, reply: import('fastify').FastifyReply, payload: unknown) => {
        reply.header('cache-control', 'public,max-age=200').header('cdn-cache-control', 'max-age=200');
        return payload;
      };
      plugin.get('/me/opml', { onSend }, async () => ({ private: 'fixture' }));
      plugin.post('/public-action', { onSend }, async () => ({ ok: true }));
      plugin.get('/public-cookie', { onSend }, async (_req, reply) => reply.header('set-cookie', 'fixture=1').send({ ok: true }));
    });
    try {
      for (const [method, url] of [
        ['GET', '/me/opml'],
        ['POST', '/public-action'],
        ['GET', '/public-cookie'],
      ] as const) {
        const r = await app.inject({ method, url });
        expect(r.statusCode).toBe(200);
        expect(r.headers['cache-control']).toBe('private, no-store');
        expect(r.headers['cdn-cache-control']).toBeUndefined();
      }
    } finally {
      await app.close();
    }
  });
  it('keeps authenticated reader payloads private through the actual gateway', async () => {
    const user = { id: 7, sub: 'fixture-reader', role: 'reader', email: 'reader@example.invalid', name: 'Reader', picture: null };
    const db = {
      select() {
        return this;
      },
      from() {
        return this;
      },
      innerJoin() {
        return this;
      },
      where: async () => [user],
    };
    const pool = {
      query: async (sql: string) =>
        sql.includes('FROM posts p JOIN blogs b ON b.id=p.blog_id JOIN user_follows')
          ? [[{ title: 'PRIVATE_READER_POST', url: 'https://fixture.example/post', summary: '私有閱讀摘要' }]]
          : sql.includes('FROM user_follows f JOIN blogs')
            ? [[{ slug: 'fixture', name: 'PRIVATE_READER_FOLLOW', url: 'https://fixture.example/' }]]
            : [[]],
    };
    const app = await buildApp(
      {
        port: 18165,
        uiOrigin: 'http://127.0.0.1:1',
        publicOrigin: 'https://weblog.tw',
        adminEmails: new Set(),
        login: {
          clientId: 'fixture',
          clientSecret: 'fixture',
          sessionSecret: 'fixture-only-secret-01234567890123456789',
          origin: 'https://weblog.tw',
        },
      },
      // @ts-expect-error Fixed test database adapter implements only the session/read queries used here.
      { store: { pool, db } },
    );
    try {
      for (const [url, marker] of [
        ['/api/me/follows', 'PRIVATE_READER_FOLLOW'],
        ['/me/feed.xml', 'PRIVATE_READER_POST'],
      ]) {
        const r = await app.inject({ url, headers: { cookie: 'blog_session=fixture-reader-token' } });
        expect(r.statusCode, r.body).toBe(200);
        expect(r.body).toContain(marker);
        expect(r.headers['cache-control']).toBe('private, no-store');
      }
      const mutation = await app.inject({ method: 'POST', url: '/articles/' });
      expect(mutation.statusCode).toBe(404);
      expect(mutation.headers['cache-control'] ?? '').not.toContain('s-maxage');
    } finally {
      await app.close();
    }
  });
  it('sets no-store on real anonymous reader routes and leaves public API policy intact', async () => {
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165 },
      // @ts-expect-error JS gateway's injected store default is inferred as null.
      { store: { pool: { query: async () => [[]] } } },
    );
    const warnings = vi.spyOn(app.log, 'warn');
    try {
      for (const url of ['/api/me/follows', '/me/feed.xml', '/me/opml', '/me/feed.xml?_rsc=reader-prefetch']) {
        const r = await app.inject(url);
        expect(r.statusCode).toBe(401);
        expect(r.headers['cache-control']).toBe('private, no-store');
      }
      expect(warnings.mock.calls.flat().map(String).join(' ')).not.toContain('already sent');
      expect((await app.inject('/auth/me')).headers['cache-control']).toBe('private, no-store');
      expect((await app.inject('/api/topics?days=1')).headers['cache-control']).toBe('no-store');
    } finally {
      await app.close();
    }
  });
});
