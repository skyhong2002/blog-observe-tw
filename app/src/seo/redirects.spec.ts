import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./page-routes.ts', async (original) => ({ ...(await original<typeof import('./page-routes.ts')>()), resolvePublicPage: vi.fn() }));

import { resolvePublicPage } from './page-routes.ts';
import { createPublicPageRedirect, publicPageRequest } from './redirects.ts';

afterEach(() => vi.clearAllMocks());
describe('canonical public page redirects', () => {
  it('decodes once and rejects authority, slash, backslash, control and ambiguous keys', () => {
    expect(publicPageRequest('/topics/%E7%BE%8E%E9%A3%9F/?days=90')).toEqual({
      kind: 'topic',
      key: '美食',
      path: '/topics/%E7%BE%8E%E9%A3%9F/',
      query: '?days=90',
    });
    for (const path of [
      '//evil/topics/x',
      '/\\evil',
      'https://evil/topics/x',
      '/blogs/%2f%2fevil/',
      '/blogs/%252f%252fevil/',
      '/blogs/x%0d%0a/',
      '/blogs/../',
      '/blogs/a/b/',
      '/api/blogs/x',
      '/blogs/x#fragment',
    ])
      expect(publicPageRequest(path)).toBeNull();
  });
  it('keeps query, uses only a stored local path, supports HEAD and leaves canonical/API alone', async () => {
    vi.mocked(resolvePublicPage).mockResolvedValue({
      entityId: '1',
      stableId: 'discovered-abc',
      slug: 'skyhong.tw',
      canonicalPath: '/blogs/skyhong.tw/',
    });
    const app = Fastify();
    const redirect = createPublicPageRedirect({} as Pool);
    app.get('/*', async (req, reply) => {
      if (await redirect(req, reply)) return;
      return { ok: true };
    });
    const old = await app.inject('/blogs/discovered-abc/?page=2');
    expect(old.statusCode).toBe(301);
    expect(old.headers.location).toBe('/blogs/skyhong.tw/?page=2');
    expect((await app.inject({ method: 'HEAD', url: '/blogs/discovered-abc/' })).statusCode).toBe(301);
    expect((await app.inject('/blogs/skyhong.tw/')).statusCode).toBe(200);
    expect((await app.inject('/api/blogs/discovered-abc')).statusCode).toBe(200);
    await app.close();
  });
  it('leaves unknown routes for genuine UI 404', async () => {
    vi.mocked(resolvePublicPage).mockResolvedValue(null);
    const app = Fastify();
    const redirect = createPublicPageRedirect({} as Pool);
    app.get('/*', async (req, reply) => {
      if (await redirect(req, reply)) return;
      return reply.code(404).send({ error: 'not_found' });
    });
    expect((await app.inject('/topics/missing/')).statusCode).toBe(404);
    await app.close();
  });
  it('redirects a legacy topic hash directly to its encoded readable canonical', async () => {
    const hash = 'a'.repeat(64),
      path = '/topics/%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7/';
    vi.mocked(resolvePublicPage).mockResolvedValue({ entityId: hash, stableId: `tag:${hash}`, slug: '人工智慧', canonicalPath: path });
    const app = Fastify(),
      redirect = createPublicPageRedirect({} as Pool);
    app.get('/*', async (req, reply) => {
      if (await redirect(req, reply)) return;
      return { ok: true };
    });
    for (const key of [`tag:${hash}`, `tag%3A${hash}`]) {
      const response = await app.inject(`/topics/${key}/?days=90`);
      expect(response.statusCode).toBe(301);
      expect(response.headers.location).toBe(`${path}?days=90`);
    }
    expect((await app.inject(path)).statusCode).toBe(200);
    await app.close();
  });
  it('keeps permanent redirects but renders canonical GET/HEAD using stable IDs only in rollback mode', async () => {
    const hash = 'a'.repeat(64),
      canonical = '/topics/%E7%BE%8E%E9%A3%9F/';
    vi.mocked(resolvePublicPage).mockImplementation(async (_pool, kind) =>
      kind === 'topic'
        ? { entityId: hash, stableId: `tag:${hash}`, slug: '美食', canonicalPath: canonical }
        : { entityId: '1', stableId: 'discovered-abc', slug: 'skyhong.tw', canonicalPath: '/blogs/skyhong.tw/' },
    );
    const app = Fastify(),
      redirect = createPublicPageRedirect({} as Pool, { legacyUiPaths: true });
    app.get('/*', async (req, reply) => {
      if (await redirect(req, reply)) return;
      return { upstream: redirect.uiPath(req) ?? null, original: req.raw.url };
    });
    const query = '?q=%E8%87%BA%E7%81%A3&next=%2Fmy%3Fx%3D1';
    const topic = await app.inject(canonical + query);
    expect(topic.json()).toEqual({ upstream: `/topics/tag%3A${hash}/${query}`, original: canonical + query });
    expect(topic.headers.location).toBeUndefined();
    expect((await app.inject('/blogs/skyhong.tw/?page=2')).json().upstream).toBe('/blogs/discovered-abc/?page=2');
    const old = await app.inject(`/topics/tag%3A${hash}/${query}`);
    expect(old.statusCode).toBe(301);
    expect(old.headers.location).toBe(canonical + query);
    expect((await app.inject({ method: 'HEAD', url: canonical })).statusCode).toBe(200);
    expect((await app.inject('/api/topics/x')).json().upstream).toBeNull();
    for (const path of ['/blogs/%2F%2Fevil/', '/blogs/%252F%252Fevil/', '/topics/%E0%A4/']) {
      const calls = vi.mocked(resolvePublicPage).mock.calls.length;
      await app.inject(path);
      expect(vi.mocked(resolvePublicPage).mock.calls.length).toBe(calls);
    }
    await app.close();
  });
  it('does not activate legacy upstream paths by default', async () => {
    vi.mocked(resolvePublicPage).mockResolvedValue({
      entityId: '1',
      stableId: 'discovered-abc',
      slug: 'skyhong.tw',
      canonicalPath: '/blogs/skyhong.tw/',
    });
    const app = Fastify(),
      redirect = createPublicPageRedirect({} as Pool);
    app.get('/*', async (req, reply) => {
      if (await redirect(req, reply)) return;
      return { upstream: redirect.uiPath(req) ?? null };
    });
    expect((await app.inject('/blogs/skyhong.tw/')).json().upstream).toBeNull();
    await app.close();
  });
});
