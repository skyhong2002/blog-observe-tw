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
});
