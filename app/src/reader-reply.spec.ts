import type { FastifyInstance } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./cache-policy.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./cache-policy.ts')>();
  return {
    ...original,
    installPrivateCachePolicy(app: FastifyInstance) {
      original.installPrivateCachePolicy(app);
      // A slow response hook reproduces send() still pending after an async
      // authentication helper returns: the route must return its reply.
      app.addHook('onSend', async (_request, _reply, payload) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return payload;
      });
    },
  };
});

import { buildApp } from './app.js';

describe('anonymous reader reply completion', () => {
  it('sends exactly one 401 through asynchronous hooks, including RSC-prefetched RSS', async () => {
    const app = await buildApp(
      { login: null, uiOrigin: 'http://127.0.0.1:1', port: 18165, publicOrigin: 'https://weblog.tw' },
      // @ts-expect-error JS injected store default is inferred as null.
      { store: { pool: { query: async () => [[]] } } },
    );
    const warn = vi.spyOn(app.log, 'warn');
    try {
      for (const url of ['/api/me/follows', '/me/feed.xml?_rsc=reader-check', '/me/opml']) {
        const response = await app.inject({ url, headers: { RSC: '1', 'Next-Router-Prefetch': '1' } });
        expect(response.statusCode).toBe(401);
        expect(response.json()).toEqual({ error: 'login required' });
        expect(response.headers['cache-control']).toBe('private, no-store');
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(warn.mock.calls).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
