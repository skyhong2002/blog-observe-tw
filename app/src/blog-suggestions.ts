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
