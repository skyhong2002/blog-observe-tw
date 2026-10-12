import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { type ImageResult, ImageService } from './service.ts';
export function registerImageRoutes(app: FastifyInstance, pool: Pool, service = new ImageService(pool)) {
  const send = (request: FastifyRequest, reply: FastifyReply, result: ImageResult) => {
    reply.header('x-content-type-options', 'nosniff');
    if ('error' in result)
      return reply
        .code(result.error)
        .header('cache-control', 'no-store')
        .send({ error: result.error === 404 ? 'not_found' : 'image_unavailable' });
    reply.type('image/webp').header('cache-control', 'public, max-age=300, s-maxage=300').header('etag', result.etag);
    if (request.headers['if-none-match'] === result.etag) return reply.code(304).send();
    return reply.send(result.body);
  };
  app.get<{ Params: { id: string; width: string } }>('/images/posts/:id/:width.webp', async (request, reply) => {
    if (!/^[1-9]\d{0,14}$/.test(request.params.id) || !/^(160|320|640|960)$/.test(request.params.width))
      return send(request, reply, { error: 404 });
    return send(request, reply, await service.post(Number(request.params.id), Number(request.params.width)));
  });
  app.get<{ Params: { slug: string; size: string } }>('/images/icons/:slug/:size.webp', async (request, reply) => {
    if (!/^(16|32|64|96)$/.test(request.params.size)) return send(request, reply, { error: 404 });
    return send(request, reply, await service.icon(request.params.slug, Number(request.params.size)));
  });
}
