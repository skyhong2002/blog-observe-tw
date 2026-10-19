import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { isAdmin, requireAdminTransaction, writeAudit } from '../admin/identity.ts';
import { readCookie, SESSION_COOKIE, type SessionUser } from '../auth/google-login.ts';
import { genreKey, isGenreKey } from '../blog-genre-vocabulary.ts';
import { readBlogGenres } from './store.ts';

type Options = {
  pool: Pool;
  requireUser(request: FastifyRequest, reply: FastifyReply): Promise<SessionUser | null>;
  adminEmails: Set<string>;
  publicOrigin: string;
  sessionSecret: string;
};
export const genreCsrfToken = (session: string, secret: string) =>
  createHmac('sha256', secret).update(`blog-genres-csrf-v1\0${session}`).digest('base64url');
const fail = (statusCode: number, message: string) => Object.assign(Error(message), { statusCode });

export function registerBlogGenreRoutes(app: FastifyInstance, options: Options) {
  const { pool } = options;
  const limits = new Map<number, { start: number; count: number }>();
  const privateHeaders = (reply: FastifyReply) => reply.header('cache-control', 'private, no-store');
  app.get('/api/me/blog-genres/:slug', async (request, reply) => {
    privateHeaders(reply);
    const user = await options.requireUser(request, reply);
    if (!user) return reply;
    const session = readCookie(request, SESSION_COOKIE);
    if (!session || session.length > 128 || options.sessionSecret.length < 32) return reply.code(401).send({ error: 'session required' });
    const slug = (request.params as { slug: string }).slug;
    const [votes] = await pool.query<RowDataPacket[]>(
      `SET STATEMENT max_statement_time=1 FOR SELECT v.genre,v.vote FROM blog_genre_votes v JOIN blogs b ON b.id=v.blog_id
       WHERE b.slug=? AND b.status='verified' AND v.user_id=? LIMIT 200`,
      [slug, user.id],
    );
    return {
      votes: Object.fromEntries(votes.filter((v) => isGenreKey(v.genre)).map((v) => [v.genre, Number(v.vote)])),
      admin: await isAdmin(pool, user, options.adminEmails),
      csrfToken: genreCsrfToken(session, options.sessionSecret),
    };
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
        // A proposal is whatever the reader typed, folded to its key; votes and admin actions name an existing key.
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
        const c = await pool.getConnection();
        try {
          await c.beginTransaction();
          if (kind === 'admin') await requireAdminTransaction(c, user, options.adminEmails);
          const [[blog]] = await c.query<RowDataPacket[]>("SELECT id FROM blogs WHERE slug=? AND status='verified' LIMIT 1 FOR UPDATE", [
            params.slug,
          ]);
          if (!blog) throw fail(404, 'blog not found');
          if (kind === 'admin') {
            const [before] = await c.query<RowDataPacket[]>(
              'SELECT source,status FROM blog_genre_assignments WHERE blog_id=? AND genre=?',
              [blog.id, genre],
            );
            // Keep a candidate even for admin-introduced genres so release immediately restores voting.
            await c.execute(
              `INSERT IGNORE INTO blog_genre_assignments (blog_id,genre,source,status,actor_user_id,created_at,updated_at)
               VALUES (?,?,'community','candidate',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
              [blog.id, genre, user.id],
            );
            if (body.action === 'release') {
              await c.execute("DELETE FROM blog_genre_assignments WHERE blog_id=? AND genre=? AND source='admin'", [blog.id, genre]);
            } else {
              await c.execute(
                `INSERT INTO blog_genre_assignments (blog_id,genre,source,status,actor_user_id,created_at,updated_at)
                 VALUES (?,?,'admin',?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE status=VALUES(status),actor_user_id=VALUES(actor_user_id),updated_at=UTC_TIMESTAMP()`,
                [blog.id, genre, body.action === 'set' ? 'active' : 'hidden', user.id],
              );
            }
            await writeAudit(c, user.id, `genre.${body.action}`, 'blog', String(blog.id), before, { genre, action: body.action });
          } else {
            if (kind === 'propose') {
              await c.execute(
                `INSERT IGNORE INTO blog_genre_assignments (blog_id,genre,source,status,actor_user_id,created_at,updated_at)
                 VALUES (?,?,'community','candidate',?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
                [blog.id, genre, user.id],
              );
            } else {
              const [[candidate]] = await c.query<RowDataPacket[]>(
                'SELECT genre FROM blog_genre_assignments WHERE blog_id=? AND genre=? LIMIT 1',
                [blog.id, genre],
              );
              if (!candidate) throw fail(404, 'genre not proposed');
            }
            if (body.vote === 0) {
              await c.execute('DELETE FROM blog_genre_votes WHERE blog_id=? AND genre=? AND user_id=?', [blog.id, genre, user.id]);
            } else {
              await c.execute(
                `INSERT INTO blog_genre_votes (blog_id,genre,user_id,vote,at) VALUES (?,?,?,?,UTC_TIMESTAMP())
                 ON DUPLICATE KEY UPDATE vote=VALUES(vote),at=UTC_TIMESTAMP()`,
                [blog.id, genre, user.id, kind === 'propose' ? 1 : body.vote],
              );
            }
          }
          await c.commit();
        } catch (error) {
          await c.rollback();
          throw error;
        } finally {
          c.release();
        }
        const resolved = await readBlogGenres(pool, [params.slug], () =>
          request.log.warn({ operation: 'blog.genres' }, 'blog genres unavailable'),
        );
        return { ok: true, genreState: resolved.blogs.get(params.slug) ?? { status: 'unavailable', items: [] } };
      },
    });
  }
}
