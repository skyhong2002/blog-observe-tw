import type { FastifyInstance } from 'fastify';
import { clientIp } from './client-ip.ts';
import { API_CACHE, API_LIMITS } from './contract.ts';

const canonicalApiPath = (url: string) => /^\/api\/v1(?:\/|\?|$)/.test(url);
export function publicApiPath(url: string): boolean {
  let path = url.split('?')[0];
  for (let i = 0; i < 4; i++) {
    if (canonicalApiPath(path)) return true;
    try {
      const decoded = decodeURIComponent(path);
      if (decoded === path) return false;
      path = decoded;
    } catch {
      return false;
    }
  }
  return false;
}
type Keys = { isCachedValid?: (raw: string) => boolean; identify: (raw: string) => Promise<{ id: number } | null> };
type Bucket = { count: number; until: number };
/** One gateway process owns public v1. Keys never establish a reader session.
 * Memory is bounded; saturation rejects new buckets rather than evicting live quotas. */
export function installPublicApiPolicy(app: FastifyInstance, keys: Keys, now = Date.now) {
  const buckets = new Map<string, Bucket>();
  const keyBuckets = new Map<string, Bucket>();
  const pending = new Map<string, number>();
  function take(key: string, limit: number) {
    const at = now();
    const store = key.startsWith('key:') ? keyBuckets : buckets;
    let bucket = store.get(key);
    if (!bucket || bucket.until <= at) {
      if (store.size >= 20_000) {
        for (const [id, row] of store) if (row.until <= at) store.delete(id);
        if (store.size >= 20_000) return { limit, remaining: 0, reset: 60, allowed: false };
      }
      bucket = { count: 0, until: at + 60_000 };
      store.set(key, bucket);
    }
    bucket.count++;
    return {
      limit,
      remaining: Math.max(0, limit - bucket.count),
      reset: Math.max(1, Math.ceil((bucket.until - at) / 1000)),
      allowed: bucket.count <= limit,
    };
  }
  app.addHook('onRequest', async (request, reply) => {
    if (!publicApiPath(request.url)) return;
    reply.header('access-control-allow-origin', '*');
    reply.header('access-control-expose-headers', 'x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after');
    if (!canonicalApiPath(request.url)) return reply.code(400).send({ error: 'invalid_query' });
    if (request.method === 'OPTIONS') {
      return reply
        .header('access-control-allow-methods', 'GET, HEAD, OPTIONS')
        .header('access-control-allow-headers', 'x-api-key, Authorization, Content-Type')
        .header('access-control-max-age', '600')
        .code(204)
        .send();
    }
    const raw = request.headers['x-api-key'];
    let identity: { id: number } | null = null;
    if (raw !== undefined) {
      const address = `ip:${clientIp(request)}`;
      const bucket = buckets.get(address);
      const used = bucket && bucket.until > now() ? bucket.count : 0;
      const cached = typeof raw === 'string' && keys.isCachedValid?.(raw);
      // Admission is held across async lookup: a burst of distinct invalid keys
      // cannot bypass the IP limit by racing database queries. Known live keys
      // retain their independent quota even on a busy shared IP.
      if (!cached && used + (pending.get(address) || 0) >= API_LIMITS.anonymous) {
        const reset = bucket ? Math.max(1, Math.ceil((bucket.until - now()) / 1000)) : 1;
        return reply
          .header('x-ratelimit-limit', API_LIMITS.anonymous)
          .header('x-ratelimit-remaining', 0)
          .header('x-ratelimit-reset', reset)
          .header('retry-after', reset)
          .code(429)
          .send({ error: 'rate_limit_exceeded' });
      }
      if (!cached && pending.size >= 20_000 && !pending.has(address))
        return reply.header('retry-after', 1).code(429).send({ error: 'rate_limit_exceeded' });
      if (!cached) pending.set(address, (pending.get(address) || 0) + 1);
      try {
        if (typeof raw === 'string') identity = await keys.identify(raw);
      } catch {
        const failed = take(address, API_LIMITS.anonymous);
        reply
          .header('x-ratelimit-limit', failed.limit)
          .header('x-ratelimit-remaining', failed.remaining)
          .header('x-ratelimit-reset', failed.reset);
        return reply.code(503).send({ error: 'unavailable' });
      } finally {
        if (!cached) {
          const left = (pending.get(address) || 1) - 1;
          if (left) pending.set(address, left);
          else pending.delete(address);
        }
      }
    }
    const quota = take(identity ? `key:${identity.id}` : `ip:${clientIp(request)}`, identity ? API_LIMITS.key : API_LIMITS.anonymous);
    reply
      .header('x-ratelimit-limit', quota.limit)
      .header('x-ratelimit-remaining', quota.remaining)
      .header('x-ratelimit-reset', quota.reset);
    if (!quota.allowed) return reply.header('retry-after', quota.reset).code(429).send({ error: 'rate_limit_exceeded' });
    if (raw !== undefined && !identity) return reply.code(401).send({ error: 'invalid_api_key' });
    if (!['GET', 'HEAD'].includes(request.method)) return reply.code(405).send({ error: 'method_not_allowed' });
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (!publicApiPath(request.url)) return payload;
    reply.header('access-control-allow-origin', '*');
    reply.header('x-content-type-options', 'nosniff');
    if (request.headers['x-api-key'] !== undefined || request.headers.authorization !== undefined || request.headers.cookie !== undefined) {
      reply.header('cache-control', 'private, no-store');
    } else if (reply.statusCode >= 400 || request.method === 'OPTIONS') reply.header('cache-control', 'no-store');
    else if (!String(reply.getHeader('cache-control') ?? '').toLowerCase().includes('no-store'))
      reply.header('cache-control', API_CACHE);
    return payload;
  });
}
