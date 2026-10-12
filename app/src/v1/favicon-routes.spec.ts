import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { publicIconManifest, registerFavicons } from './favicon-routes.ts';

describe('public favicon metadata', () => {
  it('never publishes source URLs, candidate evidence or conditional request state', () => {
    const result = publicIconManifest({
      'candidate-42': {
        revision: 'abcdef1234567890',
        dark: 'outline',
        source: 'https://private.example/icon?token=secret',
        targetUrl: 'https://private.example',
        cache: { etag: 'private' },
        evidence: 'private',
      },
      '../../private': { revision: 'abcdef1234567890' },
      malformed: { revision: '<script>' },
    });
    expect(result).toEqual({ 'candidate-42': { revision: 'abcdef1234567890', dark: 'outline' } });
    expect(publicIconManifest(null)).toEqual({});
  });
  it('rejects non-PNG paths without reflecting path content', async () => {
    const app = Fastify();
    registerFavicons(app);
    for (const path of ['/favicons/env.txt', '/favicons/.env.png', '/favicons/%2E%2E%2Fsecret.png']) {
      const response = await app.inject(path);
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('CLI_PROXY_API_KEY');
    }
    await app.close();
  });
});
