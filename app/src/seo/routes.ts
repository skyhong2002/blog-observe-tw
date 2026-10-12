import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { TopicResponseCache } from '../topics/cache.ts';
import { historyReadsEnabled } from '../topics/history-contracts.ts';
import { getIndexablePages } from './indexability.ts';

export const SEO_ORIGIN = 'https://blog.observe.tw';
export const SITEMAP_PAGE_SIZE = 10_000;
const MAX_XML_BYTES = 50 * 1024 * 1024;
const CACHE = 'public, max-age=300, s-maxage=300, stale-while-revalidate=600';
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
export function sitemapChildPaths(blogCount: number, topicCount: number) {
  const paths = ['/sitemaps/pages.xml'];
  for (const [kind, count] of [
    ['blogs', blogCount],
    ['topics', topicCount],
  ] as const) {
    if (!Number.isSafeInteger(count) || count < 0 || Math.ceil(count / SITEMAP_PAGE_SIZE) > 4999) throw Error('sitemap_count_limit');
    for (let page = 1; page <= Math.max(1, Math.ceil(count / SITEMAP_PAGE_SIZE)); page++) paths.push(childPath(kind, page));
  }
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
  const stats = () =>
    cache.get('counts', async () => {
      const [blogs, topics] = await Promise.all([getIndexablePages(pool, 'blog'), getIndexablePages(pool, 'topic')]);
      const newest = (rows: { lastmod: unknown }[]) =>
        rows
          .map((row) => iso(row.lastmod))
          .filter((date): date is string => Boolean(date))
          .sort()
          .at(-1) ?? null;
      const pages = await pageEntries();
      const dates = pages
        .map((p) => iso(p.lastmod))
        .filter((d): d is string => Boolean(d))
        .sort();
      const fallback = await fileDate(new URL('./routes.ts', import.meta.url));
      return {
        blogs: blogs.length,
        topics: topics.length,
        blogsLastmod: newest(blogs) ?? iso(fallback),
        topicsLastmod: newest(topics) ?? iso(fallback),
        pagesLastmod: dates.at(-1) ?? iso(fallback),
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
        sitemapChildPaths(counts.blogs, counts.topics).map((path) => ({
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
      page = Number(match[2] ?? 1),
      counts = await stats();
    if (page > Math.max(1, Math.ceil(counts[kind] / SITEMAP_PAGE_SIZE)))
      return reply.code(404).header('cache-control', 'no-store').send({ error: 'not_found' });
    const xml = await cache.get(`${kind}:${page}`, async () => {
      const offset = (page - 1) * SITEMAP_PAGE_SIZE;
      const rows = (await getIndexablePages(pool, kind === 'blogs' ? 'blog' : 'topic')).slice(offset, offset + SITEMAP_PAGE_SIZE);
      const fallback =
        (await fileDate(
          new URL(
            kind === 'blogs' ? '../../../web/src/app/blogs/[slug]/page.tsx' : '../../../web/src/app/topics/[id]/page.tsx',
            import.meta.url,
          ),
        )) ?? (await fileDate(new URL('./routes.ts', import.meta.url)));
      return sitemapXml(rows.map((row) => ({ loc: SEO_ORIGIN + row.canonicalPath, lastmod: kind === 'topics' && historyReadsEnabled() ? iso(row.lastmod) : iso(row.lastmod) ?? iso(fallback) })));
    });
    return reply.type('application/xml; charset=utf-8').header('cache-control', CACHE).send(xml);
  });
}
