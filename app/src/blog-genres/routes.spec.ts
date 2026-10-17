import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../auth/google-login.ts';
import { genreCsrfToken, registerBlogGenreRoutes } from './routes.ts';

const secret = 'x'.repeat(32);
const headers = { origin: 'https://blog.test', cookie: `${SESSION_COOKIE}=session`, 'x-blog-csrf': genreCsrfToken('session', secret) };
async function fixture({ signedIn = true, admin = false } = {}) {
  const writes: { sql: string; args: unknown[] }[] = [];
  let committed = 0,
    rolledBack = 0;
  const query = async (sql: string) => {
    if (sql.includes('admin_google_identities'))
      return [[{ role: admin ? 'admin' : 'reader', google_sub: 'sub', pinned_sub: 'sub', pinned_email: 'a@test' }]];
    if (sql.includes('SELECT id FROM blogs')) return [[{ id: 1 }]];
    if (sql.includes('SELECT genre FROM blog_genre_assignments')) return [[{ genre: 'food' }]];
    return [[]];
  };
  const c = {
    query,
    execute: async (sql: string, args: unknown[]) => {
      writes.push({ sql, args });
      return [{ affectedRows: 1 }];
    },
    beginTransaction: async () => {},
    commit: async () => {
      committed++;
    },
    rollback: async () => {
      rolledBack++;
    },
    release() {},
  };
  const app = Fastify();
  registerBlogGenreRoutes(app, {
    pool: { query, getConnection: async () => c } as never,
    publicOrigin: 'https://blog.test',
    sessionSecret: secret,
    adminEmails: new Set(['a@test']),
    requireUser: async (_request, reply) => {
      if (!signedIn) {
        reply.code(401).send({ error: 'login required' });
        return null;
      }
      return { id: Number(_request.headers['x-test-user'] ?? 7), sub: 'sub', email: 'a@test', name: 'reader', picture: null };
    },
  });
  await app.ready();
  return { app, writes, committed: () => committed, rolledBack: () => rolledBack };
}
const request = (kind: string, payload: Record<string, unknown>, extra = {}) => ({
  method: kind === 'propose' ? ('POST' as const) : ('PUT' as const),
  url: kind === 'propose' ? '/api/blogs/a/genres/propose' : `/api/blogs/a/genres/food/${kind}`,
  headers,
  payload,
  ...extra,
});
describe('blog genre write routes', () => {
  it('requires login for private reads and every write, and marks errors private', async () => {
    const f = await fixture({ signedIn: false });
    try {
      for (const kind of ['vote', 'propose', 'admin']) {
        const response = await f.app.inject(request(kind, {}));
        expect(response.statusCode).toBe(401);
        expect(response.headers['cache-control']).toBe('private, no-store');
      }
      expect((await f.app.inject('/api/me/blog-genres/a')).statusCode).toBe(401);
      expect(f.writes).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });
  it('rejects cross-origin, missing or mismatched CSRF tokens before writing', async () => {
    const f = await fixture();
    try {
      for (const patch of [{ origin: 'https://evil.test' }, { 'x-blog-csrf': '' }, { cookie: `${SESSION_COOKIE}=other` }]) {
        expect((await f.app.inject(request('vote', { vote: 1 }, { headers: { ...headers, ...patch } }))).statusCode).toBe(403);
      }
      expect(f.writes).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });
  it('rejects invalid genres, votes, actions and extra fields', async () => {
    const f = await fixture();
    try {
      for (const req of [
        request('propose', { genre: 'unknown' }),
        request('vote', { vote: 2 }),
        request('admin', { action: 'erase' }),
        request('vote', { vote: 1, userId: 99 }),
        request('vote', { vote: -1 }, { url: '/api/blogs/a/genres/unknown/vote' }),
      ]) {
        expect((await f.app.inject(req)).statusCode).toBe(400);
      }
      expect(f.writes).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });
  it('proposes and agrees in one transaction; vote changes upsert and withdrawal deletes', async () => {
    const f = await fixture();
    try {
      expect((await f.app.inject(request('propose', { genre: 'food' }))).statusCode).toBe(200);
      expect(f.writes[0].sql).toContain('INSERT IGNORE INTO blog_genre_assignments');
      expect(f.writes[1].args).toEqual([1, 'food', 7, 1]);
      expect((await f.app.inject(request('vote', { vote: -1 }))).statusCode).toBe(200);
      expect(f.writes[2].args).toEqual([1, 'food', 7, -1]);
      expect((await f.app.inject(request('vote', { vote: 0 }))).statusCode).toBe(200);
      expect(f.writes[3].sql).toContain('DELETE FROM blog_genre_votes');
      expect(f.committed()).toBe(3);
    } finally {
      await f.app.close();
    }
  });
  it('rechecks pinned admin identity in the transaction, and audits set/hide/release without deleting votes', async () => {
    const reader = await fixture();
    const admin = await fixture({ admin: true });
    try {
      expect((await reader.app.inject(request('admin', { action: 'set' }))).statusCode).toBe(403);
      expect(reader.writes).toHaveLength(0);
      expect(reader.rolledBack()).toBe(1);
      for (const action of ['set', 'hide', 'release']) expect((await admin.app.inject(request('admin', { action }))).statusCode).toBe(200);
      expect(admin.writes.filter((w) => w.sql.includes('INSERT INTO admin_audits'))).toHaveLength(3);
      expect(admin.writes.filter((w) => w.sql.includes("'community','candidate'"))).toHaveLength(3);
      expect(admin.writes.some((w) => w.sql.includes('DELETE FROM blog_genre_votes'))).toBe(false);
    } finally {
      await reader.app.close();
      await admin.app.close();
    }
  });
  it('limits a signed-in user to 30 writes per minute across endpoints', async () => {
    const f = await fixture();
    try {
      for (let i = 0; i < 30; i++) expect((await f.app.inject(request('vote', { vote: 1 }))).statusCode).toBe(200);
      const response = await f.app.inject(request('propose', { genre: 'food' }));
      expect(response.statusCode).toBe(429);
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(f.committed()).toBe(30);
      expect((await f.app.inject(request('vote', { vote: 1 }, { headers: { ...headers, 'x-test-user': '8' } }))).statusCode).toBe(200);
    } finally {
      await f.app.close();
    }
  });
  it('returns session-bound CSRF and private user votes', async () => {
    const f = await fixture();
    try {
      const response = await f.app.inject({ url: '/api/me/blog-genres/a', headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ votes: {}, admin: false, csrfToken: headers['x-blog-csrf'] });
      expect(response.headers['cache-control']).toBe('private, no-store');
    } finally {
      await f.app.close();
    }
  });
});
