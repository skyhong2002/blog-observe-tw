import type { FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { historyReadsEnabled } from '../topics/history-contracts.ts';
import { topicHistoryDisposition } from '../topics/history-read.ts';
import { getPageIndexability } from './indexability.ts';
import { type PublicPageKind, resolvePublicPage } from './page-routes.ts';

/** Read-only page metadata. Fastify decodes the path parameter once; never decode it again. */
export function registerPageApi(app: FastifyInstance, pool: Pool) {
  for (const [segment, kind] of [
    ['blogs', 'blog'],
    ['topics', 'topic'],
  ] as const satisfies readonly (readonly [string, PublicPageKind])[]) {
    app.get<{ Params: { key: string } }>(`/api/pages/${segment}/:key`, async (request, reply) => {
      // One disposition read per request: the page and its counts follow the same visibility verdict.
      const state = kind === 'topic' && historyReadsEnabled() ? await topicHistoryDisposition(pool, request.params.key) : undefined;
      if (state?.status === 'gone') return reply.code(410).header('cache-control', 'no-store').send({ error: 'topic_gone' });
      if (state && state.status !== 'available') return reply.code(404).header('cache-control', 'no-store').send({ error: 'not_found' });
      const page = await resolvePublicPage(pool, kind, request.params.key, state);
      if (!page) return reply.code(404).header('cache-control', 'no-store').send({ error: 'not_found' });
      const metadata = await getPageIndexability(pool, kind, page.entityId, state);
      return reply.header('cache-control', 'no-store').send({ page: { ...page, ...metadata } });
    });
  }
}
