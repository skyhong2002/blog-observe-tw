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
