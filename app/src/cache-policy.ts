import type { FastifyInstance, onSendHookHandler } from 'fastify';

const privatePath = (path: string) =>
  /^\/*(?:auth|admin|my|me|login)(?:[/;\\.]|$)/i.test(path) ||
  /^\/*api\/(?:me|admin)(?:[/;\\.]|$)/i.test(path) ||
  /^\/*api\/blogs\/[^/]+\/follow(?:[/;\\.]|$)/i.test(path);
/** Inspect raw, decoded and dot-normalized forms. A query mentioning /my never
 * changes a public page's policy; encoded paths cannot evade private boundaries. */
export function privateCachePath(rawUrl: string): boolean {
  let path = rawUrl.split('?')[0];
  for (let iteration = 0; iteration < 5; iteration++) {
    if (privatePath(path)) return true;
    try {
      if (privatePath(new URL(path, 'http://cache-policy.invalid').pathname)) return true;
      const decoded = decodeURIComponent(path);
      if (decoded === path) return false;
      path = decoded;
    } catch {
      // Malformed or deeply encoded paths are never useful shared-cache entries.
      return true;
    }
  }
  return true;
}
/** Enforced after every handler/proxy response, including denied/error responses. */
export function installPrivateCachePolicy(app: FastifyInstance) {
  const protect: onSendHookHandler = async (request, reply, payload) => {
    const privateResponse =
      request.headers['x-api-key'] !== undefined ||
      request.headers.authorization !== undefined ||
      request.headers.cookie !== undefined ||
      privateCachePath(request.raw.url || request.url) ||
      reply.hasHeader('set-cookie') ||
      !['GET', 'HEAD'].includes(request.method);
    const path = (request.raw.url || request.url).split('?')[0];
    const liveData = /^\/api(?:\/|$)|^\/sitemaps?[^?]*\.xml$/i.test(path);
    if (privateResponse || liveData) {
      reply.header('cache-control', privateResponse ? 'private, no-store' : 'no-store');
      // An upstream-specific CDN override must not weaken the private boundary.
      reply.removeHeader('cdn-cache-control');
      reply.removeHeader('cloudflare-cdn-cache-control');
      reply.removeHeader('surrogate-control');
      reply.removeHeader('expires');
    }
    return payload;
  };
  // The global hook covers not-found/error paths. Route hooks run after plugin
  // hooks, so append protection last to prevent a later handler-local override.
  app.addHook('onSend', protect);
  app.addHook('onRoute', (options) => {
    const hooks = options.onSend ? (Array.isArray(options.onSend) ? options.onSend : [options.onSend]) : [];
    if (!hooks.includes(protect)) options.onSend = [...hooks, protect];
  });
}
