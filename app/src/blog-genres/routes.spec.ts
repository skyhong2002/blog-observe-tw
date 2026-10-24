import Fastify, { type InjectOptions } from 'fastify';
import { describe, expect, it } from 'vitest';
import { fakeTagClient, tag } from '../../test/tag-client.ts';
import { SESSION_COOKIE } from '../auth/google-login.ts';
import { genreCsrfToken, registerBlogGenreRoutes } from './routes.ts';
import { setTagClient, type TagClient, TagServiceError } from './traffic.ts';

const secret = 'x'.repeat(32);
const headers = { origin: 'https://blog.test', cookie: `${SESSION_COOKIE}=session`, 'x-blog-csrf': genreCsrfToken('session', secret) };
async function fixture({
  signedIn = true,
  traffic = fakeTagClient({ 'a.blog.tw': [tag('美食'), tag('Coffee', { source: 'community' })] }),
} = {}) {
  const audits: unknown[][] = [];
  const query = async (sql: string) => {
    if (sql.includes('FROM blogs')) return [[{ id: 1, host: 'www.a.blog.tw' }]];
    return [[]];
  };
  const c = {
    query,
    execute: async (sql: string, args: unknown[]) => {
      if (sql.includes('INSERT INTO admin_audits')) audits.push(args);
      return [{ affectedRows: 1 }];
    },
    release() {},
  };
  const app = Fastify();
  registerBlogGenreRoutes(app, {
    pool: { query, getConnection: async () => c } as never,
    publicOrigin: 'https://blog.test',
    sessionSecret: secret,
    requireUser: async (_request, reply) => {
      if (!signedIn) {
        reply.code(401).send({ error: 'login required' });
        return null;
      }
      const id = Number(_request.headers['x-test-user'] ?? 7);
      return { id, sub: 'sub', email: `reader${id}@test`, name: 'reader', picture: null };
    },
  });
  await app.ready();
  // Each fixture's requests go to its own traffic stand-in, also when a test holds two.
  const inject = (options: InjectOptions | string) => {
    setTagClient(traffic.client);
    return app.inject(options);
  };
  return { app: { inject, close: () => app.close() }, writes: traffic.writes, reads: traffic.reads, audits };
}
const request = (kind: string, payload: Record<string, unknown>, extra = {}) => ({
  method: kind === 'propose' ? ('POST' as const) : ('PUT' as const),
  url: kind === 'propose' ? '/api/blogs/a/genres/propose' : `/api/blogs/a/genres/food/${kind}`,
  headers,
  payload,
  ...extra,
});
describe('blog tag routes proxied to traffic.observe.tw', () => {
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
      expect(f.reads).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });
  it('rejects cross-origin, missing or mismatched CSRF tokens before calling traffic', async () => {
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
  it('rejects invalid tags, votes, actions and extra fields', async () => {
    const f = await fixture();
    try {
      for (const req of [
        request('propose', { genre: '旅遊, 生活' }),
        request('propose', { genre: '###' }),
        request('propose', { genre: '字'.repeat(33) }),
        request('vote', { vote: 2 }),
        request('admin', { action: 'erase' }),
        request('vote', { vote: 1, userId: 99 }),
        request('vote', { vote: -1 }, { url: '/api/blogs/a/genres/%23%23/vote' }),
        request('vote', { vote: -1 }, { url: '/api/blogs/a/genres/Coffee/vote' }),
      ]) {
        expect((await f.app.inject(req)).statusCode).toBe(400);
      }
      expect(f.writes).toHaveLength(0);
    } finally {
      await f.app.close();
    }
  });
  it('votes and proposes as the reader, by the tag names traffic uses, and answers with the new tags', async () => {
    const f = await fixture();
    try {
      const voted = await f.app.inject(request('vote', { vote: -1 }));
      expect(voted.statusCode).toBe(200);
      expect(voted.json().genreState.items[0]).toMatchObject({ genre: 'food', label: '美食', source: 'ai' });
      expect((await f.app.inject(request('vote', { vote: 0 }, { url: '/api/blogs/a/genres/coffee/vote' }))).statusCode).toBe(200);
      // The starting names go by name (food → 美食); anything else as typed, NFKC-folded without the leading #.
      expect((await f.app.inject(request('propose', { genre: 'food' }))).statusCode).toBe(200);
      expect((await f.app.inject(request('propose', { genre: '  ＃Single   Origin  ' }))).statusCode).toBe(200);
      expect(f.writes).toEqual([
        { kind: 'vote', voter: 'reader7@test', domain: 'a.blog.tw', tag: '美食', vote: -1 },
        { kind: 'vote', voter: 'reader7@test', domain: 'a.blog.tw', tag: 'Coffee', vote: 0 },
        { kind: 'propose', voter: 'reader7@test', domain: 'a.blog.tw', tag: '美食' },
        { kind: 'propose', voter: 'reader7@test', domain: 'a.blog.tw', tag: 'Single Origin' },
      ]);
      // A vote on a tag the blog does not have never reaches traffic.
      expect((await f.app.inject(request('vote', { vote: 1 }, { url: '/api/blogs/a/genres/travel/vote' }))).statusCode).toBe(404);
      expect(f.writes).toHaveLength(4);
    } finally {
      await f.app.close();
    }
  });
  it('lets traffic decide who is an admin, and audits the overrides it accepted', async () => {
    const refused = await fixture({
      traffic: fakeTagClient({ 'a.blog.tw': [tag('美食')] }, { answer: () => ({ status: 403, error: 'not_admin' }) }),
    });
    const admin = await fixture();
    try {
      const response = await refused.app.inject(request('admin', { action: 'set' }));
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'not_admin' });
      expect(refused.audits).toHaveLength(0);
      for (const action of ['set', 'hide', 'release']) expect((await admin.app.inject(request('admin', { action }))).statusCode).toBe(200);
      // An override may name a tag the blog does not have yet.
      expect((await admin.app.inject(request('admin', { action: 'set' }, { url: '/api/blogs/a/genres/travel/admin' }))).statusCode).toBe(
        200,
      );
      expect(admin.writes.map((w) => [w.tag, 'action' in w && w.action])).toEqual([
        ['美食', 'set'],
        ['美食', 'hide'],
        ['美食', 'release'],
        ['旅遊', 'set'],
      ]);
      expect(admin.audits.map((a) => a[1])).toEqual(['genre.set', 'genre.hide', 'genre.release', 'genre.set']);
    } finally {
      await refused.app.close();
      await admin.app.close();
    }
  });
  it("keeps traffic's spelling for an admin override, then the typed one, never the lowered key", async () => {
    const f = await fixture({ traffic: fakeTagClient({ 'a.blog.tw': [tag('iPhone')] }) });
    try {
      const admin = (genre: string, payload: Record<string, unknown>) =>
        f.app.inject(request('admin', payload, { url: `/api/blogs/a/genres/${encodeURIComponent(genre)}/admin` }));
      expect((await admin('iphone', { action: 'hide' })).statusCode).toBe(200);
      expect((await admin('single origin', { action: 'set', tag: '＃Single  Origin' })).statusCode).toBe(200);
      // The typed spelling must be the same tag as the URL.
      expect((await admin('coffee', { action: 'set', tag: 'Tea' })).statusCode).toBe(400);
      expect(f.writes.map((w) => w.tag)).toEqual(['iPhone', 'Single Origin']);
    } finally {
      await f.app.close();
    }
  });
  it('names reserved political tags and blogs traffic does not know yet', async () => {
    const reserved = await fixture({
      traffic: fakeTagClient({ 'a.blog.tw': [] }, { answer: () => ({ status: 400, error: 'reserved_tag', message: '政治傾向不是標籤' }) }),
    });
    const unknown = await fixture({ traffic: fakeTagClient({}, { answer: () => ({ status: 404, error: 'unknown_domain' }) }) });
    try {
      const refused = await reserved.app.inject(request('propose', { genre: '藍營' }));
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toEqual({ error: 'reserved_tag' });
      const pending = await unknown.app.inject(request('propose', { genre: '咖啡' }));
      expect(pending.statusCode).toBe(404);
      expect(pending.json()).toEqual({ error: 'unknown_domain' });
      expect((await unknown.app.inject(request('vote', { vote: 1 }))).json()).toEqual({ error: 'unknown_domain' });
    } finally {
      await reserved.app.close();
      await unknown.app.close();
    }
  });
  it('answers 503 when traffic is down and passes its refusals on', async () => {
    const down: TagClient = {
      read: async () => {
        throw new TagServiceError('down');
      },
      write: async () => {
        throw new TagServiceError('down');
      },
      putAi: async () => ({ ok: true, sites: 0, changed: 0, skipped: [] }),
      voters: async () => ({}),
    };
    const f = await fixture({ traffic: { client: down, reads: [], writes: [] } });
    const limited = await fixture({
      traffic: fakeTagClient({ 'a.blog.tw': [tag('美食')] }, { answer: () => ({ status: 429, error: 'rate_limited' }) }),
    });
    try {
      expect((await f.app.inject(request('vote', { vote: 1 }))).statusCode).toBe(503);
      expect((await f.app.inject(request('propose', { genre: '咖啡' }))).statusCode).toBe(503);
      expect((await f.app.inject({ url: '/api/me/blog-genres/a', headers })).statusCode).toBe(503);
      const response = await limited.app.inject(request('vote', { vote: 1 }));
      expect(response.statusCode).toBe(429);
      expect(response.headers['retry-after']).toBe('60');
    } finally {
      await f.app.close();
      await limited.app.close();
    }
  });
  it('limits a signed-in user to 30 writes per minute across endpoints', async () => {
    const f = await fixture();
    try {
      for (let i = 0; i < 30; i++) expect((await f.app.inject(request('vote', { vote: 1 }))).statusCode).toBe(200);
      const response = await f.app.inject(request('propose', { genre: 'food' }));
      expect(response.statusCode).toBe(429);
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(f.writes).toHaveLength(30);
      expect((await f.app.inject(request('vote', { vote: 1 }, { headers: { ...headers, 'x-test-user': '8' } }))).statusCode).toBe(200);
    } finally {
      await f.app.close();
    }
  });
  it("returns session-bound CSRF, the reader's own votes by key and traffic's admin flag", async () => {
    const f = await fixture({
      traffic: fakeTagClient({ 'a.blog.tw': [tag('美食')] }, { voter: { admin: true, votes: { 'a.blog.tw': { 美食: -1, Coffee: 1 } } } }),
    });
    try {
      const response = await f.app.inject({ url: '/api/me/blog-genres/a', headers });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ votes: { food: -1, coffee: 1 }, admin: true, csrfToken: headers['x-blog-csrf'] });
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(f.reads).toEqual([{ domains: ['a.blog.tw'], voter: 'reader7@test' }]);
    } finally {
      await f.app.close();
    }
  });
});
