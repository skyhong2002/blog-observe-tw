import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';

/** Same verified-blog population as catalog.totals.blogs; no facets or row enrichment. */
export function registerCollectionCount(app: FastifyInstance, pool: Pool) {
  app.get('/api/collection-count', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!request.query || typeof request.query !== 'object' || Array.isArray(request.query) || Object.keys(request.query).length) {
      return reply.code(400).send({ error: 'invalid_query' });
    }
    try {
      const [[row]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS blogs FROM blogs WHERE status='verified'");
      // mysql2 may return COUNT as a number or decimal string. Never turn a missing or invalid value into zero.
      const raw = row?.blogs;
      if (!(typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw)))) throw new Error('invalid count');
      const blogs = Number(raw);
      if (!Number.isSafeInteger(blogs) || blogs < 0) throw new Error('invalid count');
      return { blogs };
    } catch {
      return reply.code(503).send({ error: 'unavailable' });
    }
  });
}
