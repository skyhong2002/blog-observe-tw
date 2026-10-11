import { describe, expect, it } from 'vitest';
import { hashToken, loginConfig, safeNext, verifiedIdentity } from './google-login.ts';

const env = {
  BLOG_GOOGLE_CLIENT_ID: 'blog-client',
  BLOG_GOOGLE_CLIENT_SECRET: 'secret',
  BLOG_SESSION_SECRET: 's'.repeat(32),
  BLOG_PUBLIC_ORIGIN: 'https://blog.observe.tw',
};

describe('blog OAuth contract', () => {
  it('uses the blog namespaced origin and secret', () => {
    const config = loginConfig(env);
    expect(config?.origin).toBe('https://blog.observe.tw');
    expect(hashToken('token', config?.sessionSecret)).toHaveLength(64);
    expect(safeNext('/blogs?category=tech')).toBe('/blogs?category=tech');
    expect(safeNext('//evil.example')).toBe('/');
    expect(safeNext('https://evil.example')).toBe('/');
  });

  it('rejects an ID token with a wrong nonce or audience', () => {
    const config = loginConfig(env);
    const claims = {
      iss: 'https://accounts.google.com',
      aud: 'blog-client',
      exp: Date.now() / 1000 + 60,
      nonce: 'ok',
      sub: '123',
      email: 'reader@example.com',
      email_verified: true,
    };
    expect(verifiedIdentity(claims, config!, 'wrong')).toBeNull();
    expect(verifiedIdentity({ ...claims, aud: 'other' }, config!, 'ok')).toBeNull();
    expect(verifiedIdentity(claims, config!, 'ok')?.email).toBe('reader@example.com');
  });
});
