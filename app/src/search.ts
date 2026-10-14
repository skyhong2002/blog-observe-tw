import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { publicPost, publicSummary } from './public-post.ts';
import { loadFulltextSearch } from './search-fulltext.ts';
import { loadIndexedBodySearch } from './search-body-index.ts';
import {
  boundedSearchStatement,
  isSearchTimeout,
  literalSearchPattern,
  PUBLIC_SEARCH_SQL,
  SEARCH_MATCH_VERSION,
  SEARCH_STATEMENT_MS,
} from './search-bounds.ts';

export const SEARCH_SCOPE_LIMIT = 1000;
// Opt-in, partial local prefix index. No global historical body LIKE scan.
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
  if (process.env.BLOG_SEARCH_FULLTEXT_ENABLED === 'true' && Array.from(filters.q).length >= 2) return loadFulltextSearch(pool, filters);
  const { q, page, limit, blog } = filters;
  // IDs describe ingestion order, not article publication recency.
  const scope = `SELECT p.id FROM posts p FORCE INDEX (PRIMARY) STRAIGHT_JOIN blogs b ON b.id=p.blog_id WHERE ${PUBLIC_SEARCH_SQL} ${blog ? 'AND b.slug=?' : ''} ORDER BY p.id DESC LIMIT ${SEARCH_SCOPE_LIMIT + 1}`;
  const [scopeRows] = await pool.query<RowDataPacket[]>(boundedSearchStatement(scope, true), blog ? [blog] : []);
  const candidates = scopeRows.slice(0, SEARCH_SCOPE_LIMIT).map((row) => Number(row.id));
  const pattern = literalSearchPattern(q);
  const indexed = options.historicalBody ? await loadIndexedBodySearch(pool, q, blog) : null;
  const coverage = {
    type: options.historicalBody ? 'bounded-ingestion-metadata-and-partial-indexed-body' : 'bounded-ingestion-metadata',
    limit: SEARCH_SCOPE_LIMIT,
    scannedPosts: candidates.length,
    truncated: scopeRows.length > SEARCH_SCOPE_LIMIT,
    metadata: { scope: 'latest-ingested-ids', fields: ['title', 'summary', 'blog-name', 'public-tags'], exhaustive: false },
    historicalBody: indexed?.coverage ?? { status: 'not-enabled', exhaustive: false },
    statementTimeoutMs: SEARCH_STATEMENT_MS,
    maximumStatements: options.historicalBody ? 4 : 2,
  };
  if (!candidates.length) {
    const hits = indexed?.items ?? [];
    return {
      items: hits.slice((page - 1) * limit, page * limit),
      pagination: { page, pageSize: limit, hasMore: hits.length > page * limit },
      coverage,
    };
  }
  const parameters: unknown[] = [];
  const bind = (value: unknown) => {
    parameters.push(value);
    return '?';
  };
  const match = (field: string) => `${field} LIKE ${bind(pattern)} ESCAPE '='`;
  const excerpt = (field: string) => `SUBSTRING(${field},GREATEST(1,LOCATE(${bind(q)},${field})-80),700)`;
  const tags = () =>
    `SELECT t.label FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND pt.status='active' AND t.status='active' AND t.visibility='public' AND ${match('t.label')} ORDER BY t.id LIMIT 1`;
  const excerptCase = `CASE WHEN ${match('p.title')} THEN ${excerpt('p.title')}
    WHEN ${match('p.summary')} THEN ${excerpt('p.summary')} WHEN ${match('b.name')} THEN LEFT(b.name,700)
    ELSE LEFT((${tags()}),700) END`;
  const matchSource = `'metadata'`;
  const contextSource = `CASE WHEN ${match('p.title')} THEN 'title'
    WHEN ${match('p.summary')} THEN 'summary' WHEN ${match('b.name')} THEN 'blog-name' ELSE 'tag' END`;
  const candidatePlaceholder = bind(candidates);
  const blogPredicate = blog ? `AND b.slug=${bind(blog)}` : '';
  const where = `${match('p.title')} OR ${match('p.summary')} OR ${match('b.name')}
      OR EXISTS(SELECT 1 FROM post_tags pt JOIN tags t ON t.id=pt.tag_id WHERE pt.post_id=p.id AND pt.status='active' AND t.status='active' AND t.visibility='public' AND ${match('t.label')})`;
  const pageLimit = bind(options.historicalBody ? page * limit + 1 : limit + 1),
    offset = bind(options.historicalBody ? 0 : (page - 1) * limit);
  // Metadata-only lookup over explicit bounded IDs. Body bytes belong to the separate local index verifier.
  const [rows] = await pool.query<RowDataPacket[]>(
    boundedSearchStatement(
      `SELECT p.id,p.title,p.url,p.guid,LEFT(p.summary,2000) summary,p.author,p.published_at publishedAt,p.image_url imageUrl,b.slug blogSlug,b.name blogName,
    ${excerptCase} searchExcerpt, ${matchSource} matchSource, ${contextSource} contextSource
    FROM posts p JOIN blogs b ON b.id=p.blog_id
    WHERE p.id IN (${candidatePlaceholder}) AND ${PUBLIC_SEARCH_SQL} ${blogPredicate} AND (${where})
    ORDER BY p.id DESC LIMIT ${pageLimit} OFFSET ${offset}`,
      true,
    ),
    parameters,
  );
  const metadataItems = rows.map((row) => ({
    ...publicPost(row),
    articleId: row.id,
    snippet: publicSummary(row.searchExcerpt, 240),
    matchSource: row.matchSource,
    contextSource: row.contextSource ?? (row.matchSource === 'body' ? 'body' : 'metadata'),
    matchVersion: SEARCH_MATCH_VERSION,
  }));
  const merged = [...new Map([...metadataItems, ...(indexed?.items ?? [])].map((item) => [Number(item.articleId), item])).values()].sort(
    (a, b) => Number(b.articleId) - Number(a.articleId),
  );
  const start = options.historicalBody ? (page - 1) * limit : 0;
  return {
    items: merged.slice(start, start + limit),
    pagination: { page, pageSize: limit, hasMore: merged.length > start + limit },
    coverage,
  };
}
export function registerSearchRoutes(app: FastifyInstance, pool: Pool) {
  let active = 0;
  app.get<{ Querystring: Record<string, unknown> }>('/api/search', async (req, reply) => {
    const filters = searchFilters(req.query);
    if (!filters) return reply.code(400).send({ error: 'invalid_search', limits: { queryCharacters: 80, page: 50, pageSize: 20 } });
    reply.header('cache-control', 'no-store');
    try {
      if (active >= 2) throw Object.assign(Error('search_busy'), { statusCode: 503 });
      active++;
      try {
        return { ...(await loadSearch(pool, filters)), query: filters.q, generatedAt: new Date().toISOString(), cacheSeconds: 0 };
      } finally {
        active--;
      }
    } catch (error) {
      return reply
        .header('cache-control', 'no-store')
        .code(503)
        .send({ error: isSearchTimeout(error) ? 'search_timeout' : 'search_unavailable' });
    }
  });
}
