import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerBlogGenreRoutes } from './routes.ts';

describe('retired blog tag write routes', () => {
  it("answer 410 with the blog's site.observe.tw page, signed in or not, and call nothing else", async () => {
    const queries: unknown[] = [];
    const app = Fastify();
    registerBlogGenreRoutes(app, {
      pool: {
        query: async (_sql: string, args: unknown[]) => {
          queries.push(args);
          return [args[0] === 'a' ? [{ host: 'www.a.blog.tw' }] : []];
        },
      } as never,
    });
    await app.ready();
    try {
      for (const request of [
        { method: 'GET' as const, url: '/api/me/blog-genres/a' },
        { method: 'POST' as const, url: '/api/blogs/a/genres/propose', payload: { genre: '咖啡' } },
        { method: 'PUT' as const, url: '/api/blogs/a/genres/food/vote', payload: { vote: 1 } },
        { method: 'PUT' as const, url: '/api/blogs/a/genres/food/admin', payload: { action: 'set' } },
      ]) {
        const response = await app.inject(request);
        expect(response.statusCode).toBe(410);
        expect(response.json()).toEqual({ error: 'tags_moved', url: 'https://site.observe.tw/site/a.blog.tw/#tags' });
      }
      const unknown = await app.inject({ method: 'PUT', url: '/api/blogs/zz/genres/food/vote', payload: { vote: 1 } });
      expect(unknown.json()).toEqual({ error: 'tags_moved', url: 'https://site.observe.tw/' });
      expect(queries).toHaveLength(5);
    } finally {
      await app.close();
    }
  });
});
