import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let root: string;
let manifestPath: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'blog-icons-'));
  await mkdir(join(root, 'app/data'), { recursive: true });
  manifestPath = join(root, 'app/data/favicon-local.json');
  await writeFile(manifestPath, JSON.stringify({ kocpc: { revision: 'abcdef1234567890', source: 'private-source' } }));
  vi.stubEnv('BLOG_FAVICON_ROOT', root);
  vi.resetModules();
});
afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const expected = 'https://blog.observe.tw/favicons/kocpc.png?v=abcdef1234567890';
const blog = { id: 1, slug: 'kocpc', name: '電腦王阿達', postCount: '2' };

describe('runtime favicon projection with an empty bundled manifest', () => {
  it('includes runtime icons in v1 blog listing, detail and article responses', async () => {
    const { listBlogs, findPublicBlog, listArticles } = await import('../public-api/data.ts');
    const { blogsQuery, articleQuery } = await import('../public-api/query.ts');
    const pool = { query: vi.fn().mockResolvedValue([[blog]]) } as unknown as Pool;
    expect((await listBlogs(pool, blogsQuery({ limit: '50' }))).items[0].iconUrl).toBe(expected);
    expect((await findPublicBlog(pool, 'kocpc'))?.iconUrl).toBe(expected);
    vi.mocked(pool.query).mockResolvedValue([[{ id: 2, title: '文章', blogSlug: 'kocpc', sortAt: new Date() }], []] as never);
    expect((await listArticles(pool, articleQuery({}))).items[0].iconUrl).toBe(expected);
  });

  it('includes icons in the ISR catalog and overview used by search suggestions', async () => {
    const { loadCatalog } = await import('../catalog.js');
    const { loadOverview } = await import('../overview.js');
    const responses = [[{ blogs: 1, posts: 2, withUrls: 1, authors: 1 }], [], [], [{ total: 1 }], [blog]];
    // The directory's tag read (blog-genres/store.ts) answers empty on its own.
    const catalog = await loadCatalog({
      query: async (sql: string) => [
        sql.includes('canonical_host host') || sql.startsWith('SELECT kind AS value') ? [] : responses.shift(),
      ],
    });
    expect(catalog.blogs[0].iconUrl).toBe(expected);
    const overviewRows = [[], [], [], [blog], [{ blogs: 1, posts: 2 }], [blog]];
    const overview = await loadOverview({ query: async () => [overviewRows.shift()] });
    expect(overview.blogs[0].iconUrl).toBe(expected);
    expect(overview.recentBlogs[0].iconUrl).toBe(expected);
  });

  it('returns runtime icons in authenticated follows while preserving private cache policy', async () => {
    const { buildApp } = await import('../app.js');
    const user = { id: 7, sub: 'fixture', role: 'reader', email: 'reader@example.invalid', name: 'Reader', picture: null };
    const db = {
      select() {
        return this;
      },
      from() {
        return this;
      },
      innerJoin() {
        return this;
      },
      where: async () => [user],
    };
    const pool = { query: async () => [[blog]] };
    const app = await buildApp(
      {
        port: 18165,
        uiOrigin: 'http://127.0.0.1:1',
        publicOrigin: 'https://blog.observe.tw',
        adminEmails: new Set(),
        login: {
          clientId: 'fixture',
          clientSecret: 'fixture',
          sessionSecret: 'fixture-only-secret-01234567890123456789',
          origin: 'https://blog.observe.tw',
        },
      },
      // @ts-expect-error Narrow fixture only implements session and follow reads.
      { store: { pool, db } },
    );
    try {
      const result = await app.inject({ url: '/api/me/follows', headers: { cookie: 'blog_session=fixture-reader-token' } });
      expect(result.statusCode).toBe(200);
      expect(result.json().follows[0].iconUrl).toBe(expected);
      expect(result.headers['cache-control']).toContain('no-store');
    } finally {
      await app.close();
    }
  });

  it('refreshes revisions without a build and retains the last safe snapshot on read failure', async () => {
    const { iconManifest } = await import('./favicon-routes.ts');
    const { iconUrl } = await import('./icons.ts');
    const now = Date.now();
    await writeFile(manifestPath, JSON.stringify({ kocpc: { revision: '12345678abcdef00' }, unsafe: { revision: 'bad-revision' } }));
    vi.spyOn(Date, 'now').mockReturnValue(now + 6000);
    let icons = await iconManifest();
    expect(iconUrl('kocpc', icons)).toBe('https://blog.observe.tw/favicons/kocpc.png?v=12345678abcdef00');
    expect(iconUrl('missing', icons)).toBeNull();
    expect(icons).not.toHaveProperty('unsafe');
    await rm(manifestPath);
    vi.mocked(Date.now).mockReturnValue(now + 12000);
    icons = await iconManifest();
    expect(iconUrl('kocpc', icons)).toContain('12345678abcdef00');
    expect(JSON.stringify(icons)).not.toContain('private-source');
  });
});
