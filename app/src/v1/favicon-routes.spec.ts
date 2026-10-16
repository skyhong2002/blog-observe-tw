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
  it("leaves out a platform default shared by three or more different sites; one site's many URLs count once", () => {
    const row = (revision: string, targetUrl: string) => ({ revision, targetUrl });
    const result = publicIconManifest({
      // Bear Blog's share image on three different blogs.
      a: row('11a960b9df58ec1d', 'https://one.bearblog.dev/'),
      b: row('11a960b9df58ec1d', 'https://two.bearblog.dev/'),
      c: row('11a960b9df58ec1d', 'https://three.example/'),
      // One site's own icon on its home and many candidate URLs.
      wiwi: row('bcc0807a39873d5b', 'https://wiwi.blog/'),
      'candidate-1': row('bcc0807a39873d5b', 'https://wiwi.blog/blogroll'),
      'candidate-2': row('bcc0807a39873d5b', 'https://www.wiwi.blog/blog/x'),
      // Two sites sharing one picture is still allowed (a person's two blogs).
      d: row('2222222222222222', 'https://d.example/'),
      e: row('2222222222222222', 'https://e.example/'),
    });
    expect(Object.keys(result).sort()).toEqual(['candidate-1', 'candidate-2', 'd', 'e', 'wiwi']);
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
