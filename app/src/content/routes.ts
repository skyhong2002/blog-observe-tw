import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { TopicResponseCache } from '../topics/cache.ts';

/** Public provenance only. Stored article bodies and extraction selectors are private. */
export function registerContentRoutes(app: FastifyInstance, pool: Pool) {
  const cache = new TopicResponseCache(60000, 128);
  app.get('/api/content/coverage', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return cache.get('coverage', async () => {
      const [totals] = await pool.query<RowDataPacket[]>(`SELECT
        (SELECT COUNT(*) FROM blogs WHERE status='verified') blogs,
        (SELECT COUNT(*) FROM content_blog_rules r JOIN blogs b ON b.id=r.blog_id WHERE b.status='verified') configuredBlogs,
        (SELECT COUNT(*) FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())) posts`);
      const [states] = await pool.query<RowDataPacket[]>(`SELECT c.status,c.source_kind source,COUNT(*) count
        FROM content_post_bodies c JOIN posts p ON p.id=c.post_id JOIN blogs b ON b.id=p.blog_id WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) GROUP BY c.status,c.source_kind`);
      const [rules] = await pool.query<RowDataPacket[]>(`SELECT r.last_status status,COUNT(*) count
        FROM content_blog_rules r JOIN blogs b ON b.id=r.blog_id WHERE b.status='verified' GROUP BY r.last_status`);
      return { totals: totals[0], states, rules, publicContent: 'summary-only', observedAt: new Date().toISOString() };
    });
  });
  app.get<{ Params: { slug: string } }>('/api/blogs/:slug/content', async (request, reply) => {
    if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(request.params.slug)) return reply.code(400).send({ error: 'invalid_slug' });
    reply.header('cache-control', 'no-store');
    const result = await cache.get(`blog:${request.params.slug}`, async () => {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT b.id,b.slug,b.name,r.platform,r.last_method lastMethod,
        r.last_status status,r.last_error reason,r.last_attempt_at lastAttemptAt,r.last_success_at lastSuccessAt
        FROM blogs b LEFT JOIN content_blog_rules r ON r.blog_id=b.id WHERE b.slug=? AND b.status='verified' LIMIT 1`,
        [request.params.slug],
      );
      if (!rows[0]) return null;
      const [sources] = await pool.query<RowDataPacket[]>(
        `SELECT c.status,c.source_kind source,c.completeness,COUNT(*) count
        FROM content_post_bodies c JOIN posts p ON p.id=c.post_id JOIN blogs b ON b.id=p.blog_id WHERE b.id=? AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) GROUP BY c.status,c.source_kind,c.completeness`,
        [rows[0].id],
      );
      const { id: _privateId, ...blog } = rows[0];
      return { blog, sources, publicContent: 'summary-only' };
    });
    return result ?? reply.code(404).send({ error: 'not_found' });
  });
}
