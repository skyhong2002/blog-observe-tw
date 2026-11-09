import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
/** cloudflared connects to this gateway's loopback listener. Never trust a
 * forwarding header on a direct non-loopback socket, including future binds. */
export function clientIp(request: FastifyRequest): string {
  const socket = request.raw.socket.remoteAddress || request.ip;
  const local = socket === '127.0.0.1' || socket === '::1' || socket === '::ffff:127.0.0.1';
  const cf = request.headers['cf-connecting-ip'];
  return local && typeof cf === 'string' && isIP(cf) ? cf : socket;
}

/** Only anonymous server-render GETs over a direct loopback socket use this
 * separate, bounded bucket. Tunnel requests always carry forwarding headers.
 * v1 keeps its own 60/IP or 1000/key policy; auth/admin/writes never qualify. */
export function internalRenderRead(request: FastifyRequest): boolean {
  const socket = request.raw.socket.remoteAddress || request.ip;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket)) return false;
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  if (Object.keys(request.headers).some((header) => header.startsWith('x-forwarded-'))) return false;
  if (
    [
      'cf-connecting-ip',
      'x-real-ip',
      'true-client-ip',
      'x-forwarded-for',
      'x-forwarded-host',
      'x-forwarded-proto',
      'forwarded',
      'cookie',
      'authorization',
      'x-api-key',
      'x-service-token',
    ].some((header) => request.headers[header] !== undefined)
  )
    return false;
  const path = request.url.split('?')[0];
  // Every anonymous read a public page renders server-side. One missing here shares the 240/min loopback-IP
  // bucket with every other render (all SSR arrives from 127.0.0.1), so a crawl turns it into 429 and the page
  // into 500 (2026-11-09: /blogs/* under Googlebot via /inference). Keep in step with web/src SSR reads.
  return /^\/api\/(?:overview|collection-count|catalog(?:\/authors)?|search|icons|traffic|relations|mentions|tech|content\/coverage|pages\/(?:blogs|topics)\/[^/]+|blogs\/[^/]+(?:\/(?:topics|relations|content|inference|tech|mentions(?:\/all)?))?|topics(?:\/[^/]+)?)$/.test(
    path,
  );
}
export const gatewayRateKey = (request: FastifyRequest) => (internalRenderRead(request) ? 'internal-render-read' : clientIp(request));
/** Every visitor's page reaches the gateway through this one render bucket, about eight reads a blog page, so it is
 * the whole site's page budget, not one client's: 2000/min held a Googlebot crawl to ~4 pages/s and 500'd the rest
 * (2026-11-09). Still bounded; the database keeps its own pool and overview admission limits. */
export const INTERNAL_RENDER_READS_PER_MINUTE = 12_000;
export const gatewayRateMax = (request: FastifyRequest) => (internalRenderRead(request) ? INTERNAL_RENDER_READS_PER_MINUTE : 240);
