import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { publicPost, publicSummary } from './public-post.ts';
import {
  boundedSearchStatement,
  CURRENT_BODY_SQL,
  HISTORICAL_BODY_LIMIT,
  isSearchTimeout,
  literalSearchPattern,
  PUBLIC_SEARCH_SQL,
  SEARCH_MATCH_VERSION,
  SEARCH_STATEMENT_MS,
} from './search-bounds.ts';
import { TopicResponseCache } from './topics/cache.ts';

export const SEARCH_SCOPE_LIMIT = 1000;
// Experimental recall fix over existing MariaDB bodies, not a new index.
// Keep disabled until statement-timeout behavior and cost are verified in isolation.
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
export async function loadSearch(
  pool: Pool,
  filters: NonNullable<ReturnType<typeof searchFilters>>,
  options = { historicalBody: process.env.BLOG_SEARCH_HISTORICAL_BODY_ENABLED === 'true' },
) {
  const { q, page, limit, blog } = filters;
  const scope = `SELECT p.id FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) ${blog ? 'AND b.slug=?' : ''} ORDER BY p.id DESC LIMIT ${SEARCH_SCOPE_LIMIT + 1}`;
  const [scopeRows] = await pool.query<RowDataPacket[]>(boundedSearchStatement(scope, options.historicalBody), blog ? [blog] : []);
  const ids = scopeRows.slice(0, SEARCH_SCOPE_LIMIT).map((row) => Number(row.id));
  const pattern = literalSearchPattern(q);
  let historicalRows: RowDataPacket[] = [];
  if (options.historicalBody) {
    [historicalRows] = await pool.query<RowDataPacket[]>(
      boundedSearchStatement(
        `SELECT p.id FROM content_post_bodies c JOIN posts p ON p.id=c.post_id JOIN blogs b ON b.id=p.blog_id
         WHERE ${PUBLIC_SEARCH_SQL} AND ${CURRENT_BODY_SQL} ${blog ? 'AND b.slug=?' : ''}
         AND c.body_text LIKE ? ESCAPE '=' ORDER BY p.id DESC LIMIT ${HISTORICAL_BODY_LIMIT + 1}`,
        true,
      ),
      blog ? [blog, pattern] : [pattern],
    );
    ids.push(...historicalRows.slice(0, HISTORICAL_BODY_LIMIT).map((row) => Number(row.id)));
  }
  const candidates = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0);
  const coverage = {
    type: options.historicalBody ? 'recent-metadata-and-bounded-historical-body' : 'recent-indexed-posts',
    limit: SEARCH_SCOPE_LIMIT,
    scannedPosts: Math.min(scopeRows.length, SEARCH_SCOPE_LIMIT),
    truncated: scopeRows.length > SEARCH_SCOPE_LIMIT || historicalRows.length > HISTORICAL_BODY_LIMIT,
    ...(options.historicalBody
      ? {
          historicalBody: {
            candidateLimit: HISTORICAL_BODY_LIMIT,
            candidates: Math.min(historicalRows.length, HISTORICAL_BODY_LIMIT),
            truncated: historicalRows.length > HISTORICAL_BODY_LIMIT,
            statementTimeoutMs: SEARCH_STATEMENT_MS,
            maximumStatements: 3,
            bodyCoverage: 'current-ok-evidence-only',
          },
        }
      : {}),
  };
  if (!candidates.length)
    return {
      items: [],
      pagination: { page, pageSize: limit, hasMore: false },
      coverage,
    };
  const body = `CASE WHEN ${CURRENT_BODY_SQL} THEN c.body_text ELSE '' END`;
  const parameters: unknown[] = [];
  const bind = (value: unknown) => {
    parameters.push(value);
    return '?';
  };
  const match = (field: string) => `${field} LIKE ${bind(pattern)} ESCAPE '='`;
  const excerpt = (field: string) => `SUBSTRING(${field},GREATEST(1,LOCATE(${bind(q)},${field})-80),700)`;
  const tags = () =>
    `SELECT t.label FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND pt.status='active' AND t.status='active' AND t.visibility='public' AND ${match('t.label')} ORDER BY t.id LIMIT 1`;
  const excerptCase = `CASE WHEN ${match(body)} THEN ${excerpt(body)} WHEN ${match('p.title')} THEN ${excerpt('p.title')}
    WHEN ${match('p.summary')} THEN ${excerpt('p.summary')} WHEN ${match('b.name')} THEN LEFT(b.name,700)
    ELSE LEFT((${tags()}),700) END`;
  const matchSource = `CASE WHEN ${match(body)} THEN 'body' ELSE 'metadata' END`;
  const contextSource = `CASE WHEN ${match(body)} THEN 'body' WHEN ${match('p.title')} THEN 'title'
    WHEN ${match('p.summary')} THEN 'summary' WHEN ${match('b.name')} THEN 'blog-name' ELSE 'tag' END`;
  const candidatePlaceholder = bind(candidates);
  const blogPredicate = blog ? `AND b.slug=${bind(blog)}` : '';
  const where = `${match('p.title')} OR ${match('p.summary')} OR ${match('b.name')} OR ${match(body)}
      OR EXISTS(SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND pt.status='active' AND t.status='active' AND t.visibility='public' AND ${match('t.label')})`;
  const pageLimit = bind(limit + 1),
    offset = bind((page - 1) * limit);
  // Search bounded IDs inside SQL. Only a <=700-character excerpt ever leaves the body table.
  const [rows] = await pool.query<RowDataPacket[]>(
    boundedSearchStatement(
      `SELECT p.id,p.title,p.url,p.guid,p.summary,p.author,p.published_at publishedAt,p.image_url imageUrl,b.slug blogSlug,b.name blogName,
    ${excerptCase} searchExcerpt, ${matchSource} matchSource, ${contextSource} contextSource
    FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN content_post_bodies c ON c.post_id=p.id
    WHERE p.id IN (${candidatePlaceholder}) AND ${PUBLIC_SEARCH_SQL} ${blogPredicate} AND (${where})
    ORDER BY p.id DESC LIMIT ${pageLimit} OFFSET ${offset}`,
      options.historicalBody,
    ),
    parameters,
  );
  return {
    items: rows.slice(0, limit).map((row) => ({
      ...publicPost(row),
      articleId: row.id,
      snippet: publicSummary(row.searchExcerpt, 240),
      matchSource: row.matchSource,
      contextSource: row.contextSource ?? (row.matchSource === 'body' ? 'body' : 'metadata'),
      matchVersion: SEARCH_MATCH_VERSION,
    })),
    pagination: { page, pageSize: limit, hasMore: rows.length > limit },
    coverage,
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
    } catch (error) {
      return reply
        .header('cache-control', 'no-store')
        .code(503)
        .send({ error: isSearchTimeout(error) ? 'search_timeout' : 'search_unavailable' });
    }
  });
}
