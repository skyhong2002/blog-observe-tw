import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { TopicResponseCache } from '../topics/cache.ts';
import { isPublicRouteKey, type PublicPageKind, resolvePublicPage } from './page-routes.ts';

/** Only a single public page segment is eligible. Never normalize a raw URL into another origin. */
export function publicPageRequest(raw: string): { kind: PublicPageKind; key: string; path: string; query: string } | null {
  if (/[\r\n\\#]/.test(raw) || raw.length > 4096) return null;
  const match = /^\/(blogs|topics)\/([^/?]+)\/?(\?[^#]*)?$/.exec(raw);
  if (!match) return null;
  let key: string;
  try {
    key = decodeURIComponent(match[2]);
  } catch {
    return null;
  }
  const kind = match[1] === 'blogs' ? 'blog' : 'topic';
  if (!isPublicRouteKey(kind, key)) return null;
  return { kind, key, path: raw.split('?')[0], query: match[3] ?? '' };
}

/** DB-owned relative targets, read-only and single-hop; API stable identifiers are unaffected. */
export function createPublicPageRedirect(pool: Pool) {
  const cache = new TopicResponseCache(300_000, 256);
  return async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const route = publicPageRequest(String(request.raw.url ?? request.url));
    if (!route) return false;
    const page = await cache.get(`${route.kind}:${route.key}`, () => resolvePublicPage(pool, route.kind, route.key));
    if (!page || page.canonicalPath === route.path) return false;
    reply.header('cache-control', 'public, max-age=300, s-maxage=300').redirect(page.canonicalPath + route.query, 301);
    return true;
  };
}
