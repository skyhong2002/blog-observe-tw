import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FLOW_COOKIE,
  hashToken,
  LOGIN_COMPLETED_COOKIE,
  type LoginStore,
  loginConfig,
  registerLogin,
  SESSION_COOKIE,
  safeNext,
  verifiedIdentity,
} from './google-login.ts';

const env = {
  BLOG_GOOGLE_CLIENT_ID: 'blog-client',
  BLOG_GOOGLE_CLIENT_SECRET: 'secret',
  BLOG_SESSION_SECRET: 's'.repeat(32),
  BLOG_PUBLIC_ORIGIN: 'https://weblog.tw',
};

describe('blog OAuth contract', () => {
  it('uses the blog namespaced origin and secret', () => {
    const config = loginConfig(env);
    expect(config?.origin).toBe('https://weblog.tw');
    expect(loginConfig({ ...env, BLOG_PUBLIC_ORIGIN: undefined })?.origin).toBe('https://weblog.tw');
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

describe('successful-login analytics receipt', () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  const setup = async (failure?: 'exchange' | 'claims' | 'persistence') => {
    const app = Fastify();
    apps.push(app);
    const now = Date.now();
    const store: LoginStore = {
      upsertUser: vi.fn(async () => 1),
      createSession: vi.fn(async () => {
        if (failure === 'persistence') throw Error('fixture persistence failed');
      }),
      sessionUser: vi.fn(async () => null),
      deleteSession: vi.fn(async () => {}),
    };
    let nonce = '';
    registerLogin(app, store, loginConfig(env), {
      now: () => now,
      exchange: async () => {
        if (failure === 'exchange') throw Error('fixture exchange failed');
        return {
          iss: 'https://accounts.google.com',
          aud: env.BLOG_GOOGLE_CLIENT_ID,
          exp: now / 1000 + 60,
          nonce,
          sub: 'fixture-reader',
          email: 'reader@example.com',
          email_verified: failure !== 'claims',
        };
      },
    });
    const begin = await app.inject({
      url: '/auth/google?next=/my/',
      headers: { cookie: `${LOGIN_COMPLETED_COOKIE}=1; ${SESSION_COOKIE}=old-session` },
    });
    const redirect = new URL(begin.headers.location!);
    nonce = redirect.searchParams.get('nonce')!;
    const flow = begin.cookies.find((cookie) => cookie.name === FLOW_COOKIE)!;
    const callback = (query: Record<string, string> = {}) =>
      app.inject({
        url: `/auth/google/callback?${new URLSearchParams({ state: redirect.searchParams.get('state')!, code: 'fixture-code', ...query })}`,
        headers: { cookie: `${FLOW_COOKIE}=${flow.value}; ${LOGIN_COMPLETED_COOKIE}=1` },
      });
    return { app, store, begin, callback };
  };
  const headers = (reply: { headers: { 'set-cookie'?: string | string[] } }) => {
    const cookies = reply.headers['set-cookie'];
    return Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  };
  const marker = (reply: Parameters<typeof headers>[0]) => headers(reply).find((cookie) => cookie.startsWith(`${LOGIN_COMPLETED_COOKIE}=`));
  const expectCleared = (reply: Parameters<typeof headers>[0]) => {
    expect(marker(reply)).toBe(`${LOGIN_COMPLETED_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; Secure`);
  };
  it('issues a readable five-minute boolean only after a persisted successful callback', async () => {
    const { app, store, begin, callback } = await setup();
    expect(new URL(begin.headers.location!).searchParams.get('redirect_uri')).toBe('https://weblog.tw/auth/google/callback');
    expectCleared(begin);
    const response = await callback();
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/my/');
    expect(store.createSession).toHaveBeenCalledOnce();
    expect(marker(response)).toBe(`${LOGIN_COMPLETED_COOKIE}=1; Path=/; Max-Age=300; SameSite=Lax; Secure`);
    expect(headers(response).filter((value) => value.startsWith(`${LOGIN_COMPLETED_COOKIE}=`))).toHaveLength(1);
    for (const name of [SESSION_COOKIE, FLOW_COOKIE]) {
      const cookie = headers(response).find((value) => value.startsWith(`${name}=`));
      expect(cookie).toContain('; Path=/;');
      expect(cookie).toContain('; HttpOnly; SameSite=Lax; Secure');
      expect(cookie).not.toMatch(/;\s*Domain=/i);
    }
    expect(headers(response).find((value) => value.startsWith(`${SESSION_COOKIE}=`))).toContain('; Max-Age=2592000;');
    const me = await app.inject({ url: '/auth/me', headers: { cookie: `${LOGIN_COMPLETED_COOKIE}=1` } });
    expect(me.json().user).toBeNull();
    expect(marker(me)).toBeUndefined();
    expect(store.sessionUser).not.toHaveBeenCalled();
    vi.mocked(store.sessionUser).mockResolvedValue({
      id: 1,
      sub: 'fixture-existing',
      email: 'reader@example.com',
      name: null,
      picture: null,
    });
    const existing = await app.inject({ url: '/auth/me', headers: { cookie: `${SESSION_COOKIE}=existing-session` } });
    expect(existing.json().user.id).toBe(1);
    expect(marker(existing)).toBeUndefined();
  });
  it.each(['exchange', 'claims', 'persistence'] as const)('clears the receipt when %s fails', async (failure) => {
    const { callback } = await setup(failure);
    const response = await callback();
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toMatch(/^\/login\?error=/);
    expectCleared(response);
    expect(headers(response).some((value) => value.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });
  it.each<Record<string, string>>([{ state: 'invalid-state' }, { error: 'access_denied' }])(
    'clears on failed or cancelled OAuth (%j)',
    async (query) => {
      const { store, callback } = await setup();
      const response = await callback(query);
      expectCleared(response);
      expect(store.createSession).not.toHaveBeenCalled();
    },
  );
  it('clears on same-origin logout and preserves session/CSRF behavior', async () => {
    const { app, store } = await setup();
    const invalid = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: 'https://evil.example', cookie: `${SESSION_COOKIE}=session` },
    });
    expect(invalid.statusCode).toBe(403);
    expect(store.deleteSession).not.toHaveBeenCalled();
    const legacyOrigin = await app.inject({ method: 'POST', url: '/auth/logout', headers: { origin: 'https://blog.observe.tw' } });
    expect(legacyOrigin.statusCode).toBe(403);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { origin: env.BLOG_PUBLIC_ORIGIN, cookie: `${SESSION_COOKIE}=session; ${LOGIN_COMPLETED_COOKIE}=1` },
    });
    expect(response.statusCode).toBe(303);
    expectCleared(response);
    expect(headers(response)).toContain(`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
    expect(store.deleteSession).toHaveBeenCalledWith(hashToken('session', env.BLOG_SESSION_SECRET));
  });
  it('accepts the account menu form post (urlencoded) and still rejects cross-origin forms', async () => {
    const { app, store } = await setup();
    const form = { 'content-type': 'application/x-www-form-urlencoded' };
    const cross = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { ...form, origin: 'https://evil.example', cookie: `${SESSION_COOKIE}=session` },
      payload: '',
    });
    expect(cross.statusCode).toBe(403);
    expect(store.deleteSession).not.toHaveBeenCalled();
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { ...form, origin: env.BLOG_PUBLIC_ORIGIN, cookie: `${SESSION_COOKIE}=session` },
      payload: '',
    });
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/');
    expect(headers(response)).toContain(`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`);
    expect(store.deleteSession).toHaveBeenCalledWith(hashToken('session', env.BLOG_SESSION_SECRET));
  });
});
