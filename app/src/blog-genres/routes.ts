import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { writeAudit } from '../admin/identity.ts';
import { readCookie, SESSION_COOKIE, type SessionUser } from '../auth/google-login.ts';
import { genreKey, genreLabel, isBlogGenre, isGenreKey } from '../blog-genre-vocabulary.ts';
import { genreItems } from './resolve.ts';
import { rememberDomainTags } from './store.ts';
import { TagServiceError, type TagWrite, tagClient, tagDomain } from './traffic.ts';

type Options = {
  pool: Pool;
  requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null>;
  publicOrigin: string;
  sessionSecret: string;
};
export const genreCsrfToken = (session: string, secret: string) =>
  createHmac('sha256', secret).update(`blog-genres-csrf-v1\0${session}`).digest('base64url');

/** What a reader typed, as traffic should store it: a starting genre by its name (food → 美食), else the typed text. */
const typedTag = (text: string, key: string) =>
  isBlogGenre(key)
    ? genreLabel(key)
    : text
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^#+\s*/, '');

/**
 * The same routes, CSRF, Origin and login rules as before, proxied to traffic.observe.tw (traffic.ts) with the
 * reader's Google email as the voter. traffic decides who is an admin and limits each voter to 30 writes a minute;
 * blog keeps its own per-account limit in front so a reader cannot make it hammer traffic.
 */
export function registerBlogGenreRoutes(app: FastifyInstance, options: Options) {
  const { pool } = options;
  const limits = new Map<number, { start: number; count: number }>();
  const privateHeaders = (reply: FastifyReply) => reply.header('cache-control', 'private, no-store');
  const blogDomain = async (slug: string) => {
    const [[blog]] = await pool.query<RowDataPacket[]>(
      "SET STATEMENT max_statement_time=1 FOR SELECT id,canonical_host host FROM blogs WHERE slug=? AND status='verified' LIMIT 1",
      [slug],
    );
    return blog ? { id: Number(blog.id), domain: tagDomain(blog.host) } : null;
  };
  const unavailable = (reply: FastifyReply) => reply.code(503).send({ error: 'tags_unavailable' });
  app.get('/api/me/blog-genres/:slug', async (request, reply) => {
    privateHeaders(reply);
    const user = await options.requireUser(request, reply);
    if (!user) return reply;
    const session = readCookie(request, SESSION_COOKIE);
    if (!session || session.length > 128 || options.sessionSecret.length < 32) return reply.code(401).send({ error: 'session required' });
    const slug = (request.params as { slug: string }).slug;
    const blog = /^[\w.-]{1,255}$/.test(slug) ? await blogDomain(slug) : null;
    let read: Awaited<ReturnType<ReturnType<typeof tagClient>['read']>>;
    try {
      read = await tagClient().read(blog?.domain ? [blog.domain] : [], user.email);
    } catch (error) {
      if (!(error instanceof TagServiceError)) throw error;
      request.log.warn({ operation: 'blog.genres.me', reason: error.message }, 'tag service unavailable');
      return unavailable(reply);
    }
    const votes: Record<string, number> = {};
    for (const [tag, vote] of Object.entries((blog?.domain && read.voter?.votes[blog.domain]) || {})) {
      const key = genreKey(tag);
      if (key && (vote === 1 || vote === -1) && !(key in votes)) votes[key] = vote;
    }
    return { votes, admin: read.voter?.admin === true, csrfToken: genreCsrfToken(session, options.sessionSecret) };
  });
  for (const kind of ['vote', 'propose', 'admin'] as const) {
    app.route({
      method: kind === 'propose' ? 'POST' : 'PUT',
      url: kind === 'propose' ? '/api/blogs/:slug/genres/propose' : `/api/blogs/:slug/genres/:genre/${kind}`,
      bodyLimit: 512,
      handler: async (request, reply) => {
        privateHeaders(reply);
        const user = await options.requireUser(request, reply);
        if (!user) return reply;
        const session = readCookie(request, SESSION_COOKIE);
        const supplied = request.headers['x-blog-csrf'];
        if (
          options.sessionSecret.length < 32 ||
          request.headers.origin !== options.publicOrigin ||
          !session ||
          session.length > 128 ||
          typeof supplied !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(supplied) ||
          !timingSafeEqual(Buffer.from(genreCsrfToken(session, options.sessionSecret)), Buffer.from(supplied))
        )
          return reply.code(403).send({ error: 'invalid_csrf' });
        const now = Date.now();
        // Expire entries on writes; never evict an active user's allowance.
        for (const [id, limit] of limits) if (now - limit.start >= 60_000) limits.delete(id);
        const limit = limits.get(user.id) ?? { start: now, count: 0 };
        if (limit.count >= 30 || (!limits.has(user.id) && limits.size >= 10_000)) {
          reply.header('retry-after', Math.max(1, Math.ceil((60_000 - (now - limit.start)) / 1000)));
          return reply.code(429).send({ error: 'genre_rate_limit' });
        }
        limit.count++;
        limits.set(user.id, limit);
        const params = request.params as { slug: string; genre?: string };
        const body = request.body as Record<string, unknown> | null;
        const key = kind === 'propose' ? 'genre' : kind === 'vote' ? 'vote' : 'action';
        // A proposal is whatever the reader typed; votes and admin actions name an existing key.
        const genre = kind === 'propose' ? genreKey(body?.genre) : isGenreKey(params.genre) ? params.genre : null;
        if (
          !body ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).some((k) => k !== key) ||
          typeof genre !== 'string' ||
          !/^[\w.-]{1,255}$/.test(params.slug) ||
          (kind === 'vote' && ![1, -1, 0].includes(body.vote as number)) ||
          (kind === 'admin' && !['set', 'hide', 'release'].includes(body.action as string))
        )
          return reply.code(400).send({ error: 'invalid_genre_action' });
        const blog = await blogDomain(params.slug);
        if (!blog) return reply.code(404).send({ error: 'blog not found' });
        // A blog newer than traffic's list of domains cannot carry tags yet.
        if (!blog.domain) return reply.code(404).send({ error: 'unknown_domain' });
        const voter = user.email;
        let result: Awaited<ReturnType<ReturnType<typeof tagClient>['write']>>;
        try {
          let tag: string;
          if (kind === 'propose') tag = typedTag(String(body.genre), genre);
          else {
            // The URL names the key (food); traffic needs the site's spelling of it (美食, 3C, Coffee).
            const tags = (await tagClient().read([blog.domain])).domains[blog.domain];
            if (!tags) return reply.code(404).send({ error: 'unknown_domain' });
            const found = tags.find((t) => genreKey(t.tag) === genre)?.tag;
            if (!found && kind === 'vote') return reply.code(404).send({ error: 'genre not proposed' });
            tag = found ?? genreLabel(genre);
          }
          const change: TagWrite =
            kind === 'vote'
              ? { kind, voter, domain: blog.domain, tag, vote: body.vote as 1 | -1 | 0 }
              : kind === 'propose'
                ? { kind, voter, domain: blog.domain, tag }
                : { kind, voter, domain: blog.domain, tag, action: body.action as 'set' | 'hide' | 'release' };
          result = await tagClient().write(change);
        } catch (error) {
          if (!(error instanceof TagServiceError)) throw error;
          request.log.warn({ operation: `blog.genres.${kind}`, reason: error.message }, 'tag service unavailable');
          return unavailable(reply);
        }
        if (!('ok' in result)) {
          if (result.status === 429) {
            reply.header('retry-after', 60);
            return reply.code(429).send({ error: 'genre_rate_limit' });
          }
          if (result.status === 403) return reply.code(403).send({ error: result.error });
          if (result.status === 404) return reply.code(404).send({ error: result.error });
          return reply.code(400).send({ error: 'invalid_genre_action', message: result.message });
        }
        rememberDomainTags(result.domain, result.tags);
        if (kind === 'admin') {
          // traffic keeps the tag log; the audit row keeps blog's admin activity counts (admin/accounts.ts).
          const c = await pool.getConnection();
          try {
            await writeAudit(c, user.id, `genre.${body.action}`, 'blog', String(blog.id), null, {
              genre,
              tag: result.tag,
              domain: result.domain,
              action: body.action,
            });
          } catch (error) {
            request.log.warn({ operation: 'blog.genres.audit', err: error }, 'genre audit not written');
          } finally {
            c.release();
          }
        }
        return { ok: true, genreState: { status: 'ready', items: genreItems(result.tags) } };
      },
    });
  }
}
