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
  return /^\/api\/(?:overview|collection-count|catalog(?:\/authors)?|search|icons|traffic|relations|content\/coverage|pages\/(?:blogs|topics)\/[^/]+|blogs\/[^/]+(?:\/(?:topics|relations|content))?|topics(?:\/[^/]+)?)$/.test(
    path,
  );
}
export const gatewayRateKey = (request: FastifyRequest) => (internalRenderRead(request) ? 'internal-render-read' : clientIp(request));
export const gatewayRateMax = (request: FastifyRequest) => (internalRenderRead(request) ? 2000 : 240);
