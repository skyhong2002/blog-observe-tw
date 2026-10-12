import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { API_CACHE } from '../public-api/contract.ts';
import { findPublicBlog, listArticles, listBlogs } from '../public-api/data.ts';
import { articleQuery, badQuery, blogsQuery, hoursValue, limitValue, queryValues, slugValue } from '../public-api/query.ts';
import { relationsDto } from '../public-api/relations.ts';
import { listTopics, topicDetail } from '../public-api/topics.ts';
import { readBlogRelations, readPublicRelations } from '../relations/routes.ts';
import { TopicResponseCache } from '../topics/cache.ts';
import { historyReadsEnabled } from '../topics/history-contracts.ts';

/** Public reads never authenticate sessions, expose crawler bodies, or invoke remote services. */
export function registerPublicApi(app: FastifyInstance, pool: Pool) {
  const cache = new TopicResponseCache(120000, 128);
  const options = { config: { rateLimit: false } } as const;
  const safe =
    <T extends { Params?: unknown } = Record<never, never>>(handler: (req: FastifyRequest<T>, reply: FastifyReply) => Promise<unknown>) =>
    async (req: FastifyRequest<T>, reply: FastifyReply) => {
      try {
        return await handler(req, reply);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const status =
          message === 'topic_gone'
            ? 410
            : message === 'not_found'
              ? 404
              : ['invalid_query', 'invalid_cursor', 'invalid_history_cursor'].includes(message)
                ? 400
                : 503;
        return reply
          .header('cache-control', 'private, no-store')
          .code(status)
          .send({ error: status === 503 ? 'unavailable' : message });
      }
    };
  const missing = () => Object.assign(Error('not_found'), { statusCode: 404 });
  const cached = <T>(key: string, load: () => Promise<T>) => cache.get(key, load);
  const publicBlog = (slug: string) => cached(`blog:${slug}`, () => findPublicBlog(pool, slug));
  const articles = (raw: Record<string, string>, slug?: string) => {
    const q = articleQuery(raw, slug);
    const key = JSON.stringify({
      q: q.q,
      blog: q.blog,
      limit: q.limit,
      cursor: raw.cursor ?? null,
      hours: raw.since ? null : Number(raw.hours ?? 720),
      since: raw.since ?? null,
      until: raw.until ?? null,
    });
    return cached(`articles:${key}`, async () => {
      if (q.blog && !(await publicBlog(q.blog))) throw missing();
      return listArticles(pool, q);
    });
  };
  app.get(
    '/api/v1/articles',
    options,
    safe(async (req, reply) => {
      const q = queryValues(req.query, ['limit', 'cursor', 'hours', 'q', 'blog', 'since', 'until']);
      reply.header('cache-control', API_CACHE);
      return articles(q);
    }),
  );
  app.get(
    '/api/v1/blogs',
    options,
    safe(async (req, reply) => {
      const q = blogsQuery(queryValues(req.query, ['limit', 'cursor', 'q']));
      reply.header('cache-control', API_CACHE);
      return cached(`blogs:${JSON.stringify({ q: q.q, after: q.after, limit: q.limit })}`, () => listBlogs(pool, q));
    }),
  );
  app.get<{ Params: { slug: string } }>(
    '/api/v1/blogs/:slug',
    options,
    safe<{ Params: { slug: string } }>(async (req, reply) => {
      queryValues(req.query, []);
      const slug = slugValue(req.params.slug),
        blog = await publicBlog(slug);
      if (!blog) throw missing();
      reply.header('cache-control', API_CACHE);
      return cached(`profile:${slug}`, async () => {
        const [feeds] = await pool.query<RowDataPacket[]>('SELECT url,type FROM feed_sources WHERE blog_id=? ORDER BY id LIMIT 20', [
          blog.id,
        ]);
        return { blog: { ...blog, feeds: feeds.map((f) => ({ url: f.url, type: f.type })) } };
      });
    }),
  );
  app.get<{ Params: { slug: string } }>(
    '/api/v1/blogs/:slug/articles',
    options,
    safe<{ Params: { slug: string } }>(async (req, reply) => {
      const q = queryValues(req.query, ['limit', 'cursor', 'hours', 'q', 'since', 'until']);
      reply.header('cache-control', API_CACHE);
      return articles(q, req.params.slug);
    }),
  );
  app.get(
    '/api/v1/relations',
    options,
    safe(async (req, reply) => {
      const hours = hoursValue(queryValues(req.query, ['hours']).hours);
      reply.header('cache-control', API_CACHE);
      return relationsDto(await readPublicRelations(pool, hours / 24), hours);
    }),
  );
  app.get<{ Params: { slug: string } }>(
    '/api/v1/blogs/:slug/relations',
    options,
    safe<{ Params: { slug: string } }>(async (req, reply) => {
      const hours = hoursValue(queryValues(req.query, ['hours']).hours),
        slug = slugValue(req.params.slug);
      const blog = await publicBlog(slug);
      if (!blog) throw missing();
      reply.header('cache-control', API_CACHE);
      return relationsDto(await readBlogRelations(pool, blog, hours / 24), hours);
    }),
  );
  app.get(
    '/api/v1/topics',
    options,
    safe(async (req, reply) => {
      const q = queryValues(req.query, ['hours', 'limit']),
        hours = hoursValue(q.hours),
        limit = limitValue(q.limit);
      reply.header('cache-control', API_CACHE);
      const result = await cached(`topics:${hours}`, () => listTopics(pool, hours, 200));
      return { ...result, items: result.items.slice(0, limit), truncated: result.truncated || result.items.length > limit };
    }),
  );
  app.get<{ Params: { id: string } }>(
    '/api/v1/topics/:id',
    options,
    safe<{ Params: { id: string } }>(async (req, reply) => {
      const query = queryValues(req.query, historyReadsEnabled() ? ['hours', 'historyCursor'] : ['hours']);
      const hours = hoursValue(query.hours),
        id = req.params.id;
      if (!/^(rss:[1-9]\d{0,9}|tag:[0-9a-f]{64})$/.test(id)) throw badQuery();
      if (historyReadsEnabled()) {
        reply.header('cache-control', 'no-store');
        const result = await topicDetail(pool, id, hours, query.historyCursor);
        if (!result) throw missing();
        return reply.send(result);
      }
      const result = await cached(`topic:${hours}:${id}`, () => topicDetail(pool, id, hours));
      if (!result) throw missing();
      reply.header('cache-control', API_CACHE);
      return result;
    }),
  );
}
