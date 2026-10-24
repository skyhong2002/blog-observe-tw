import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { TRAFFIC_ORIGIN, tagDomain, trafficTagsUrl } from './traffic.ts';

type Options = { pool: Pick<Pool, 'query'> };

/**
 * Since 2026-10-24 (gen106) blog takes no tag votes: like tag.observe.tw, the blog page links 編輯標籤 to the
 * blog's page on traffic.observe.tw, where tags are voted on and added. The old vote, propose, admin and
 * own-votes routes answer 410 with that address, for any client still calling them.
 */
export function registerBlogGenreRoutes(app: FastifyInstance, { pool }: Options) {
  const gone = async (slug: unknown, reply: FastifyReply) => {
    let url = `${TRAFFIC_ORIGIN}/`;
    if (typeof slug === 'string' && /^[\w.-]{1,255}$/.test(slug)) {
      const [[blog]] = await pool.query<RowDataPacket[]>(
        "SET STATEMENT max_statement_time=1 FOR SELECT canonical_host host FROM blogs WHERE slug=? AND status='verified' LIMIT 1",
        [slug],
      );
      const domain = tagDomain(blog?.host);
      if (domain) url = trafficTagsUrl(domain);
    }
    return reply.code(410).header('cache-control', 'no-store').send({ error: 'tags_moved', url });
  };
  const slugOf = (params: unknown) => (params as { slug?: unknown }).slug;
  app.get('/api/me/blog-genres/:slug', async (request, reply) => gone(slugOf(request.params), reply));
  app.post('/api/blogs/:slug/genres/propose', { bodyLimit: 512 }, async (request, reply) => gone(slugOf(request.params), reply));
  for (const kind of ['vote', 'admin'])
    app.put(`/api/blogs/:slug/genres/:genre/${kind}`, { bodyLimit: 512 }, async (request, reply) => gone(slugOf(request.params), reply));
}
