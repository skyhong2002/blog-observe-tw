import type { FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { loadTextSimilarity } from './text-similarity-reader.ts';

/** Explicit public pair only, not a discovery engine or a claim of dialogue. */
export function registerTextSimilarityRoute(app: FastifyInstance, pool: Pool) {
  app.get<{ Querystring: { source?: unknown; target?: unknown } }>('/api/relations/text-similarity', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (process.env.BLOG_TEXT_SIMILARITY_ENABLED !== 'true') return reply.code(404).send({ error: 'not_found' });
    const id = (raw: unknown) =>
      typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
    const sourceArticleId = id(request.query.source),
      targetArticleId = id(request.query.target);
    if (!sourceArticleId || !targetArticleId || sourceArticleId === targetArticleId)
      return reply.code(400).send({ error: 'invalid_text_similarity_selection' });
    try {
      const result = await loadTextSimilarity(pool, { pairs: [{ sourceArticleId, targetArticleId }] }, { enabled: true });
      // A withdrawn or unknown article is not an empty/zero similarity result.
      if (result.status !== 'ready' || result.items.some((item) => item.status === 'unavailable'))
        return reply.code(404).send({ error: 'comparison_not_available' });
      return result;
    } catch {
      return reply.code(503).send({ error: 'text_similarity_unavailable' });
    }
  });
}
