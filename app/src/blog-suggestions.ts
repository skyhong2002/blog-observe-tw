import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { SessionUser } from './auth/google-login.ts';
import { isAllowedCrawlUrl } from './crawl/feed.ts';
import { publicationDecision } from './relations/identity.ts';

// Readers ask whether a blog is collected and, when it is not, add it to the
// discovery queue. A suggestion is an ordinary candidate: the automatic review
// (crawl/candidate-review.ts) checks its homepage, feed and personal identity
// like any other, and takes the name from the homepage.
export const READER_SUGGESTION = 'reader-suggestion';
export const DAILY_SUGGESTIONS = 20;

export type SuggestionState =
  | { state: 'invalid'; reason: string }
  | { state: 'listed'; home: string; slug: string; name: string }
  | { state: 'unlisted'; home: string }
  | { state: 'queued'; home: string; checkedAt: string | null; reason: string | null }
  | { state: 'rejected'; home: string }
  | { state: 'new'; home: string };

/** A typed address or bare domain (「thelingwu.com」) as its publication home, or why it cannot be one. */
export function suggestionHome(input: unknown): { home: string } | { reason: string } {
  const text = typeof input === 'string' ? input.normalize('NFKC').trim() : '';
  if (!text || text.length > 1024 || /\s/.test(text)) return { reason: 'not_an_address' };
  const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { reason: 'not_an_address' };
  }
  // A domain needs a dot and a letter TLD; plain words typed into search are not addresses.
  if (!/\.[a-z¡-￿-]{2,}$/i.test(host) || !isAllowedCrawlUrl(url)) return { reason: 'not_an_address' };
  const decision = publicationDecision(url);
  return decision.home ? { home: decision.home } : { reason: decision.reason };
}

/** host[/owner path] without scheme, www or trailing slash: how blogs and blog_urls are compared. */
const identity = (home: string) =>
  home
    .replace(/^https?:\/\/(www\.)?/i, '')
    .replace(/\/$/, '')
    .toLowerCase();
const bare = (column: string) => `TRIM(TRAILING '/' FROM REGEXP_REPLACE(LOWER(COALESCE(${column},'')),'^https?://(www[.])?',''))`;
/** Every spelling of the same home a candidate row may hold, so the url index answers. */
function spellings(home: string) {
  const rest = identity(home);
  return ['https://', 'http://'].flatMap((scheme) => ['', 'www.'].flatMap((www) => [`${scheme}${www}${rest}`, `${scheme}${www}${rest}/`]));
}

export async function suggestionState(pool: Pool, input: unknown): Promise<SuggestionState> {
  const parsed = suggestionHome(input);
  if ('reason' in parsed) return { state: 'invalid', reason: parsed.reason };
  const { home } = parsed;
  const key = identity(home);
  const sub = `${key.replace(/[=%_]/g, '=$&')}/%`;
  const [blogs] = await pool.query<RowDataPacket[]>(
    `SELECT b.slug,b.name,b.status FROM blogs b
     WHERE ${bare('b.url')}=? OR ${bare('b.url')} LIKE ? ESCAPE '='
       OR EXISTS(SELECT 1 FROM blog_urls u WHERE u.blog_id=b.id
         AND (${bare('u.url')}=? OR ${bare('u.url')} LIKE ? ESCAPE '='))
     ORDER BY b.status='verified' DESC,b.id LIMIT 1`,
    [key, sub, key, sub],
  );
  const blog = blogs[0];
  if (blog?.status === 'verified') return { state: 'listed', home, slug: String(blog.slug), name: String(blog.name) };
  const [candidates] = await pool.query<RowDataPacket[]>(
    `SELECT status,JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.automaticReview.checkedAt')) checkedAt,
       JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.automaticReview.reason')) reason
     FROM discovery_candidates WHERE url IN (?) ORDER BY status='candidate' DESC,id DESC`,
    [spellings(home)],
  );
  // A blog row that is not public (a moved alias, a hidden or retired blog) is not offered again.
  if (blog) return { state: 'unlisted', home };
  const open = candidates.find((c) => c.status === 'candidate' || c.status === 'approved');
  if (open)
    return {
      state: 'queued',
      home,
      checkedAt: open.status === 'candidate' ? (open.checkedAt ?? null) : null,
      reason: open.status === 'candidate' ? (open.reason ?? null) : null,
    };
  if (candidates.length) return { state: 'rejected', home };
  return { state: 'new', home };
}

// The public 待查清單 (/queue/): every candidate still waiting, checked or decided, newest added first
// unless the reader sorts by another column.
// Owner-excluded hosts and readers' private OPML imports are never listed.
export const QUEUE_STATES = ['waiting', 'failed', 'listed', 'rejected'] as const;
export type QueueState = (typeof QUEUE_STATES)[number];
export const QUEUE_SOURCES = ['reader-suggestion', 'blogblog-club', 'indieweb-wiki', 'article-link', 'blogroll', 'seed-url-resolution'];
export const QUEUE_SORTS = ['added', 'checked', 'site', 'state', 'source'] as const;
export type QueueSort = (typeof QUEUE_SORTS)[number];
/** Dates start newest first; text and state columns start from the top of their order. */
export const QUEUE_ASCENDING_FIRST: readonly QueueSort[] = ['site', 'state', 'source'];
const QUEUE_PAGE = 50;
const review = (field: string) => `JSON_UNQUOTE(JSON_EXTRACT(d.source_evidence,'$.automaticReview.${field}'))`;
const host = (column: string) => `LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(${column},'/',3),'/',-1))`;
const queueState = `CASE WHEN d.status='approved' THEN 'listed' WHEN d.status='rejected' THEN 'rejected'
  WHEN ${review('reason')} IS NULL OR ${review('reason')} LIKE '%budget_exhausted' THEN 'waiting' ELSE 'failed' END`;
const checkedAt = `STR_TO_DATE(LEFT(${review('checkedAt')},19),'%Y-%m-%dT%H:%i:%s')`;

export function queueFilters(query: Record<string, unknown> = {}) {
  const text = (value: unknown) => (typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '');
  const q = text(query.q)
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/\/$/, '')
    .slice(0, 100);
  const state = QUEUE_STATES.find((s) => s === query.state) ?? '';
  const source = QUEUE_SOURCES.find((s) => s === query.source) ?? '';
  const page = typeof query.page === 'string' && /^\d{1,6}$/.test(query.page) ? Math.max(1, Number(query.page)) : 1;
  const sort: QueueSort = QUEUE_SORTS.find((s) => s === query.sort) ?? 'added';
  const dir = query.dir === 'asc' || query.dir === 'desc' ? query.dir : QUEUE_ASCENDING_FIRST.includes(sort) ? 'asc' : 'desc';
  return { q, state, source, page, sort, dir };
}

export async function loadBlogQueue(pool: Pool, query: Record<string, unknown> = {}) {
  const filters = queueFilters(query);
  // A handful of hosts, read once: a correlated NOT EXISTS would rescan the table for every row.
  const [excluded] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT ${host('url')} host FROM discovery_candidates WHERE source_type='owner-exclusion'`,
  );
  const where = [`d.source_type IN (?)`, `${host('d.url')} NOT IN (?)`];
  const parameters: unknown[] = [QUEUE_SOURCES, excluded.length ? excluded.map((row) => String(row.host)) : ['']];
  if (filters.q) {
    where.push(`d.url LIKE ? ESCAPE '='`);
    parameters.push(`%${filters.q.replace(/[=%_]/g, '=$&')}%`);
  }
  const base = `FROM discovery_candidates d WHERE ${where.join(' AND ')}`;
  // Facets count the search, not the other chip: each row of chips shows what choosing it would list.
  const [facets] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=3 FOR SELECT ${queueState} state,d.source_type source,COUNT(*) n ${base} GROUP BY state,source`,
    parameters,
  );
  const count = (match: (row: RowDataPacket) => boolean) => facets.filter(match).reduce((sum, row) => sum + Number(row.n), 0);
  const states = Object.fromEntries(
    QUEUE_STATES.map((s) => [s, count((r) => r.state === s && (!filters.source || r.source === filters.source))]),
  );
  const sources = Object.fromEntries(
    QUEUE_SOURCES.map((s) => [s, count((r) => r.source === s && (!filters.state || r.state === filters.state))]),
  );
  const total = count((r) => (!filters.state || r.state === filters.state) && (!filters.source || r.source === filters.source));
  const pages = Math.max(1, Math.ceil(total / QUEUE_PAGE));
  const page = Math.min(filters.page, pages);
  const direction = filters.dir === 'asc' ? 'ASC' : 'DESC';
  const sortKey: Record<QueueSort, string> = {
    added: 'd.discovered_at',
    // Never checked sorts after every checked row, whichever way.
    checked: `${checkedAt} IS NULL,${checkedAt}`,
    site: `REGEXP_REPLACE(LOWER(d.url),'^https?://(www[.])?','')`,
    state: `FIELD(${queueState},${QUEUE_STATES.map((s) => `'${s}'`).join(',')})`,
    source: `FIELD(d.source_type,${QUEUE_SOURCES.map((s) => `'${s}'`).join(',')})`,
  };
  const narrowed = [...(filters.state ? [`${queueState}=?`] : []), ...(filters.source ? ['d.source_type=?'] : [])];
  const [rows] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=3 FOR SELECT d.id,d.url,d.name,d.source_type source,d.discovered_at addedAt,${checkedAt} checkedAt,
       ${review('reason')} reason,${review('slug')} slug,${queueState} state
     ${base}${narrowed.map((condition) => ` AND ${condition}`).join('')}
     ORDER BY ${sortKey[filters.sort]} ${direction},d.id ${direction} LIMIT ? OFFSET ?`,
    [
      ...parameters,
      ...(filters.state ? [filters.state] : []),
      ...(filters.source ? [filters.source] : []),
      QUEUE_PAGE,
      (page - 1) * QUEUE_PAGE,
    ],
  );
  return {
    filters: { ...filters, page },
    pagination: { page, pages, total },
    states,
    sources,
    items: rows.map((row) => ({
      url: String(row.url),
      name: row.name ? String(row.name) : null,
      source: String(row.source),
      state: row.state as QueueState,
      addedAt: row.addedAt instanceof Date ? row.addedAt.toISOString() : null,
      checkedAt: row.checkedAt instanceof Date ? row.checkedAt.toISOString() : null,
      // Why the last check did not admit it; an admitted or decided row has no pending reason.
      reason: row.state === 'failed' ? String(row.reason) : null,
      slug: row.state === 'listed' && row.slug ? String(row.slug) : null,
    })),
  };
}

type Options = {
  pool: Pool;
  publicOrigin: string;
  requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null>;
  now?: () => Date;
};

export function registerBlogSuggestionRoutes(app: FastifyInstance, options: Options) {
  const { pool } = options;
  const now = options.now ?? (() => new Date());
  app.get('/api/blog-suggestions', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      return await suggestionState(pool, (request.query as { url?: unknown })?.url);
    } catch {
      return reply.code(503).send({ error: 'suggestions unavailable' });
    }
  });
  app.get('/api/blog-queue', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    try {
      return await loadBlogQueue(pool, (request.query as Record<string, unknown>) ?? {});
    } catch {
      return reply.code(503).send({ error: 'queue unavailable' });
    }
  });
  app.post('/api/me/blog-suggestions', { bodyLimit: 2048 }, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    if (request.headers.origin !== options.publicOrigin) return reply.code(403).send({ error: 'same-origin requests only' });
    const user = await options.requireUser(request, reply);
    if (!user) return reply;
    const state = await suggestionState(pool, (request.body as { url?: unknown } | null)?.url);
    if (state.state !== 'new') return state;
    const at = now();
    const [[used]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) n FROM discovery_candidates WHERE source_type=? AND discovered_at>=?
       AND JSON_EXTRACT(source_evidence,'$.userId')=?`,
      [READER_SUGGESTION, new Date(at.getTime() - 86400000), user.id],
    );
    if (Number(used?.n) >= DAILY_SUGGESTIONS) return reply.code(429).send({ error: 'daily suggestion limit reached' });
    // No audit row with an actor: the automatic review skips candidates a person has already decided.
    await pool.execute(
      'INSERT IGNORE INTO discovery_candidates (url,name,source_type,source_url,source_evidence,discovered_at) VALUES (?,?,?,?,?,?)',
      [state.home, null, READER_SUGGESTION, '/api/me/blog-suggestions', JSON.stringify({ userId: user.id }), at],
    );
    return { state: 'queued', home: state.home, checkedAt: null, reason: null } satisfies SuggestionState;
  });
}
