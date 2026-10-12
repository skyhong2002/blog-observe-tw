import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { buildOpenApi } from '../v1/openapi.ts';
import { PUBLIC_PATHS } from './contract.ts';

describe('deployed API contract registration', () => {
  it('registers every documented GET and automatic HEAD on the real gateway, retains JSON errors and status negotiation', async () => {
    const app = await buildApp(
      { port: 18160, uiOrigin: 'http://127.0.0.1:1', publicOrigin: 'https://blog.observe.tw', adminEmails: new Set() },
      // @ts-expect-error JavaScript buildApp infers its injected store as null.
      { store: { pool: { query: async () => [[]] } } },
    );
    const spec = buildOpenApi();
    for (const path of PUBLIC_PATHS) {
      expect(app.hasRoute({ method: 'GET', url: path })).toBe(true);
      expect(app.hasRoute({ method: 'HEAD', url: path })).toBe(true);
      expect(spec.paths).toHaveProperty(path.replace(/:([a-z]+)/g, '{$1}'));
    }
    for (const path of ['//api/v1/articles', '/api//v1/articles', '/api/v1/articles/', '/%61pi/v1/articles', '/api/v1;foo/articles']) {
      expect((await app.inject(path)).statusCode).not.toBe(200);
    }
    const unknown = await app.inject('/api/v1/unknown');
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: 'not_found' });
    const status = await app.inject({ url: '/api/status', headers: { accept: 'application/json' } });
    expect(status.statusCode).toBe(200);
    expect(status.json().endpoints).toHaveLength(PUBLIC_PATHS.length);
    expect(status.headers['cache-control']).toBe('no-store');
    const html = await app.inject({ url: '/api/status', headers: { accept: 'text/html' } });
    expect(html.statusCode).toBe(503);
    expect(html.headers['x-blog-outcome']).toBe('ui-down');
    expect(html.headers['cache-control']).toBe('no-store');
    expect(html.headers.vary).toContain('Accept');
    const keys = await app.inject('/auth/me/api-keys');
    expect(keys.statusCode).toBe(401);
    expect(keys.headers['access-control-allow-origin']).toBeUndefined();
    expect((await app.inject('/api/')).headers['x-blog-outcome']).toBe('ui-down');
    await app.close();
  });
  it('reports degraded status without leaking database failure details', async () => {
    const app = await buildApp(
      { port: 18160, uiOrigin: 'http://127.0.0.1:1', publicOrigin: 'https://blog.observe.tw', adminEmails: new Set() },
      {
        // @ts-expect-error JavaScript fixture injects only the pool interface used here.
        store: {
          pool: {
            query: async () => {
              throw Error('private connection detail');
            },
          },
        },
      },
    );
    const response = await app.inject({ url: '/api/status', headers: { accept: 'application/json' } });
    expect(response.json().status).toBe('degraded');
    expect(response.body).not.toContain('private connection');
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });
});
