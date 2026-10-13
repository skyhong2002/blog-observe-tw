import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { getPublicPages, isPublicRouteKey, resolvePublicPage } from '../seo/page-routes.ts';
import { iconManifest } from '../v1/favicon-routes.ts';
import { iconUrl } from '../v1/icons.ts';
import { TECH_LIMITS, type TechDetection, type TechObservation } from './contracts.ts';
import { safeTechSourceUrl, validTechObservation } from './detector.ts';
import { runTechRead } from './read-resource.ts';
import { publicTechSourceSql } from './store.ts';

export const TECH_READ_LIMIT = 2000;
const METHOD = Object.freeze({
  id: 'passive-existing-response',
  partial: true,
  additionalRequests: false,
  description: '僅辨識既有公開回應中的部分線索，不額外連線；未辨識不代表未使用。失敗時保留來源仍公開的上次成功結果。',
});
const states = ['detected', 'unknown', 'failed', 'blocked', 'not-observed'] as const;
const errors = ['robots', 'waf', 'rate-limit', 'http-error', 'timeout', 'network', 'invalid-response'];
const iso = (value: unknown): string | null => {
  if (!(typeof value === 'string' || value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time <= Date.now() + 300_000 ? new Date(time).toISOString() : null;
};
const parse = (value: unknown) => (typeof value === 'string' ? JSON.parse(value) : value);

/** Revalidate database JSON and copy only the detector-owned public fields. No raw response data escapes. */
export function projectTechScan(row: Record<string, unknown>) {
  const empty = {
    status: 'not-observed',
    observedAt: null as string | null,
    lastAttemptAt: null as string | null,
    errorCode: null as string | null,
    evidenceSourceUrl: null as string | null,
    coverage: null as TechObservation['coverage'] | null,
    detections: [] as TechDetection[],
  };
  if (!states.slice(0, 4).includes(row.status as never)) return empty;
  const lastAttemptAt = iso(row.last_attempt_at);
  if (!lastAttemptAt) return empty;
  const result = {
    ...empty,
    status: String(row.status),
    lastAttemptAt,
    errorCode: errors.includes(String(row.last_error_code)) ? String(row.last_error_code) : null,
  };
  const observedAt = iso(row.observed_at);
  if (!observedAt) return ['failed', 'blocked'].includes(result.status) ? result : empty;
  try {
    if (typeof row.detections === 'string' && Buffer.byteLength(row.detections) > TECH_LIMITS.payloadBytes) return empty;
    if (typeof row.coverage === 'string' && row.coverage.length > 1024) return empty;
    const detections = parse(row.detections);
    const coverage = parse(row.coverage);
    if (result.status === 'detected' && (!Array.isArray(detections) || !detections.length)) return empty;
    if (result.status === 'unknown' && (!Array.isArray(detections) || detections.length)) return empty;
    const snapshot = {
      status: Array.isArray(detections) && detections.length ? 'detected' : 'unknown',
      sourceUrl: row.source_url,
      sourceType: row.source_type,
      detections,
      coverage,
      ruleVersion: row.rule_version,
      observedAt,
      lastAttemptAt: observedAt,
      errorCode: null,
    } as TechObservation;
    if (!validTechObservation(snapshot) || observedAt > lastAttemptAt) return empty;
    return {
      ...result,
      observedAt,
      evidenceSourceUrl: snapshot.sourceUrl,
      coverage: {
        partial: true as const,
        method: 'passive-existing-response' as const,
        sourceType: coverage.sourceType,
        htmlTruncated: coverage.htmlTruncated,
        inspectedNodes: coverage.inspectedNodes,
      },
      detections: snapshot.detections.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        version: d.version,
        confidence: d.confidence,
        ruleId: d.ruleId,
        ruleVersion: d.ruleVersion,
        observedAt: d.observedAt,
        evidence: d.evidence.map((e) => ({ kind: e.kind, value: e.value })),
      })),
    };
  } catch {
    return empty;
  }
}

export const publicTechBlogUrl = (value: unknown): string | null => (typeof value === 'string' ? safeTechSourceUrl(value) : null);

const SELECT = `SELECT b.id,b.slug,b.name,b.url,s.status,s.detections,s.source_url,s.source_type,
 s.coverage,s.rule_version,s.observed_at,s.last_attempt_at,s.last_error_code
 FROM blogs b LEFT JOIN blog_tech_scans s ON s.blog_id=b.id AND ${publicTechSourceSql()}
 WHERE b.status='verified'`;
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
  const origin = new URL(options.publicOrigin ?? 'https://blog.observe.tw').origin;
  // Optional metadata failures must not expose database errors or change other routes.
  const routeOptions = {
    errorHandler: (_error: unknown, _request: FastifyRequest, reply: FastifyReply) =>
      reply.header('cache-control', 'private, no-store').code(503).send({ error: 'technology_unavailable' }),
  };
  const present = async (rows: RowDataPacket[], readPool: Pool) => {
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
      ...projectTechScan(r),
    }));
  };
  app.get<{ Querystring: Record<string, unknown> }>('/api/tech', routeOptions, async (request, reply) => {
    reply.header('cache-control', 'private, no-store');
    if (!options.enabled) return reply.code(404).send({ error: 'not_found' });
    const filters = techFilters(request.query);
    if (!filters) return reply.code(400).send({ error: 'invalid_query' });
    return runTechRead(pool, async (readPool) => {
      // Fixed bounded scan of sanitized snapshots, not an unbounded JSON aggregation or per-blog query loop.
      const [rows] = await readPool.query<RowDataPacket[]>(`${SELECT} ORDER BY b.id LIMIT ?`, [TECH_READ_LIMIT]);
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
      const projected = rows.map((row) => ({ row, scan: projectTechScan(row) }));
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
          (!filters.status || scan.status === filters.status) &&
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
      // Stable slug lookup first; readable aliases resolve only through the existing registry.
      let [rows] = await readPool.query<RowDataPacket[]>(`${SELECT} AND BINARY b.slug=BINARY ? LIMIT 1`, [request.params.slug]);
      if (!rows.length) {
        const page = await resolvePublicPage(readPool, 'blog', request.params.slug);
        if (page) [rows] = await readPool.query<RowDataPacket[]>(`${SELECT} AND b.id=? LIMIT 1`, [page.entityId]);
      }
      if (!rows.length) return reply.code(404).send({ error: 'not_found' });
      return { generatedAt: new Date().toISOString(), method: METHOD, blog: (await present(rows, readPool))[0] };
    });
  });
}
