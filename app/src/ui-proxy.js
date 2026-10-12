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
  /** @param {string} [pathOverride] Trusted internal path; still passes origin/path validation. */
  return async function proxyToUi(req, reply, pathOverride = undefined) {
    // Fastify's catch-all also receives path-preserving requests.  Never let
    // WHATWG URL parsing reinterpret `//host` as a new origin, and do not
    // carry gateway credentials into the UI origin (or an attacker-controlled
    // URL if a future route regresses this guard).
    const originalPath = String(req.raw.url ?? req.url ?? '');
    if (pathOverride !== undefined && (typeof pathOverride !== 'string' || !['GET', 'HEAD'].includes(req.method)))
      return reply.code(400).send({ error: 'invalid path' });
    const rawPath = pathOverride ?? originalPath;
    for (const candidate of new Set([originalPath, rawPath])) {
      let decodedPath = candidate;
      try {
        decodedPath = decodeURIComponent(candidate);
      } catch {
        return reply.code(400).send({ error: 'invalid path' });
      }
      if (
        !candidate.startsWith('/') ||
        candidate.startsWith('//') ||
        candidate.startsWith('/\\') ||
        /^\/(?:%2f|%5c)/i.test(candidate) ||
        decodedPath.startsWith('//') ||
        decodedPath.startsWith('/\\') ||
        /^[a-z][a-z\d+.-]*:/i.test(candidate)
      ) {
        return reply.code(400).send({ error: 'invalid path' });
      }
    }
    const path = rawPath;
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
