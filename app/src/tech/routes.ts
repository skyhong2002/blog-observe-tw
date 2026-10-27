import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { tagDomain } from '../blog-genres/traffic.ts';
import { getPublicPages, isPublicRouteKey, resolvePublicPage } from '../seo/page-routes.ts';
import { iconManifest } from '../v1/favicon-routes.ts';
import { iconUrl } from '../v1/icons.ts';
import { runTechRead } from './read-resource.ts';
import { projectTrafficSite, trafficTechClient } from './traffic.ts';

export const TECH_READ_LIMIT = 2000;
const METHOD = Object.freeze({
  id: 'traffic-homepage-wappalyzer',
  partial: true,
  additionalRequests: true,
  description: '由 網站雷達（site.observe.tw） 每月抓取首頁，以 Wappalyzer 規則比對；未辨識不代表未使用，失敗時保留上次成功結果。',
});
const states = ['detected', 'unknown', 'failed', 'blocked', 'not-observed'] as const;
export const publicTechBlogUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
};
const SELECT = "SELECT b.id,b.slug,b.name,b.url,b.canonical_host FROM blogs b WHERE b.status='verified'";
type Filters = { q: string; technology: string; status: string; limit: number; cursor: number };
export function techFilters(raw: Record<string, unknown>): Filters | null {
  for (const value of Object.values(raw)) if (typeof value !== 'string') return null;
  const q = String(raw.q ?? '').trim();
  const technology = String(raw.technology ?? '');
  const status = String(raw.status ?? '');
  const limit = raw.limit === undefined ? 50 : Number(raw.limit);
  const cursor = raw.cursor === undefined ? 0 : Number(raw.cursor);
  if (
    [...q].length > 100 ||
    /[\p{Cc}\p{Cf}]/u.test(q) ||
    (technology && (technology.length > 64 || !/^(?:(?:wp-theme|wp-plugin):)?[a-z0-9][a-z0-9-]*$/.test(technology))) ||
    (status && !states.includes(status as never)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0
  )
    return null;
  return { q, technology, status, limit, cursor };
}

export function registerTechRoutes(app: FastifyInstance, pool: Pool, options: { enabled: boolean; publicOrigin?: string }) {
  const origin = new URL(options.publicOrigin ?? 'https://weblog.tw').origin;
  // Optional metadata failures must not expose database errors or change other routes.
  const routeOptions = {
    errorHandler: (_error: unknown, _request: FastifyRequest, reply: FastifyReply) =>
      reply.header('cache-control', 'private, no-store').code(503).send({ error: 'technology_unavailable' }),
  };
  type TechRow = RowDataPacket & { scan: ReturnType<typeof projectTrafficSite> };
  const client = trafficTechClient();
  const load = async (readPool: Pool) => {
    const [rows] = await readPool.query<RowDataPacket[]>(`${SELECT} ORDER BY b.id LIMIT ?`, [TECH_READ_LIMIT]);
    const sites = await client.read(rows.map((r) => r.canonical_host).filter((host): host is string => typeof host === 'string' && !!host));
    return rows.map((r) => ({ ...r, scan: projectTrafficSite(sites[tagDomain(r.canonical_host) ?? '']) })) as TechRow[];
  };
  const present = async (rows: TechRow[], readPool: Pool) => {
    const [pages, icons] = await Promise.all([
      getPublicPages(
        readPool,
        'blog',
        rows.map((r) => String(r.id)),
      ),
      iconManifest(),
    ]);
    return rows.map((r) => ({
      id: Number(r.id),
      slug: r.slug,
      name: r.name,
      url: pages.get(String(r.id)) ? new URL(pages.get(String(r.id))!.canonicalPath, origin).href : null,
      sourceUrl: publicTechBlogUrl(r.url),
      iconUrl: iconUrl(r.slug, icons),
      ...r.scan,
    }));
  };
  app.get<{ Querystring: Record<string, unknown> }>('/api/tech', routeOptions, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    if (!options.enabled) return reply.code(404).send({ error: 'not_found' });
    const filters = techFilters(request.query);
    if (!filters) return reply.code(400).send({ error: 'invalid_query' });
    return runTechRead(pool, async (readPool) => {
      // Fixed bounded scan of sanitized snapshots, not an unbounded JSON aggregation or per-blog query loop.
      const rows = await load(readPool);
      const [[count]] = await readPool.query<RowDataPacket[]>("SELECT COUNT(*) total FROM blogs WHERE status='verified'");
      const coverage = {
        totalBlogs: Number(count.total),
        scannedBlogs: rows.length,
        truncated: Number(count.total) > rows.length,
        detected: 0,
        unknown: 0,
        failed: 0,
        blocked: 0,
        notObserved: 0,
      };
      const technologies = new Map<string, { id: string; name: string; category: string; blogs: number; versions: Map<string, number> }>();
      const projected = rows.map((row) => ({ row, scan: row.scan }));
      for (const { scan } of projected) {
        const key = scan.status === 'not-observed' ? 'notObserved' : (scan.status as 'detected' | 'unknown' | 'failed' | 'blocked');
        coverage[key]++;
        const seen = new Set<string>();
        for (const d of scan.detections) {
          if (seen.has(d.id)) continue;
          seen.add(d.id);
          const t = technologies.get(d.id) ?? { id: d.id, name: d.name, category: d.category, blogs: 0, versions: new Map() };
          t.blogs++;
          t.versions.set(d.version, (t.versions.get(d.version) ?? 0) + 1);
          technologies.set(d.id, t);
        }
      }
      const matching = projected.filter(
        ({ row, scan }) =>
          (!filters.q ||
            `${row.name} ${row.slug} ${publicTechBlogUrl(row.url) ?? ''}`.toLocaleLowerCase().includes(filters.q.toLocaleLowerCase())) &&
          // The public page shows not-observed under 未辨識, so status=unknown lists both.
          (!filters.status || scan.status === filters.status || (filters.status === 'unknown' && scan.status === 'not-observed')) &&
          (!filters.technology || scan.detections.some((d) => d.id === filters.technology)),
      );
      const remaining = matching.filter(({ row }) => Number(row.id) > filters.cursor);
      const selected = remaining.slice(0, filters.limit);
      return {
        generatedAt: new Date().toISOString(),
        method: METHOD,
        coverage,
        technologies: [...technologies.values()]
          .sort((a, b) => a.category.localeCompare(b.category) || b.blogs - a.blogs || a.id.localeCompare(b.id))
          .map((t) => ({
            ...t,
            versions: [...t.versions].sort(([a], [b]) => a.localeCompare(b)).map(([version, blogs]) => ({ version, blogs })),
          })),
        items: await present(
          selected.map((x) => x.row),
          readPool,
        ),
        pagination: {
          limit: filters.limit,
          total: matching.length,
          nextCursor: remaining.length > selected.length ? String(selected.at(-1)!.row.id) : null,
        },
        filters: { q: filters.q, technology: filters.technology, status: filters.status },
      };
    });
  });
  app.get<{ Params: { slug: string } }>('/api/blogs/:slug/tech', routeOptions, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    if (!options.enabled) return reply.code(404).send({ error: 'not_found' });
    if (!isPublicRouteKey('blog', request.params.slug)) return reply.code(400).send({ error: 'invalid_slug' });
    return runTechRead(pool, async (readPool) => {
      const all = await load(readPool);
      let rows = all.filter((r) => r.slug === request.params.slug);
      if (!rows.length) {
        const page = await resolvePublicPage(readPool, 'blog', request.params.slug);
        if (page) rows = all.filter((r) => String(r.id) === String(page.entityId));
      }
      if (!rows.length) return reply.code(404).send({ error: 'not_found' });
      return { generatedAt: new Date().toISOString(), method: METHOD, blog: (await present(rows, readPool))[0] };
    });
  });
}
