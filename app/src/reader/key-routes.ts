import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { readCookie, SESSION_COOKIE, type SessionUser } from '../auth/google-login.ts';
import { API_KEYS_PER_USER, ApiKeyError, type ApiKeyService } from './api-keys.ts';

type KeyRouteOptions = {
  pool: Pool;
  login: { currentUser(request: FastifyRequest): Promise<SessionUser | null> };
  publicOrigin: string;
  sessionSecret: string;
  keys: ApiKeyService;
};
export const apiKeyCsrfToken = (session: string, secret: string) =>
  createHmac('sha256', secret).update(`blog-api-keys-csrf-v1\0${session}`).digest('base64url');
function validCsrf(request: FastifyRequest, options: KeyRouteOptions) {
  const session = readCookie(request, SESSION_COOKIE),
    supplied = request.headers['x-blog-csrf'];
  if (
    options.sessionSecret.length < 32 ||
    request.headers.origin !== options.publicOrigin ||
    !session ||
    session.length > 128 ||
    typeof supplied !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(supplied)
  )
    return false;
  return timingSafeEqual(Buffer.from(apiKeyCsrfToken(session, options.sessionSecret)), Buffer.from(supplied));
}
export function registerApiKeyRoutes(app: FastifyInstance, options: KeyRouteOptions) {
  const routeOptions = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get('/auth/me/api-keys', routeOptions, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const user = await options.login.currentUser(request).catch(() => {
      reply.code(503).send({ error: 'unavailable' });
      return null;
    });
    if (reply.sent) return;
    const session = readCookie(request, SESSION_COOKIE);
    if (!user || !session || session.length > 128 || options.sessionSecret.length < 32)
      return reply.code(401).send({ error: 'unauthorized' });
    try {
      return { keys: await options.keys.list(user.id), max: API_KEYS_PER_USER, csrfToken: apiKeyCsrfToken(session, options.sessionSecret) };
    } catch {
      return reply.code(503).send({ error: 'unavailable' });
    }
  });
  app.post('/auth/me/api-keys', { ...routeOptions, bodyLimit: 1024 }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const user = await options.login.currentUser(request).catch(() => {
      reply.code(503).send({ error: 'unavailable' });
      return null;
    });
    if (reply.sent) return;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (!validCsrf(request, options)) return reply.code(403).send({ error: 'invalid_csrf' });
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'label'))
      return reply.code(400).send({ error: 'invalid_label' });
    try {
      return reply.code(201).send(await options.keys.create(user.id, (body as { label?: unknown }).label));
    } catch (error) {
      if (error instanceof ApiKeyError) return reply.code(error.statusCode).send({ error: error.code });
      return reply.code(503).send({ error: 'unavailable' });
    }
  });
  app.delete('/auth/me/api-keys/:id', routeOptions, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    const user = await options.login.currentUser(request).catch(() => {
      reply.code(503).send({ error: 'unavailable' });
      return null;
    });
    if (reply.sent) return;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    if (!validCsrf(request, options)) return reply.code(403).send({ error: 'invalid_csrf' });
    const id = (request.params as { id: string }).id;
    if (!/^[1-9]\d{0,9}$/.test(id) || Number(id) > 2147483647) return reply.code(404).send({ error: 'not_found' });
    try {
      await options.keys.revoke(user.id, Number(id));
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof ApiKeyError) return reply.code(error.statusCode).send({ error: error.code });
      return reply.code(503).send({ error: 'unavailable' });
    }
  });
}
