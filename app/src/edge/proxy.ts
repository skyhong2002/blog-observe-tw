import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { createServer, request as httpRequest } from 'node:http';
import { serveAsset } from './assets.ts';
import { SLOTS, type StateReader } from './state.ts';

const HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
]);
export function endToEndHeaders(input: IncomingHttpHeaders): OutgoingHttpHeaders {
  const excluded = new Set([...HOP, ...(input.connection ?? '').split(',').map((name) => name.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => value !== undefined && !excluded.has(key.toLowerCase())));
}
export function safePath(path: string): boolean {
  try {
    const pathname = path.split('?')[0];
    const decoded = decodeURIComponent(pathname);
    return (
      path.startsWith('/') && !path.startsWith('//') && !/[\\\r\n\0]/.test(path) && !decoded.startsWith('//') && !/[\\\r\n\0]/.test(decoded)
    );
  } catch {
    return false;
  }
}

/** Content-bearing responses must not outlive visibility changes in another cache layer. */
export function immutableAssetPath(raw: string): boolean {
  const path = raw.split('?')[0];
  return path.startsWith('/_next/static/') || /^\/favicons\/[a-zA-Z0-9._-]+\.(?:png|webp|svg|ico)$/.test(path);
}

export function createEdge({
  state,
  assets,
  request = httpRequest,
}: {
  state: Pick<StateReader, 'get'>;
  assets: string;
  request?: typeof httpRequest;
}) {
  const server = createServer(async (req, res) => {
    const https = req.headers['x-forwarded-proto'] === 'https';
    if (https) res.setHeader('strict-transport-security', 'max-age=86400');
    const mutable = !immutableAssetPath(req.url ?? '');
    if (mutable) res.setHeader('cache-control', 'private, no-store');
    if (!safePath(req.url ?? '')) {
      res.writeHead(400, { 'cache-control': 'no-store' });
      res.end('Invalid path');
      return;
    }
    const fail = () => {
      if (res.writableEnded || res.destroyed) return;
      if (res.headersSent) res.destroy();
      else {
        res.writeHead(503, { 'cache-control': 'no-store', 'retry-after': '2' });
        res.end('Service unavailable');
      }
    };
    try {
      const selected = await state.get();
      res.setHeader('x-blog-edge-generation', String(selected.generation));
      res.setHeader('x-blog-release', selected.commit);
      if (await serveAsset(assets, req, res)) return;
      if (req.destroyed || res.destroyed) return;
      // Never parse the request target as a URL, follow redirects, or replay a request.
      // Cookie/auth headers go ONLY to one of these two fixed local gateways.
      let responseStarted = false;
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: SLOTS[selected.active].gateway,
          method: req.method,
          path: req.url,
          headers: endToEndHeaders(req.headers),
          agent: false,
        },
        (response) => {
          responseStarted = true;
          clearTimeout(headersDeadline);
          response.setTimeout(60_000, () => response.destroy(Error('body_timeout')));
          const headers = endToEndHeaders(response.headers);
          if (mutable) {
            headers['cache-control'] = 'private, no-store';
            for (const key of ['cdn-cache-control', 'cloudflare-cdn-cache-control', 'surrogate-control', 'expires']) delete headers[key];
          }
          // This edge owns host-only HSTS; an upstream must not widen the scope.
          delete headers['strict-transport-security'];
          delete headers['x-blog-edge-generation'];
          delete headers['x-blog-release'];
          res.writeHead(response.statusCode ?? 502, headers);
          response.on('error', fail);
          response.pipe(res);
        },
      );
      const headersDeadline = setTimeout(() => upstream.destroy(Error('headers_timeout')), 30_000).unref();
      // An early upstream response (e.g. 413 while uploading) can close its
      // request side. Only response-stream errors may truncate a begun reply.
      upstream.on('error', () => {
        clearTimeout(headersDeadline);
        if (!responseStarted) fail();
      });
      req.on('aborted', () => upstream.destroy());
      req.on('error', () => upstream.destroy());
      res.on('close', () => {
        clearTimeout(headersDeadline);
        upstream.destroy();
      });
      req.pipe(upstream);
    } catch {
      fail();
    }
  });
  server.headersTimeout = 30_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;
  // No current blog endpoint uses WebSocket/CONNECT; fail rather than create a tunnel.
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n'));
  server.on('connect', (_request, socket) => socket.end('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n'));
  return server;
}
