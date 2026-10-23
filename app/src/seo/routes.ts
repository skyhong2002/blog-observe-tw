import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { TopicResponseCache } from '../topics/cache.ts';
import { historyReadsEnabled } from '../topics/history-contracts.ts';
import {
  type SitemapEntry,
  sitemapBlogs,
  sitemapTopicRoutes,
  sitemapTopics,
  sitemapTopicsLastmod,
  type TopicRange,
} from './sitemap-entries.ts';

export const SEO_ORIGIN = 'https://blog.observe.tw';
export const SITEMAP_PAGE_SIZE = 10_000;
/** Topic files split the uniform SHA-256 ID space; each holds at most about this many routes, far below the per-file cap. */
export const SITEMAP_TOPIC_BUCKET = 1_000;
const MAX_XML_BYTES = 50 * 1024 * 1024;
const CACHE = 'no-store';
const staticPages = ['/', '/blogs/', '/topics/', '/api/', '/about/'] as const;
export const xmlEscape = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const iso = (value: unknown): string | null => {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() <= Date.now() ? date.toISOString() : null;
};
export function sitemapXml(entries: { loc: string; lastmod?: unknown }[], index = false) {
  if (entries.length > SITEMAP_PAGE_SIZE) throw Error('sitemap_entry_limit');
  const root = index ? 'sitemapindex' : 'urlset',
    tag = index ? 'sitemap' : 'url';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><${root} xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((e) => `<${tag}><loc>${xmlEscape(e.loc)}</loc>${iso(e.lastmod) ? `<lastmod>${iso(e.lastmod)}</lastmod>` : ''}</${tag}>`).join('')}</${root}>`;
  if (Buffer.byteLength(xml) > MAX_XML_BYTES) throw Error('sitemap_byte_limit');
  return xml;
}
const childPath = (kind: 'blogs' | 'topics', page: number) => `/sitemaps/${kind}${page === 1 ? '' : `-${page}`}.xml`;
const pageCount = (count: number, size: number) => {
  if (!Number.isSafeInteger(count) || count < 0 || Math.ceil(count / size) > 4999) throw Error('sitemap_count_limit');
  return Math.max(1, Math.ceil(count / size));
};
export const blogSitemapPages = (blogs: number) => pageCount(blogs, SITEMAP_PAGE_SIZE);
export const topicSitemapPages = (topicRoutes: number) => pageCount(topicRoutes, SITEMAP_TOPIC_BUCKET);
/** Topic file `page` of `pages` covers IDs from its 8-hex lower bound (inclusive) to the next file's (exclusive). */
export function topicSitemapRange(page: number, pages: number): TopicRange {
  const bound = (i: number) =>
    i <= 0 || i >= pages
      ? null
      : Math.floor((i * 2 ** 32) / pages)
          .toString(16)
          .padStart(8, '0');
  return { from: bound(page - 1), to: bound(page) };
}
export function sitemapChildPaths(blogCount: number, topicRoutes: number) {
  const paths = ['/sitemaps/pages.xml'];
  for (let page = 1; page <= blogSitemapPages(blogCount); page++) paths.push(childPath('blogs', page));
  for (let page = 1; page <= topicSitemapPages(topicRoutes); page++) paths.push(childPath('topics', page));
  return paths;
}
export function registerSeoRoutes(app: FastifyInstance, pool: Pool) {
  const cache = new TopicResponseCache(300_000, 32);
  const fileDate = (source: URL) =>
    stat(source)
      .then((s) => s.mtime)
      .catch(() => null);
  const pageEntries = () =>
    cache.get('page-entries', async () =>
      Promise.all(
        staticPages.map(async (path) => ({
          loc: SEO_ORIGIN + path,
          lastmod: await fileDate(new URL(`../../../web/src/app/${path === '/' ? '' : path.slice(1)}page.tsx`, import.meta.url)),
        })),
      ),
    );
  const newest = (rows: { lastmod: unknown }[]) =>
    rows
      .map((row) => iso(row.lastmod))
      .filter((date): date is string => Boolean(date))
      .sort()
      .at(-1) ?? null;
  // Blogs, the topic route count and the newest topic date are independent reads; none waits for a full topic list.
  const stats = () =>
    cache.get('counts', async () => {
      const [blogs, topicRoutes, topicsNewest, pages, fallback] = await Promise.all([
        sitemapBlogs(pool),
        sitemapTopicRoutes(pool),
        sitemapTopicsLastmod(pool),
        pageEntries(),
        fileDate(new URL('./routes.ts', import.meta.url)),
      ]);
      return {
        blogs: blogs.length,
        topicRoutes,
        blogsLastmod: newest(blogs) ?? iso(fallback),
        topicsLastmod: iso(topicsNewest) ?? iso(fallback),
        pagesLastmod: newest(pages) ?? iso(fallback),
      };
    });
  app.get('/robots.txt', async (_request, reply) =>
    reply
      .type('text/plain; charset=utf-8')
      .header('cache-control', CACHE)
      .send(
        [
          'User-agent: *',
          'Allow: /',
          'Disallow: /my',
          'Disallow: /me',
          'Disallow: /auth',
          'Disallow: /login',
          'Disallow: /admin',
          'Disallow: /search',
          'Disallow: /api/',
          'Allow: /api/$',
          'Allow: /api/v1/openapi.json$',
          '',
          `Sitemap: ${SEO_ORIGIN}/sitemap.xml`,
          '',
        ].join('\n'),
      ),
  );
  app.get('/sitemap.xml', async (_request, reply) => {
    const xml = await cache.get('index', async () => {
      const counts = await stats();
      return sitemapXml(
        sitemapChildPaths(counts.blogs, counts.topicRoutes).map((path) => ({
          loc: SEO_ORIGIN + path,
          lastmod: path.includes('/blogs') ? counts.blogsLastmod : path.includes('/topics') ? counts.topicsLastmod : counts.pagesLastmod,
        })),
        true,
      );
    });
    return reply.type('application/xml; charset=utf-8').header('cache-control', CACHE).send(xml);
  });
  app.get<{ Params: { file: string } }>('/sitemaps/:file', async (request, reply) => {
    const file = request.params.file;
    if (file === 'pages.xml') {
      const xml = await cache.get('pages', async () => sitemapXml(await pageEntries()));
      return reply.type('application/xml; charset=utf-8').header('cache-control', CACHE).send(xml);
    }
    const match = /^(blogs|topics)(?:-([1-9]\d{0,5}))?\.xml$/.exec(file);
    if (!match || match[2] === '1') return reply.code(404).header('cache-control', 'no-store').send({ error: 'not_found' });
    const kind = match[1] as 'blogs' | 'topics',
      page = Number(match[2] ?? 1);
    const xml = await cache.get(`${kind}:${page}`, async () => {
      let rows: SitemapEntry[];
      if (kind === 'blogs') {
        const blogs = await sitemapBlogs(pool);
        if (page > blogSitemapPages(blogs.length)) return null;
        rows = blogs.slice((page - 1) * SITEMAP_PAGE_SIZE, page * SITEMAP_PAGE_SIZE);
      } else {
        const pages = topicSitemapPages(await sitemapTopicRoutes(pool));
        if (page > pages) return null;
        rows = await sitemapTopics(pool, topicSitemapRange(page, pages));
      }
      const fallback =
        (await fileDate(
          new URL(
            kind === 'blogs' ? '../../../web/src/app/blogs/[slug]/page.tsx' : '../../../web/src/app/topics/[id]/page.tsx',
            import.meta.url,
          ),
        )) ?? (await fileDate(new URL('./routes.ts', import.meta.url)));
      return sitemapXml(
        rows.map((row) => ({
          loc: SEO_ORIGIN + row.canonicalPath,
          lastmod: kind === 'topics' && historyReadsEnabled() ? iso(row.lastmod) : (iso(row.lastmod) ?? iso(fallback)),
        })),
      );
    });
    if (xml === null) return reply.code(404).header('cache-control', 'no-store').send({ error: 'not_found' });
    return reply.type('application/xml; charset=utf-8').header('cache-control', CACHE).send(xml);
  });
}
