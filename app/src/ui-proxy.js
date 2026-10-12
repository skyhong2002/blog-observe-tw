import { request as undiciRequest } from 'undici';

// Everything that is not the gateway's own API is rendered by the Next.js SSR
// app on UI_ORIGIN (loopback only), including its 404 page.
const HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
]);

export function createUiProxy(origin, { request = undiciRequest, timeout = 15000 } = {}) {
  const base = new URL(origin);
  return async function proxyToUi(req, reply) {
    // Fastify's catch-all also receives path-preserving requests.  Never let
    // WHATWG URL parsing reinterpret `//host` as a new origin, and do not
    // carry gateway credentials into the UI origin (or an attacker-controlled
    // URL if a future route regresses this guard).
    const rawPath = String(req.raw.url ?? req.url ?? '');
    let decodedPath = rawPath;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      return reply.code(400).send({ error: 'invalid path' });
    }
    if (
      !rawPath.startsWith('/') ||
      rawPath.startsWith('//') ||
      rawPath.startsWith('/\\') ||
      /^\/(?:%2f|%5c)/i.test(rawPath) ||
      decodedPath.startsWith('//') ||
      decodedPath.startsWith('/\\') ||
      /^[a-z][a-z\d+.-]*:/i.test(rawPath)
    ) {
      return reply.code(400).send({ error: 'invalid path' });
    }
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const target = new URL(`${base.origin}${path}`);
    if (target.host !== base.host) return reply.code(400).send({ error: 'invalid upstream' });
    const headers = {};
    for (const [key, value] of Object.entries(req.headers))
      if (!HOP.has(key) && key !== 'host' && key !== 'cookie' && key !== 'authorization' && key !== 'x-api-key') headers[key] = value;
    headers['x-forwarded-host'] = req.headers.host ?? '';
    headers['x-forwarded-proto'] = req.headers['x-forwarded-proto'] ?? 'https';
    let upstream;
    try {
      upstream = await request(target, { method: req.method, headers, headersTimeout: timeout, bodyTimeout: timeout });
    } catch (error) {
      req.log.warn({ err: error?.message }, 'ui origin unavailable');
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .header('retry-after', '5')
        .header('x-blog-outcome', 'ui-down')
        .send('UI temporarily unavailable\n');
    }
    reply.code(upstream.statusCode);
    for (const [key, value] of Object.entries(upstream.headers)) if (!HOP.has(key)) reply.header(key, value);
    reply.header('x-blog-outcome', 'ui');
    if (req.method === 'HEAD') {
      await upstream.body.dump();
      return reply.send();
    }
    return reply.send(upstream.body);
  };
}
