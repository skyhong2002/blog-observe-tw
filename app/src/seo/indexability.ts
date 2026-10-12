import type { Pool, RowDataPacket } from 'mysql2/promise';
import { TopicResponseCache } from '../topics/cache.ts';
import { POLICY_VERSION } from '../topics/policy.ts';
import { evidence } from '../topics/routes.ts';
import { SOURCE } from '../topics/snapshot-client.ts';
import { getPublicPages, type PublicPage, type PublicPageKind } from './page-routes.ts';

export const INDEXABILITY_WINDOW_DAYS = 90;
export const INDEXABILITY_CACHE_MS = 300_000;
export type PageIndexability = {
  indexable: boolean;
  indexabilityReason: string | null;
  windowDays: 90;
  posts: number;
  blogs: number;
  currentVersion: string | null;
};
export type IndexablePage = PublicPage & PageIndexability & { lastmod: unknown };
type Counts = { posts: number; blogs: number; lastmod: unknown };
type Projection = { version: string | null; topics: Map<string, Counts>; blogs: Map<string, Counts> };
const validPostDate =
  'COALESCE(CASE WHEN p.updated_at<=UTC_TIMESTAMP() THEN p.updated_at END,CASE WHEN p.published_at<=UTC_TIMESTAMP() THEN p.published_at END,CASE WHEN p.created_at<=UTC_TIMESTAMP() THEN p.created_at END)';
const validBlogUrl = (value: unknown) => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};
export const topicIndexabilitySql = `WITH ${evidence(false, true)}
 SELECT SUBSTRING(r.topic_id,5) entity_id,COUNT(*) posts,COUNT(DISTINCT r.blog_id) blogs,MAX(${validPostDate}) lastmod
 FROM recent r JOIN posts p ON p.id=r.post_id GROUP BY r.topic_id`;
/** The same per-post evidence and thresholds drive the page DTO and sitemap membership. */
export function topicIndexability(
  counts: { posts: number; blogs: number },
  currentVersion: string | null,
  term?: { exclusionReason: string | null; inactiveReason: string | null } | null,
): PageIndexability {
  const reason =
    !currentVersion || !term
      ? 'not-current-term'
      : term.exclusionReason
        ? 'excluded-term'
        : term.inactiveReason
          ? 'inactive-term'
          : counts.posts < 3
            ? 'insufficient-posts'
            : counts.blogs < 2
              ? 'insufficient-blogs'
              : null;
  return { indexable: !reason, indexabilityReason: reason, windowDays: 90, ...counts, currentVersion };
}
class PageIndexabilityStore {
  private readonly cache = new TopicResponseCache(INDEXABILITY_CACHE_MS, 256);
  private readonly pool: Pool;
  constructor(pool: Pool) {
    this.pool = pool;
  }
  private projection() {
    return this.cache.get<Projection>('projection', async () => {
      const c = await this.pool.getConnection();
      try {
        await c.beginTransaction();
        const [[current]] = await c.query<RowDataPacket[]>(
          "SELECT s.id FROM topic_current c JOIN topic_snapshots s ON s.id=c.snapshot_id WHERE c.source=? AND s.status='published'",
          [SOURCE],
        );
        const now = new Date(),
          since = new Date(now.getTime() - INDEXABILITY_WINDOW_DAYS * 86400_000);
        const [topics] = current ? await c.query<RowDataPacket[]>(topicIndexabilitySql, [since, now]) : [[]];
        const [blogs] = await c.query<RowDataPacket[]>(
          `SELECT b.id entity_id,b.url,SUM(CASE WHEN p.published_at>=? AND p.published_at<=? THEN 1 ELSE 0 END) posts,
          COALESCE(MAX(${validPostDate}),CASE WHEN b.discovered_at<=UTC_TIMESTAMP() THEN b.discovered_at END) lastmod
          FROM blogs b LEFT JOIN posts p ON p.blog_id=b.id WHERE b.status='verified' AND b.url REGEXP '^https?://' GROUP BY b.id`,
          [since, now],
        );
        await c.commit();
        return {
          version: current?.id ?? null,
          topics: new Map(topics.map((r) => [String(r.entity_id), { posts: Number(r.posts), blogs: Number(r.blogs), lastmod: r.lastmod }])),
          blogs: new Map(
            blogs
              .filter((r) => validBlogUrl(r.url))
              .map((r) => [String(r.entity_id), { posts: Number(r.posts), blogs: 1, lastmod: r.lastmod }]),
          ),
        };
      } catch (error) {
        await c.rollback();
        throw error;
      } finally {
        c.release();
      }
    });
  }
  async page(kind: PublicPageKind, entityId: string): Promise<PageIndexability> {
    const projection = await this.projection();
    if (kind === 'blog') {
      const row = projection.blogs.get(entityId);
      return {
        indexable: Boolean(row),
        indexabilityReason: row ? null : 'unverified-or-invalid-url',
        windowDays: 90,
        posts: row?.posts ?? 0,
        blogs: row ? 1 : 0,
        currentVersion: projection.version,
      };
    }
    const matched = projection.topics.get(entityId);
    if (matched)
      return topicIndexability({ posts: matched.posts, blogs: matched.blogs }, projection.version, {
        exclusionReason: null,
        inactiveReason: null,
      });
    return this.cache.get(`topic:${projection.version}:${entityId}`, async () => {
      const [[term]] = projection.version
        ? await this.pool.query<RowDataPacket[]>(
            'SELECT exclusion_reason,inactive_reason FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id=? AND policy_version=?',
            [projection.version, entityId, POLICY_VERSION],
          )
        : [[]];
      const counts = projection.topics.get(entityId);
      return topicIndexability(
        { posts: counts?.posts ?? 0, blogs: counts?.blogs ?? 0 },
        projection.version,
        term ? { exclusionReason: term.exclusion_reason, inactiveReason: term.inactive_reason } : null,
      );
    });
  }
  async sitemap(kind: PublicPageKind): Promise<IndexablePage[]> {
    return this.cache.get(`sitemap:${kind}`, async () => {
      const projection = await this.projection();
      const rows =
        kind === 'blog'
          ? [...projection.blogs]
          : [...projection.topics].filter(
              ([, counts]) => topicIndexability(counts, projection.version, { exclusionReason: null, inactiveReason: null }).indexable,
            );
      const pages: IndexablePage[] = [];
      for (let offset = 0; offset < rows.length; offset += 500) {
        const batch = rows.slice(offset, offset + 500);
        const registry = await getPublicPages(
          this.pool,
          kind,
          batch.map(([id]) => id),
        );
        for (const [id, counts] of batch) {
          const page = registry.get(id);
          if (page)
            pages.push({
              ...page,
              indexable: true,
              indexabilityReason: null,
              windowDays: 90,
              posts: counts.posts,
              blogs: counts.blogs,
              currentVersion: projection.version,
              lastmod: counts.lastmod,
            });
        }
      }
      return pages.sort((a, b) => a.entityId.localeCompare(b.entityId, 'en'));
    });
  }
}
const stores = new WeakMap<Pool, PageIndexabilityStore>();
function store(pool: Pool) {
  let value = stores.get(pool);
  if (!value) {
    value = new PageIndexabilityStore(pool);
    stores.set(pool, value);
  }
  return value;
}
export const getPageIndexability = (pool: Pool, kind: PublicPageKind, entityId: string) => store(pool).page(kind, entityId);
export const getIndexablePages = (pool: Pool, kind: PublicPageKind) => store(pool).sitemap(kind);
/** Bulk metadata enrichment reuses one projection and the bounded per-term cache. */
export async function getPageMetadata(pool: Pool, kind: PublicPageKind, entityIds: string[]) {
  const registry = await getPublicPages(pool, kind, entityIds);
  const result = new Map<string, PublicPage & PageIndexability>();
  // Sequential reads keep metadata enrichment within the shared DB concurrency budget.
  for (const [id, page] of registry) result.set(id, { ...page, ...(await getPageIndexability(pool, kind, id)) });
  return result;
}
