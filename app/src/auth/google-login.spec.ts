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

  it('accepts the string claim shapes returned by Google tokeninfo', () => {
    const config = loginConfig(env)!;
    const tokeninfoFixture = {
      iss: 'https://accounts.google.com',
      aud: 'blog-client',
      azp: 'blog-client',
      // tokeninfo returns exp and email_verified as JSON strings.
      exp: String(Math.floor(Date.now() / 1000) + 60),
      nonce: 'tokeninfo-nonce',
      sub: 'google-sub-123',
      email: 'reader@example.com',
      email_verified: 'true',
      name: 'Reader',
      picture: 'https://lh3.googleusercontent.com/avatar',
    };
    expect(verifiedIdentity(tokeninfoFixture, config, 'tokeninfo-nonce')).toMatchObject({
      sub: 'google-sub-123',
      email: 'reader@example.com',
      name: 'Reader',
    });
    expect(verifiedIdentity({ ...tokeninfoFixture, exp: 'not-a-number' }, config, 'tokeninfo-nonce')).toBeNull();
    expect(verifiedIdentity({ ...tokeninfoFixture, email_verified: 'false' }, config, 'tokeninfo-nonce')).toBeNull();
    expect(verifiedIdentity({ ...tokeninfoFixture, iss: 'https://accounts.google.com.evil.test' }, config, 'tokeninfo-nonce')).toBeNull();
  });
});
