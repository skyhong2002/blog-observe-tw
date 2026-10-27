import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digest, normalizeTerm } from '../topics/policy.ts';
import { enrichPageLinks, PAGE_LINK_LIMITS, pageLinksEndpoint, registerPageLinks } from './page-links.ts';

const term = 'a'.repeat(64),
  alias = 'b'.repeat(64);
function fixture(options: { fail?: boolean; wait?: Promise<void> } = {}) {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const pool = {
    query: async (sql: string, args: unknown[] = []) => {
      calls.push({ sql, args });
      await options.wait;
      if (options.fail) throw Error('sensitive DB host/password');
      if (sql.includes('FROM public_route_keys'))
        return [
          [
            { route_key: 'writer', entity_id: '1' },
            { route_key: `tag:${alias}`, entity_id: term },
          ],
        ];
      if (sql.startsWith('SELECT id,slug')) return [[]];
      if (sql.startsWith('SELECT t.id')) return [[]];
      if (sql.startsWith('SELECT a.term_id')) return [[]];
      if (sql.startsWith('SELECT id,label')) return [[{ id: 42, label: '人工智慧' }]];
      if (sql.includes("r.kind='blog'")) return [[{ entity_id: '1', canonical_key: '我的部落格', stable_id: 'writer' }]];
      if (sql.includes("r.kind='topic'"))
        return [
          [
            { entity_id: term, canonical_key: 'ai', stable_id: `tag:${term}` },
            {
              entity_id: digest(normalizeTerm('人工智慧')),
              canonical_key: '人工智慧',
              stable_id: `tag:${digest(normalizeTerm('人工智慧'))}`,
            },
          ],
        ];
      throw Error(`unexpected fixture query ${sql}`);
    },
  } as unknown as Pool;
  return { pool, calls };
}
const canonical = '/blogs/%E6%88%91%E7%9A%84%E9%83%A8%E8%90%BD%E6%A0%BC/';
afterEach(() => vi.useRealTimers());

describe('bounded API canonical links', () => {
  it('adds links without changing stable slugs/icons or cached nested DTOs; ignores author/tag slugs', async () => {
    const { pool } = fixture();
    const payload = {
      blogs: [{ slug: 'writer', name: '作者', iconUrl: '/favicons/writer.png' }],
      posts: [{ id: 98, blogSlug: 'writer', title: '文' }],
      authors: [{ id: 1, slug: 'writer', name: '作者' }],
      tags: [{ slug: 'writer', name: '標籤' }],
    };
    const before = structuredClone(payload);
    const output = (await enrichPageLinks(pool, '/api/overview', payload)) as typeof payload & { blogs: Array<{ canonicalPath?: string }> };
    expect(output).not.toBe(payload);
    expect(output.blogs[0]).toMatchObject({ slug: 'writer', iconUrl: '/favicons/writer.png', canonicalPath: canonical });
    expect(output.posts[0]).toMatchObject({ id: 98, blogCanonicalPath: canonical });
    expect(output.authors).toBe(payload.authors);
    expect(output.tags).toBe(payload.tags);
    expect(payload).toEqual(before);
  });
  it('enriches graph nodes/edges using explicit blog IDs, never author or post IDs', async () => {
    const { pool } = fixture();
    const output = await enrichPageLinks(pool, '/api/v1/relations', {
      nodes: [{ id: 1, slug: 'writer', name: '作者' }],
      edges: [{ sourceBlogId: 1, targetBlogId: 2 }],
      evidence: [{ postId: 1, authorId: 1 }],
      mostMentioned: [{ blogId: 1 }],
    });
    expect(output).toMatchObject({
      nodes: [{ canonicalPath: canonical }],
      edges: [{ sourceBlogCanonicalPath: canonical }],
      evidence: [{ postId: 1, authorId: 1 }],
      mostMentioned: [{ blogCanonicalPath: canonical }],
    });
    expect((output as { edges: object[] }).edges[0]).not.toHaveProperty('targetBlogCanonicalPath');
  });
  it('resolves tag aliases and RSS labels through registered canonical entities', async () => {
    const { pool } = fixture();
    const output = await enrichPageLinks(pool, '/api/topics', {
      items: [
        { id: `tag:${alias}`, label: 'AI' },
        { id: 'rss:42', label: '人工智慧' },
      ],
    });
    expect(output).toMatchObject({
      items: [
        {
          id: `tag:${alias}`,
          canonicalPath: '/topics/ai/',
        },
        { id: 'rss:42', canonicalPath: '/topics/%E4%BA%BA%E5%B7%A5%E6%99%BA%E6%85%A7/' },
      ],
    });
    for (const topic of (output as { items: object[] }).items) expect(topic).not.toHaveProperty('url');
  });
  it('changes only public blog url, preserves sourceUrl and cached/internal/article URLs', async () => {
    const { pool } = fixture();
    const source = 'https://writer.example/';
    const blog = { id: 1, slug: 'writer', name: '作者', url: source, iconUrl: '/favicons/writer.png' };
    const localUrl = 'https://weblog.tw' + canonical;
    const list = await enrichPageLinks(pool, '/api/v1/blogs', { items: [blog] });
    expect(list).toMatchObject({ items: [{ ...blog, url: localUrl, sourceUrl: source, canonicalPath: canonical }] });
    expect((list as { items: object[] }).items[0]).not.toHaveProperty('pageUrl');
    const detail = await enrichPageLinks(pool, '/api/v1/blogs/writer', { blog });
    expect(detail).toMatchObject({ blog: { url: localUrl, sourceUrl: source } });
    expect((detail as { blog: object }).blog).not.toHaveProperty('pageUrl');
    const internal = await enrichPageLinks(pool, '/api/blogs/writer', { blog });
    expect(internal).toMatchObject({ blog: { url: source, canonicalPath: canonical } });
    expect((internal as { blog: object }).blog).not.toHaveProperty('sourceUrl');
    expect((internal as { blog: object }).blog).not.toHaveProperty('pageUrl');
    const article = { id: 9, title: '文章', url: 'https://writer.example/post?original=1', blogSlug: 'writer' };
    expect(await enrichPageLinks(pool, '/api/v1/articles', { items: [article] })).toMatchObject({
      items: [{ ...article, blogCanonicalPath: canonical }],
    });
    expect(blog.url).toBe(source);
    expect(blog).not.toHaveProperty('sourceUrl');
  });
  it('keeps sourceUrl and supplies a local url fallback when registry lookup fails', async () => {
    const { pool } = fixture({ fail: true });
    const source = 'https://original.example/';
    expect(await enrichPageLinks(pool, '/api/v1/blogs', { items: [{ slug: 'discovered-abc', name: '作者', url: source }] })).toMatchObject({
      items: [
        {
          sourceUrl: source,
          url: 'https://weblog.tw/blogs/discovered-abc/',
        },
      ],
    });
  });
  it('preserves nullable source URLs and adds public topic url without pageUrl', async () => {
    const { pool } = fixture();
    const output = await enrichPageLinks(pool, '/api/v1/blogs', { items: [{ slug: 'writer', name: '無網址', url: null }] });
    expect(output).toMatchObject({ items: [{ sourceUrl: null, url: 'https://weblog.tw' + canonical }] });
    const topic = await enrichPageLinks(pool, '/api/v1/topics', {
      items: [{ id: `tag:${alias}`, label: 'AI' }],
    });
    expect(topic).toMatchObject({ items: [{ url: 'https://weblog.tw/topics/ai/' }] });
    expect((topic as { items: object[] }).items[0]).not.toHaveProperty('pageUrl');
    expect(await enrichPageLinks(pool, '/api/v1/topics/ai', { topic: { id: `tag:${alias}`, label: 'AI' } })).toMatchObject({
      topic: { url: 'https://weblog.tw/topics/ai/' },
    });
  });
  it('supplies topic legacy local fallback without mutating cached DTOs on a database failure', async () => {
    const { pool } = fixture({ fail: true });
    const payload = Object.freeze({ topic: Object.freeze({ id: `tag:${term}`, label: 'AI' }) });
    const output = await enrichPageLinks(pool, `/api/v1/topics/tag%3A${term}`, payload);
    expect(output).toMatchObject({ topic: { id: `tag:${term}`, url: `https://weblog.tw/topics/tag%3A${term}/` } });
    expect(payload.topic).not.toHaveProperty('url');
  });
  it('does not add pageUrl variants to any internal/public DTO', async () => {
    const { pool } = fixture();
    const payload = {
      blogs: [{ slug: 'writer', name: 'Writer', url: 'https://source.example/' }],
      posts: [{ blogSlug: 'writer' }],
      edges: [{ sourceBlogId: 1, targetBlogId: 1 }],
    };
    const output = await enrichPageLinks(pool, '/api/overview', payload);
    expect(JSON.stringify(output)).not.toMatch(/(?:pageUrl|PageUrl|sourceUrl)/);
  });
  it('does not publish URLs for punctuation-only topic labels', async () => {
    const { pool, calls } = fixture();
    const payload = { items: [{ id: `tag:${term}`, label: '／＋－…' }] };
    expect(await enrichPageLinks(pool, '/api/v1/topics', payload)).toBe(payload);
    expect(calls).toHaveLength(0);
  });
  it('bounds independent batches and does not enrich overflow requests with another request result', async () => {
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { pool, calls } = fixture({ wait });
    const payload = {
      blogs: [
        { slug: 'writer', name: '作者' },
        { slug: 'unknown', name: '未知' },
      ],
    };
    const tasks = Array.from({ length: 12 }, () => enrichPageLinks(pool, '/api/blogs', payload));
    release();
    const outputs = (await Promise.all(tasks)) as Array<typeof payload & { blogs: Array<{ canonicalPath?: string }> }>;
    expect(calls).toHaveLength(24); // Eight admitted requests, three fresh queries each.
    expect(outputs.slice(0, 8).every((result) => result.blogs[0].canonicalPath === canonical)).toBe(true);
    // Enrichment's existing failure path returns the untouched DTO, not someone else's successful lookup.
    expect(outputs.slice(8).every((result) => result === payload)).toBe(true);
    expect(outputs.slice(8).every((result) => !('canonicalPath' in result.blogs[0]))).toBe(true);
    await enrichPageLinks(pool, '/api/blogs', payload);
    expect(calls).toHaveLength(27);
    expect(payload.blogs[1]).not.toHaveProperty('canonicalPath');
  });
  it('does a fresh canonical lookup for B after hide while A holds a pre-hide lookup', async () => {
    const base = fixture();
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    let hidden = false,
      held = false;
    const pool = {
      query: async (sql: string, args: unknown[]) => {
        if (sql.includes("r.kind='blog'")) {
          if (hidden) return [[]];
          const old = await base.pool.query(sql, args);
          if (!held) {
            held = true;
            entered.resolve();
            await release.promise;
          }
          return old;
        }
        return base.pool.query(sql, args);
      },
    } as unknown as Pool;
    const payload = { blogs: [{ slug: 'writer', name: '作者' }] };
    const first = enrichPageLinks(pool, '/api/blogs', payload);
    await entered.promise;
    hidden = true;
    try {
      const before = base.calls.length;
      const second = (await enrichPageLinks(pool, '/api/blogs', payload)) as typeof payload;
      expect(base.calls.length).toBeGreaterThan(before);
      expect(second.blogs[0]).not.toHaveProperty('canonicalPath');
    } finally {
      release.resolve();
    }
    expect(await first).toMatchObject({ blogs: [{ canonicalPath: canonical }] });
  });
  it('caps unique references and skips oversized/deep payloads without a database lookup', async () => {
    const { pool, calls } = fixture();
    await enrichPageLinks(pool, '/api/blogs', { blogs: Array.from({ length: 1100 }, (_, id) => ({ slug: `writer-${id}`, name: 'blog' })) });
    expect((calls[0].args[1] as string[]).length).toBe(PAGE_LINK_LIMITS.references);
    expect(calls.length).toBeLessThanOrEqual(3);
    calls.length = 0;
    const huge = { blogs: Array.from({ length: PAGE_LINK_LIMITS.nodes + 1 }, () => ({ slug: 'writer', name: 'x' })) };
    expect(await enrichPageLinks(pool, '/api/blogs', huge)).toBe(huge);
    let deep: unknown = { blogSlug: 'writer' };
    for (let i = 0; i < 30; i++) deep = { nested: deep };
    expect(await enrichPageLinks(pool, '/api/blogs', deep)).toBe(deep);
    expect(calls).toHaveLength(0);
  });
  it('expires negative results and isolates caches between pools', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01'));
    const a = fixture(),
      b = fixture();
    const payload = { blogs: [{ slug: 'missing', name: 'missing' }] };
    await enrichPageLinks(a.pool, '/api/blogs', payload);
    const first = a.calls.length;
    await enrichPageLinks(b.pool, '/api/blogs', payload);
    expect(b.calls.length).toBe(first);
    vi.setSystemTime(new Date(Date.now() + PAGE_LINK_LIMITS.cacheMs + 1));
    await enrichPageLinks(a.pool, '/api/blogs', payload);
    expect(a.calls.length).toBe(first * 2);
  });
  it('does not change private headers; skips write/error/auth/admin/key/registry payloads', async () => {
    const { pool, calls } = fixture();
    const app = Fastify();
    registerPageLinks(app, pool);
    const payload = { follows: [{ slug: 'writer', name: '作者' }] };
    app.get('/api/me/follows', (_req, reply) => reply.header('cache-control', 'private, no-store').header('vary', 'Cookie').send(payload));
    app.post('/api/blogs', () => payload);
    app.get('/api/pages/blogs/writer', () => payload);
    app.get('/api/v1/blogs', (_req, reply) => reply.code(503).send(payload));
    const result = await app.inject('/api/me/follows');
    expect(result.headers['cache-control']).toBe('private, no-store');
    expect(result.headers.vary).toBe('Cookie');
    expect(result.json().follows[0].canonicalPath).toBe(canonical);
    const count = calls.length;
    expect((await app.inject({ method: 'POST', url: '/api/blogs' })).json()).toEqual(payload);
    expect((await app.inject('/api/pages/blogs/writer')).json()).toEqual(payload);
    expect((await app.inject('/api/v1/blogs')).statusCode).toBe(503);
    expect(calls.length).toBe(count);
    for (const path of ['/auth/me', '/api/admin/blogs', '/api/keys', '/api/v1/openapi.json']) expect(pageLinksEndpoint(path)).toBe(false);
    expect((await app.inject({ method: 'HEAD', url: '/api/me/follows' })).statusCode).toBe(200);
    await app.close();
  });
  it('fails open to the original DTO without exposing database failures', async () => {
    const { pool } = fixture({ fail: true });
    const payload = { blogs: [{ slug: 'writer', name: '作者' }] };
    expect(await enrichPageLinks(pool, '/api/blogs', payload)).toBe(payload);
  });
  it('enriches nested history articles with the blog canonical path without changing original URLs', async () => {
    const { pool } = fixture();
    const payload = {
      history: {
        articles: [
          {
            id: 9,
            title: '歷史文章',
            url: 'https://writer.example/post',
            blogSlug: 'writer',
            evidenceState: 'pending',
            observedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    };
    const output = await enrichPageLinks(pool, '/api/topics/tag:' + term, payload);
    expect(output).toMatchObject({ history: { articles: [{ blogCanonicalPath: canonical, url: 'https://writer.example/post' }] } });
    expect(payload.history.articles[0]).not.toHaveProperty('blogCanonicalPath');
  });
});
