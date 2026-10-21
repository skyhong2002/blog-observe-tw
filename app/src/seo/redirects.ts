import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { TopicResponseCache } from '../topics/cache.ts';
import { historyReadsEnabled } from '../topics/history-contracts.ts';
import { topicHistoryDisposition } from '../topics/history-read.ts';
import { isPublicRouteKey, type PublicPageKind, RESERVED_TOPIC_KEYS, resolvePublicPage } from './page-routes.ts';

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
  // A static page under /topics/ (e.g. /topics/trending/) is the web's, never a topic lookup.
  if (kind === 'topic' && RESERVED_TOPIC_KEYS.has(key.toLowerCase())) return null;
  return { kind, key, path: raw.split('?')[0], query: match[3] ?? '' };
}

/** DB-owned relative targets, read-only and single-hop; API stable identifiers are unaffected. */
export function createPublicPageRedirect(pool: Pool, { legacyUiPaths = false } = {}) {
  const upstreamPaths = new WeakMap<FastifyRequest, string>();
  const cache = new TopicResponseCache(300_000, 256);
  const redirect = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    const route = publicPageRequest(String(request.raw.url ?? request.url));
    if (!route) return false;
    const durable = route.kind === 'topic' && historyReadsEnabled();
    if (durable) {
      const state = await topicHistoryDisposition(pool, route.key);
      if (state.status !== 'available') {
        reply
          .code(state.status === 'gone' ? 410 : 404)
          .header('cache-control', 'no-store')
          .type('text/plain; charset=utf-8')
          .send(state.status === 'gone' ? '此話題的公開證據已撤銷。' : '找不到此話題。');
        return true;
      }
    }
    const page = durable
      ? await resolvePublicPage(pool, route.kind, route.key)
      : await cache.get(`${route.kind}:${route.key}`, () => resolvePublicPage(pool, route.kind, route.key));
    if (!page) return false;
    if (page.canonicalPath === route.path) {
      // Emergency web-only rollback: keep the public canonical URL, but render
      // the old UI's stable-ID route. Never mutate the IncomingMessage/body.
      if (legacyUiPaths && isPublicRouteKey(route.kind, page.stableId)) {
        const section = route.kind === 'blog' ? 'blogs' : 'topics';
        upstreamPaths.set(request, `/${section}/${encodeURIComponent(page.stableId)}/${route.query}`);
      }
      return false;
    }
    reply.header('cache-control', 'no-store').redirect(page.canonicalPath + route.query, 301);
    return true;
  };
  return Object.assign(redirect, { uiPath: (request: FastifyRequest) => upstreamPaths.get(request) });
}
