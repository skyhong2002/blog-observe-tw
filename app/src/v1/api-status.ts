import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { PUBLIC_PATHS } from '../public-api/contract.ts';
import { buildOpenApi } from './openapi.ts';
/** Only the public API contract is exposed; never internal hosts, queues or credentials. */
export function registerApiStatus(app: FastifyInstance, proxy: (request: FastifyRequest, reply: FastifyReply) => unknown, pool: Pool) {
  const spec = buildOpenApi();
  let checkedAt = 0;
  let healthy = false;
  let flight: Promise<void> | null = null;
  async function available() {
    if (Date.now() - checkedAt < 5000) return healthy;
    if (!flight)
      flight = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            pool.query({ sql: 'SELECT 1', timeout: 1500 }),
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(Error('status_timeout')), 2000);
            }),
          ]);
          healthy = true;
        } catch {
          healthy = false;
        } finally {
          clearTimeout(timer);
          checkedAt = Date.now();
          flight = null;
        }
      })();
    await flight;
    return healthy;
  }
  const endpoints = PUBLIC_PATHS.map((path) => {
    const openapiPath = path.replace(/:([a-z]+)/g, '{$1}');
    return {
      path: openapiPath,
      summary: (spec.paths as Record<string, { get?: { summary?: string } }>)[openapiPath]?.get?.summary || 'OpenAPI 規格',
    };
  });
  for (const path of ['/api/status', '/api/status/']) {
    app.get(path, async (request, reply) => {
      reply.header('cache-control', 'no-store').header('vary', 'Accept, RSC');
      if (request.headers.rsc === '1' || String(request.headers.accept || '').includes('text/html')) {
        // UI proxy can replace response headers; enforce negotiation afterward.
        return proxy(request, reply);
      }
      return { status: (await available()) ? 'ok' : 'degraded', version: 'v1', endpoints, updatedAt: new Date().toISOString() };
    });
  }
  app.addHook('onSend', async (request, reply, payload) => {
    if (/^\/api\/status\/?(?:\?|$)/.test(request.url)) {
      reply.header('cache-control', 'no-store');
      const vary = new Set(
        String(reply.getHeader('vary') || '')
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      );
      vary.add('Accept');
      vary.add('RSC');
      reply.header('vary', [...vary].join(', '));
    }
    return payload;
  });
}
