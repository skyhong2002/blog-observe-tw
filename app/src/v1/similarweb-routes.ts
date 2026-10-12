import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { normalizeSimilarDomain } from '../crawl/similarweb-client.ts';

const SHARED_PLATFORMS = new Set([
  'medium.com',
  'pixnet.net',
  'blogspot.com',
  'blogger.com',
  'wordpress.com',
  'wixsite.com',
  'weebly.com',
  'tumblr.com',
  'substack.com',
  'github.io',
  'notion.site',
  'sites.google.com',
  'google.com',
  'facebook.com',
]);
const LIMITATIONS = 'Similarweb 對整個網域的月造訪次數估計，包含首頁與歷史內容；不是不重複讀者、page views、文章品質或作者個人流量。';
export type PublicTraffic = {
  monthly: Array<{ month: string; visits: number }>;
  globalRank: number | null;
  countryRank: { code: string; rank: number } | null;
  category: string | null;
  topCountries: Array<{ code: string; share: number }>;
};
export type PublicTrafficBlog = {
  slug: string;
  name: string;
  domain: string;
  status: 'ready' | 'pending' | 'blocked' | 'no-data' | 'unavailable';
  fetchedAt: string | null;
  traffic: PublicTraffic | null;
};
type TrafficRow = {
  slug: string;
  name: string;
  url: string | null;
  canonicalHost: string | null;
  status: string;
  result: unknown;
  lastErrorCode?: string | null;
};
const obj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const rank = (value: unknown) => (positive(value) && Number.isInteger(value) && value > 0 ? value : null);
function publicTraffic(value: unknown): PublicTraffic | null {
  if (!obj(value) || !Array.isArray(value.monthly) || !value.monthly.length || value.monthly.length > 120) return null;
  const monthly: PublicTraffic['monthly'] = [];
  for (const point of value.monthly) {
    if (!obj(point) || typeof point.month !== 'string' || !/^\d{4}(0[1-9]|1[0-2])$/.test(point.month) || !positive(point.visits))
      return null;
    monthly.push({ month: point.month, visits: point.visits });
  }
  const countryRank =
    obj(value.countryRank) &&
    typeof value.countryRank.code === 'string' &&
    /^[A-Z]{2}$/.test(value.countryRank.code) &&
    rank(value.countryRank.rank) !== null
      ? { code: value.countryRank.code, rank: rank(value.countryRank.rank) as number }
      : null;
  const topCountries: PublicTraffic['topCountries'] = [];
  for (const country of Array.isArray(value.topCountries) ? value.topCountries.slice(0, 250) : []) {
    if (
      obj(country) &&
      typeof country.code === 'string' &&
      /^[A-Z]{2}$/.test(country.code) &&
      positive(country.share) &&
      country.share <= 1
    )
      topCountries.push({ code: country.code, share: country.share });
  }
  return {
    monthly,
    globalRank: rank(value.globalRank),
    countryRank,
    category: typeof value.category === 'string' ? value.category.slice(0, 64) : null,
    topCountries,
  };
}
function decode(value: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return obj(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
/** Allowlist-only public projection: no requests, internal status details, evidence, tokens or service headers. */
export function projectPublicTraffic(rows: TrafficRow[]): PublicTrafficBlog[] {
  const eligible = rows.flatMap((row) => {
    if (row.status !== 'verified' || !row.url || !row.canonicalHost) return [];
    const domain = normalizeSimilarDomain(row.canonicalHost);
    if (!domain || SHARED_PLATFORMS.has(domain) || normalizeSimilarDomain(row.url) !== domain) return [];
    return [{ row, domain }];
  });
  const counts = new Map<string, number>();
  for (const { domain } of eligible) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  return eligible
    .filter(({ domain }) => counts.get(domain) === 1)
    .map(({ row, domain }) => {
      const data = decode(row.result);
      const base: PublicTrafficBlog = { slug: row.slug, name: row.name, domain, status: 'pending', fetchedAt: null, traffic: null };
      if (!data) return { ...base, status: row.lastErrorCode === 'blocked' ? 'blocked' : row.lastErrorCode ? 'unavailable' : 'pending' };
      if (data.domain !== domain || data.source !== 'similarweb-extension' || !Array.isArray(data.requests))
        return { ...base, status: 'unavailable' };
      const requests = data.requests.filter(obj);
      const current =
        requests.find((request) => request.kind === 'traffic') ?? requests.find((request) => request.kind === 'similar_sites');
      if (!current || !['pending', 'ok', 'no-data', 'blocked'].includes(String(current.status))) return { ...base, status: 'unavailable' };
      const fetchedAt =
        typeof data.fetchedAt === 'string' && data.fetchedAt.length <= 40 && Number.isFinite(Date.parse(data.fetchedAt))
          ? data.fetchedAt
          : null;
      const traffic = fetchedAt ? publicTraffic(data.traffic) : null;
      const blocked = requests.some((request) => request.status === 'blocked') || row.lastErrorCode === 'blocked';
      const status = blocked
        ? 'blocked'
        : row.lastErrorCode
          ? 'unavailable'
          : current.status === 'pending'
            ? 'pending'
            : current.kind === 'traffic' && current.status === 'no-data'
              ? 'no-data'
              : traffic
                ? 'ready'
                : current.status === 'no-data'
                  ? 'no-data'
                  : 'unavailable';
      return { ...base, status, fetchedAt, traffic };
    });
}

export function registerSimilarwebTraffic(app: FastifyInstance, pool: Pick<Pool, 'query'>) {
  app.get<{ Querystring: { blog?: string } }>('/api/traffic', async (request, reply) => {
    if (request.query.blog !== undefined && (typeof request.query.blog !== 'string' || request.query.blog.length > 255))
      return reply.code(400).send({ error: 'invalid blog' });
    try {
      const [rows] = await pool.query<RowDataPacket[]>(`SELECT b.slug,b.name,b.url,b.canonical_host AS canonicalHost,b.status,
        s.result,s.last_error_code AS lastErrorCode FROM blogs b LEFT JOIN similarweb_domains s
        ON s.domain=LOWER(CASE WHEN LOWER(b.canonical_host) LIKE 'www.%' THEN SUBSTRING(b.canonical_host,5) ELSE b.canonical_host END)
        WHERE b.status='verified' AND b.url IS NOT NULL AND b.canonical_host IS NOT NULL ORDER BY b.name LIMIT 1000`);
      const blogs = projectPublicTraffic(rows as TrafficRow[]).filter((blog) => !request.query.blog || blog.slug === request.query.blog);
      reply.header('cache-control', 'public, max-age=60');
      return { source: 'similarweb-extension', scope: 'domain', limitations: LIMITATIONS, blogs };
    } catch {
      return reply.code(503).header('cache-control', 'no-store').send({ error: 'traffic unavailable' });
    }
  });
}
