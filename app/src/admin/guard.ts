import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { readCookie, SESSION_COOKIE, type SessionUser, safeNext } from '../auth/google-login.ts';
import type { FeedCrawlerOptions } from '../crawl/feed.ts';
import { isAdmin } from './identity.ts';
export type AdminOptions = {
  pool: Pool;
  login: { currentUser: (request: FastifyRequest) => Promise<SessionUser | null> };
  publicOrigin: string;
  sessionSecret: string;
  adminEmails: Set<string>;
  similarEnabled?: boolean;
  userAgent?: string;
  crawlOptions?: FeedCrawlerOptions;
};
export function adminPath(raw: string): 'none' | 'ui' | 'api' | 'invalid' {
  const path = raw.split('?')[0];
  let decoded = path;
  try {
    for (let i = 0; i < 4; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return 'invalid';
  }
  let normalized = decoded;
  try {
    normalized = new URL(decoded, 'http://admin.invalid').pathname;
  } catch {
    return 'invalid';
  }
  const relevant =
    /^\/(?:api\/)?admin(?:\/|$)/i.test(normalized) ||
    /^\/*(?:api\/)?admin(?:[/;\\.]|$)/i.test(decoded) ||
    /^\/*(?:api\/)?admin(?:[/;\\.]|$)/i.test(path) ||
    (/%(?:25|2f|5c)/i.test(path) && /admin/i.test(decoded));
  if (!relevant) return 'none';
  if (
    path !== decoded ||
    path.includes('//') ||
    path.includes('\\') ||
    path.includes(';') ||
    path.split('/').some((s) => s === '.' || s === '..') ||
    /^\/(?:API|ADMIN)/.test(path) ||
    /^\/api\/ADMIN/.test(path) ||
    !/^\/(?:api\/)?admin(?:\/|$)/.test(path)
  )
    return 'invalid';
  return path.startsWith('/api/') ? 'api' : 'ui';
}
export function csrfToken(session: string, secret: string) {
  return createHmac('sha256', secret).update(`blog-admin-csrf-v1\0${session}`).digest('base64url');
}
export function validCsrf(request: FastifyRequest, config: AdminOptions) {
  const session = readCookie(request, SESSION_COOKIE),
    supplied = request.headers['x-blog-csrf'];
  if (
    request.headers.origin !== config.publicOrigin ||
    !session ||
    session.length > 128 ||
    typeof supplied !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(supplied)
  )
    return false;
  const expected = csrfToken(session, config.sessionSecret);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
export function installAdminGuard(app: FastifyInstance, config: AdminOptions) {
  app.addHook('onRequest', async (request, reply) => {
    const kind = adminPath(request.raw.url || request.url);
    if (kind === 'none') return;
    reply.header('cache-control', 'no-store');
    if (kind === 'invalid') return reply.code(400).send({ error: 'invalid_admin_path' });
    const user = await config.login.currentUser(request);
    if (!user?.sub)
      return kind === 'ui'
        ? reply.redirect(`/login?next=${encodeURIComponent(safeNext(request.url))}`, 302)
        : reply.code(401).send({ error: 'login_required' });
    if (!(await isAdmin(config.pool, user, config.adminEmails))) return reply.code(403).send({ error: 'admin_required' });
    if (!['GET', 'HEAD', 'POST'].includes(request.method)) return reply.code(405).send({ error: 'method_not_allowed' });
    if (request.method === 'POST' && !validCsrf(request, config)) return reply.code(403).send({ error: 'csrf_required' });
  });
}
