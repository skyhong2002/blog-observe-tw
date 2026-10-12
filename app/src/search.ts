import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { publicPost, publicSummary } from './public-post.ts';
import { TopicResponseCache } from './topics/cache.ts';

export const SEARCH_SCOPE_LIMIT = 1000;
export function searchFilters(query: Record<string, unknown>) {
  const q = typeof query.q === 'string' ? query.q.trim().normalize('NFKC') : '';
  if (!q || Array.from(q).length > 80 || /[\p{Cc}\p{Cf}]/u.test(q)) return null;
  const number = (raw: unknown, fallback: number, max: number) =>
    raw === undefined ? fallback : typeof raw === 'string' && /^[1-9]\d*$/.test(raw) && Number(raw) <= max ? Number(raw) : null;
  const page = number(query.page, 1, 50),
    limit = number(query.limit, 20, 20);
  const blog =
    query.blog === undefined ? '' : typeof query.blog === 'string' && /^[\p{L}\p{N}_.-]{1,255}$/u.test(query.blog) ? query.blog : null;
  return page && limit && blog !== null ? { q, page, limit, blog } : null;
}
export async function loadSearch(pool: Pool, filters: NonNullable<ReturnType<typeof searchFilters>>) {
  const { q, page, limit, blog } = filters;
  const scope = `SELECT p.id FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) ${blog ? 'AND b.slug=?' : ''} ORDER BY p.id DESC LIMIT ${SEARCH_SCOPE_LIMIT + 1}`;
  const [scopeRows] = await pool.query<RowDataPacket[]>(scope, blog ? [blog] : []);
  const ids = scopeRows.slice(0, SEARCH_SCOPE_LIMIT).map((row) => Number(row.id));
  if (!ids.length)
    return {
      items: [],
      pagination: { page, pageSize: limit, hasMore: false },
      coverage: { type: 'recent-indexed-posts', limit: SEARCH_SCOPE_LIMIT, scannedPosts: 0, truncated: false },
    };
  const pattern = `%${q.replace(/[=%_]/g, '=$&')}%`;
  const body = "CASE WHEN c.status='ok' THEN c.body_text ELSE '' END";
  // Search bounded IDs inside SQL. Only a <=700-character excerpt ever leaves the body table.
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id,p.title,p.url,p.guid,p.summary,p.author,p.published_at publishedAt,p.image_url imageUrl,b.slug blogSlug,b.name blogName,
    CASE WHEN ${body} LIKE ? ESCAPE '=' THEN SUBSTRING(${body},GREATEST(1,LOCATE(?,${body})-80),700) ELSE LEFT(p.summary,1400) END searchExcerpt,
    CASE WHEN ${body} LIKE ? ESCAPE '=' THEN 'body' ELSE 'metadata' END matchSource
    FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN content_post_bodies c ON c.post_id=p.id
    WHERE p.id IN (?) AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) AND (
      p.title LIKE ? ESCAPE '=' OR p.summary LIKE ? ESCAPE '=' OR b.name LIKE ? ESCAPE '=' OR ${body} LIKE ? ESCAPE '='
      OR EXISTS(SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND pt.status='active' AND t.status='active' AND t.visibility='public' AND t.label LIKE ? ESCAPE '='))
    ORDER BY p.id DESC LIMIT ? OFFSET ?`,
    [pattern, q, pattern, ids, pattern, pattern, pattern, pattern, pattern, limit + 1, (page - 1) * limit],
  );
  return {
    items: rows
      .slice(0, limit)
      .map((row) => ({ ...publicPost(row), snippet: publicSummary(row.searchExcerpt, 240), matchSource: row.matchSource })),
    pagination: { page, pageSize: limit, hasMore: rows.length > limit },
    coverage: {
      type: 'recent-indexed-posts',
      limit: SEARCH_SCOPE_LIMIT,
      scannedPosts: ids.length,
      truncated: scopeRows.length > SEARCH_SCOPE_LIMIT,
    },
  };
}
export function registerSearchRoutes(app: FastifyInstance, pool: Pool) {
  const cache = new TopicResponseCache(60000, 128);
  let active = 0;
  app.get<{ Querystring: Record<string, unknown> }>('/api/search', async (req, reply) => {
    const filters = searchFilters(req.query);
    if (!filters) return reply.code(400).send({ error: 'invalid_search', limits: { queryCharacters: 80, page: 50, pageSize: 20 } });
    reply.header('cache-control', 'no-store');
    try {
      return await cache.get(JSON.stringify(filters), async () => {
        if (active >= 2) throw Object.assign(Error('search_busy'), { statusCode: 503 });
        active++;
        try {
          return { ...(await loadSearch(pool, filters)), query: filters.q, generatedAt: new Date().toISOString(), cacheSeconds: 0 };
        } finally {
          active--;
        }
      });
    } catch {
      return reply.header('cache-control', 'no-store').code(503).send({ error: 'search_unavailable' });
    }
  });
}
