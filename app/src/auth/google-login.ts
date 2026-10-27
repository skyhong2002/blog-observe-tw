import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** The only identity provider used by weblog.tw.  Keep these names
 * separate from the sibling projects so a cookie or client id cannot be
 * accidentally shared between services. */
export type LoginConfig = {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  origin: string;
};

export type GoogleIdentity = {
  readonly emailVerified?: true;
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
};

export type SessionUser = GoogleIdentity & { id: number; role?: string };

export interface LoginStore {
  upsertUser(identity: GoogleIdentity, at: Date): Promise<number>;
  createSession(tokenHash: string, userId: number, expiresAt: Date): Promise<void>;
  sessionUser(tokenHash: string, at: Date): Promise<SessionUser | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export const SESSION_COOKIE = 'blog_session';
export const FLOW_COOKIE = 'blog_oauth';
export const LOGIN_COMPLETED_COOKIE = '__Host-blog_login_completed';
export const SESSION_DAYS = 30;
export const FLOW_SECONDS = 600;

/** Load only BLOG_* credentials.  A half-configured OAuth setup is an error. */
export function loginConfig(env: NodeJS.ProcessEnv = process.env): LoginConfig | null {
  const clientId = env.BLOG_GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.BLOG_GOOGLE_CLIENT_SECRET?.trim() ?? '';
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) throw new Error('Google login needs both BLOG_GOOGLE_CLIENT_ID and BLOG_GOOGLE_CLIENT_SECRET');
  const sessionSecret = env.BLOG_SESSION_SECRET?.trim() ?? '';
  if (sessionSecret.length < 32) throw new Error('BLOG_SESSION_SECRET must be at least 32 characters');
  const origin = new URL(env.BLOG_PUBLIC_ORIGIN || 'https://weblog.tw');
  if (!['http:', 'https:'].includes(origin.protocol)) throw new Error('BLOG_PUBLIC_ORIGIN must be http(s)');
  return { clientId, clientSecret, sessionSecret, origin: origin.origin };
}

const token = () => randomBytes(32).toString('base64url');

/** HMAC the cookie token before it reaches the database. */
export const hashToken = (value: string, secret = '') =>
  secret ? createHmac('sha256', secret).update(value).digest('hex') : createHash('sha256').update(value).digest('hex');

export function readCookie(request: FastifyRequest, name: string): string | null {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

/** Only same-site paths survive the OAuth round trip. */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.startsWith('/auth/') || value.length > 512 || [...value].some((character) => character.charCodeAt(0) < 0x20)) return '/';
  return value;
}

export function verifiedIdentity(
  claims: Record<string, unknown>,
  config: LoginConfig,
  nonce: string,
  now = Date.now(),
): GoogleIdentity | null {
  const { iss, aud, azp, exp, sub, email, email_verified: verified, name, picture } = claims;
  if (typeof iss !== 'string' || !['https://accounts.google.com', 'accounts.google.com'].includes(iss)) return null;
  if (aud !== config.clientId || (azp !== undefined && azp !== config.clientId)) return null;
  const expiry =
    typeof exp === 'number' && Number.isFinite(exp)
      ? exp
      : typeof exp === 'string' && /^\d+(?:\.\d+)?$/.test(exp.trim())
        ? Number(exp)
        : Number.NaN;
  // Google's tokeninfo endpoint serializes numeric claims and email_verified
  // as strings, while a decoded JWT has number/boolean values. Accept only
  // those two documented shapes; do not coerce arbitrary truthy values.
  const emailVerified = verified === true || (typeof verified === 'string' && verified.trim().toLowerCase() === 'true');
  if (!Number.isFinite(expiry) || expiry * 1000 <= now || claims.nonce !== nonce || !emailVerified) return null;
  if (typeof sub !== 'string' || !sub || sub.length > 255) return null;
  if (typeof email !== 'string' || !email || email.length > 255) return null;
  return {
    emailVerified: true,
    sub,
    email: email.toLowerCase(),
    name: typeof name === 'string' && name ? name.slice(0, 255) : null,
    picture: typeof picture === 'string' && picture.startsWith('https://') && picture.length <= 1024 ? picture : null,
  };
}

type CodeExchange = (code: string, verifier: string) => Promise<Record<string, unknown>>;
export type LoginOptions = { exchange?: CodeExchange; now?: () => number };

function googleExchange(config: LoginConfig, fetcher: typeof fetch = fetch): CodeExchange {
  return async (code, verifier) => {
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        code_verifier: verifier,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: `${config.origin}/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`token endpoint ${response.status}`);
    const { id_token: idToken } = (await response.json()) as { id_token?: string };
    if (typeof idToken !== 'string') throw new Error('no id_token');
    // Ask Google's tokeninfo endpoint to validate the signed token before
    // reading claims; verifiedIdentity still enforces this app's audience,
    // nonce, expiry and email policy.
    if (idToken.split('.').length !== 3) throw new Error('malformed id_token');
    const verified = await fetcher(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!verified.ok) throw new Error(`tokeninfo endpoint ${verified.status}`);
    const claims = (await verified.json()) as Record<string, unknown>;
    if (!claims.iss) throw new Error('tokeninfo missing issuer');
    return claims;
  };
}

export function registerLogin(app: FastifyInstance, store: LoginStore | null, config: LoginConfig | null, options: LoginOptions = {}) {
  const now = options.now ?? Date.now;
  const enabled = Boolean(store && config);
  const secure = config?.origin.startsWith('https:') ? '; Secure' : '';
  const cookie = (name: string, value: string, maxAge: number) =>
    `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
  // An untrusted, non-identifying analytics receipt only. Never read it for authentication.
  // The browser consumes/deletes this flag after sending its successful-login event.
  const completedCookie = (completed: boolean) =>
    `${LOGIN_COMPLETED_COOKIE}=${completed ? '1' : ''}; Path=/; Max-Age=${completed ? 300 : 0}; SameSite=Lax; Secure`;
  const currentUser = async (request: FastifyRequest): Promise<SessionUser | null> => {
    const value = readCookie(request, SESSION_COOKIE);
    if (!store || !config || !value || value.length > 128) return null;
    return store.sessionUser(hashToken(value, config.sessionSecret), new Date(now()));
  };

  app.get('/auth/me', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const user = await currentUser(request);
    return {
      enabled,
      user: user ? { id: user.id, email: user.email, name: user.name, picture: user.picture, role: user.role || 'reader' } : null,
    };
  });

  if (!store || !config) return { currentUser };
  const exchange = options.exchange ?? googleExchange(config);
  const callback = `${config.origin}/auth/google/callback`;
  const fail = (reply: FastifyReply, reason: string) =>
    reply.header('set-cookie', completedCookie(false)).redirect(`/login?error=${encodeURIComponent(reason)}`, 303);

  app.get<{ Querystring: { next?: string } }>('/auth/google', async (request, reply) => {
    const state = token();
    const nonce = token();
    const verifier = token();
    const flow = Buffer.from(JSON.stringify({ state, nonce, verifier, next: safeNext(request.query.next), issuedAt: now() })).toString(
      'base64url',
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: callback,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return reply
      .header('cache-control', 'no-store')
      .header('set-cookie', [cookie(FLOW_COOKIE, flow, FLOW_SECONDS), completedCookie(false)])
      .redirect(url.toString(), 302);
  });

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/auth/google/callback', async (request, reply) => {
    reply.header('cache-control', 'no-store').header('set-cookie', cookie(FLOW_COOKIE, '', 0));
    let flow: { state?: string; nonce?: string; verifier?: string; next?: string; issuedAt?: number } = {};
    try {
      const encoded = readCookie(request, FLOW_COOKIE) ?? '';
      if (encoded.length <= 4096) flow = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as typeof flow;
    } catch {
      // Treat malformed client state like any other failed login.
    }
    const { state, code, error } = request.query;
    if (!flow.state || !flow.nonce || !flow.verifier || state !== flow.state) return fail(reply, 'state');
    if (typeof flow.issuedAt !== 'number' || now() - flow.issuedAt > FLOW_SECONDS * 1000 || now() - flow.issuedAt < -30_000)
      return fail(reply, 'expired');
    if (error) return fail(reply, 'cancelled');
    if (!code || code.length > 2048) return fail(reply, 'invalid');
    let identity: GoogleIdentity | null;
    try {
      identity = verifiedIdentity(await exchange(code, flow.verifier), config, flow.nonce, now());
    } catch (err) {
      request.log.warn({ err: (err as Error).message }, 'google login exchange failed');
      return fail(reply, 'failed');
    }
    if (!identity) return fail(reply, 'invalid');
    try {
      const at = new Date(now());
      const userId = await store.upsertUser(identity, at);
      const session = token();
      await store.createSession(hashToken(session, config.sessionSecret), userId, new Date(at.getTime() + SESSION_DAYS * 86_400_000));
      return reply
        .header('set-cookie', [cookie(FLOW_COOKIE, '', 0), cookie(SESSION_COOKIE, session, SESSION_DAYS * 86_400), completedCookie(true)])
        .redirect(safeNext(flow.next), 303);
    } catch (err) {
      request.log.error({ err: (err as Error).message }, 'blog session persistence failed');
      return fail(reply, 'failed');
    }
  });

  // The account menu logs out with a plain HTML form, which posts application/x-www-form-urlencoded.
  // Fastify only parses JSON/text by default and answered that form with 415, so logout never worked
  // from the UI. Accept (and ignore) a small form body here only, in its own scope.
  app.register(async (scope) => {
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 1024 }, (_request, _body, done) =>
      done(null, null),
    );
    scope.post('/auth/logout', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      if (request.headers.origin !== config.origin) return reply.code(403).send({ error: 'same-origin requests only' });
      const value = readCookie(request, SESSION_COOKIE);
      if (value && value.length <= 128) await store.deleteSession(hashToken(value, config.sessionSecret));
      return reply.header('set-cookie', [cookie(SESSION_COOKIE, '', 0), completedCookie(false)]).redirect('/', 303);
    });
  });

  return { currentUser };
}
