import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerPublicApi } from '../v1/routes.ts';
import { PUBLIC_PATHS } from './contract.ts';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
function setup(query = vi.fn().mockResolvedValue([[]])) {
  const app = Fastify({ exposeHeadRoutes: true });
  apps.push(app);
  registerPublicApi(app, { query } as unknown as Pool);
  return { app, query };
}
describe('public v1 route privacy and input bounds', () => {
  it('registers every promised data route and an automatic HEAD', async () => {
    const { app } = setup();
    await app.ready();
    for (const path of PUBLIC_PATHS.filter((p) => !p.endsWith('openapi.json'))) {
      expect(app.hasRoute({ method: 'GET', url: path })).toBe(true);
      expect(app.hasRoute({ method: 'HEAD', url: path })).toBe(true);
    }
    const res = await app.inject({ method: 'HEAD', url: '/api/v1/articles' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('rejects malformed/repeated filters before issuing SQL', async () => {
    const { app, query } = setup();
    for (const url of [
      '/api/v1/articles?limit=0',
      '/api/v1/articles?limit=1&limit=2',
      '/api/v1/articles?unknown=x',
      '/api/v1/articles?cursor=invalid',
      '/api/v1/blogs?limit=201',
      '/api/v1/relations?hours=24',
      '/api/v1/topics?cursor=anything',
      '/api/v1/topics/bad',
      '/api/v1/blogs/a%2Fb/articles',
    ]) {
      const res = await app.inject(url);
      expect(res.statusCode, url).toBe(400);
      expect(res.json()).toHaveProperty('error');
      expect(res.headers['cache-control']).toContain('no-store');
    }
    expect(query).not.toHaveBeenCalled();
  });
  it('returns only a sanitized short article allowlist, never raw joined data', async () => {
    const now = new Date();
    const { app, query } = setup(
      vi.fn().mockResolvedValue([
        [
          {
            id: 1,
            title: 'Public',
            url: 'https://example.com/a',
            summary: '<script>secret()</script>' + '字'.repeat(900),
            publishedAt: now,
            updatedAt: null,
            observedAt: now,
            blogSlug: 'sample',
            blogName: 'Sample',
            sortAt: now,
            body: 'PRIVATE BODY',
            session_token: 'PRIVATE SESSION',
            source_values: { secret: true },
          },
        ],
      ]),
    );
    const res = await app.inject('/api/v1/articles?limit=1');
    expect(res.statusCode).toBe(200);
    const item = res.json().items[0];
    expect(Array.from(item.summary).length).toBe(500);
    expect(item.publishedAt).toBe(now.toISOString());
    expect(item.observedAt).toBe(now.toISOString());
    expect(item).not.toHaveProperty('sortAt');
    expect(res.body).not.toContain('PRIVATE');
    expect(res.body).not.toContain('secret()');
    expect(query.mock.calls[0][0]).toContain("b.status='verified'");
    expect(query.mock.calls[0][0]).not.toContain('post_bodies');
  });
  it('retains unknown publication date and keys pagination with stable timestamp plus ID', async () => {
    const at = new Date();
    const query = vi.fn().mockResolvedValue([
      [
        { id: 2, title: 'Two', summary: '', publishedAt: null, observedAt: at, blogSlug: 'a', sortAt: at },
        { id: 1, title: 'One', summary: '', publishedAt: null, observedAt: at, blogSlug: 'a', sortAt: at },
      ],
    ]);
    const { app } = setup(query),
      first = await app.inject('/api/v1/articles?limit=1');
    const dto = first.json();
    expect(dto.items[0].publishedAt).toBeNull();
    expect(dto.nextCursor).toBeTypeOf('string');
    query.mockResolvedValue([[]]);
    const next = await app.inject(`/api/v1/articles?limit=1&cursor=${dto.nextCursor}`);
    expect(next.statusCode).toBe(200);
    expect(next.json().window).toEqual(dto.window);
    expect(query.mock.calls[1][0]).toContain('p.id<?');
    expect(query.mock.calls[1][1].at(-1)).toBe(2);
  });
  it('does not reveal nonverified profile, articles or relations', async () => {
    const { app, query } = setup();
    for (const path of ['', '/articles', '/relations']) {
      const res = await app.inject(`/api/v1/blogs/seed${path}`);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
    for (const call of query.mock.calls) expect(call[0]).toContain("b.status='verified'");
  });
  it('single-flights concurrent public reads but refreshes subsequent HEAD', async () => {
    const { app, query } = setup(
      vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [[]];
      }),
    );
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => app.inject(i % 2 ? '/api/v1/articles?limit=50&hours=720' : '/api/v1/articles')),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const window = responses[0].json().window;
    expect(responses.every((r) => JSON.stringify(r.json().window) === JSON.stringify(window))).toBe(true);
    const head = await app.inject({ method: 'HEAD', url: '/api/v1/articles' });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('normalizes unexpected SQL errors without disclosing database text', async () => {
    const { app } = setup(vi.fn().mockRejectedValue(new Error('SQL password SELECT secret')));
    const res = await app.inject('/api/v1/blogs');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'unavailable' });
    expect(res.body).not.toContain('SQL');
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
