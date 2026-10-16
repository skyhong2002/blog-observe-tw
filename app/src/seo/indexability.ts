import type { Pool, RowDataPacket } from 'mysql2/promise';
import { TopicResponseCache } from '../topics/cache.ts';
import { historyReadsEnabled } from '../topics/history-contracts.ts';
import { historyEvidenceSql, historyPublicTopicSql, topicHistoryDisposition } from '../topics/history-read.ts';
import { exclusionReason, POLICY_VERSION } from '../topics/policy.ts';
import { publicationExclusionReason } from '../topics/publication-noise.ts';
import { evidence } from '../topics/routes.ts';
import { SOURCE } from '../topics/snapshot-client.ts';
import { getPublicPages, type PublicPage, type PublicPageKind } from './page-routes.ts';

export const INDEXABILITY_WINDOW_DAYS = 90;
export const INDEXABILITY_CACHE_MS = 0;
export type PageIndexability = {
  indexable: boolean;
  indexabilityReason: string | null;
  windowDays: 90 | null;
  posts: number;
  blogs: number;
  currentVersion: string | null;
};
export type IndexablePage = PublicPage & PageIndexability & { lastmod: unknown };
type Counts = { posts: number; blogs: number; lastmod: unknown };
type Projection = { version: string | null; topics: Map<string, Counts>; blogs: Map<string, Counts>; sitemapBlogIds: Set<string> };
const validPostDate =
  'COALESCE(CASE WHEN p.updated_at<=UTC_TIMESTAMP() THEN p.updated_at END,CASE WHEN p.published_at<=UTC_TIMESTAMP() THEN p.published_at END,CASE WHEN p.created_at<=UTC_TIMESTAMP() THEN p.created_at END)';
const legacySitemapBlog = (row: RowDataPacket) =>
  row.status === 'verified' &&
  typeof row.slug === 'string' &&
  /^[a-z0-9][a-z0-9_-]{0,179}$/.test(row.slug) &&
  typeof row.url === 'string' &&
  /^https?:\/\//.test(row.url);
export const topicIndexabilitySql = `WITH ${evidence(false, true)}
 SELECT SUBSTRING(r.topic_id,5) entity_id,COUNT(*) posts,COUNT(DISTINCT r.blog_id) blogs,MAX(${validPostDate}) lastmod
 FROM recent r JOIN posts p ON p.id=r.post_id GROUP BY r.topic_id`;
/** Counts describe observed coverage, never a new minimum-content or low-frequency noindex gate. */
export function topicIndexability(
  counts: { posts: number; blogs: number },
  currentVersion: string | null,
  term?: { exclusionReason: string | null; inactiveReason: string | null; label?: string } | null,
): PageIndexability {
  const excluded = term?.exclusionReason || (typeof term?.label === 'string' ? publicationExclusionReason(term.label) : null);
  const reason = excluded ? 'excluded-term' : null;
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
          `SELECT b.id entity_id,b.url,b.slug,b.status,SUM(CASE WHEN p.published_at>=? AND p.published_at<=? THEN 1 ELSE 0 END) posts,
          COALESCE(MAX(${validPostDate}),CASE WHEN b.discovered_at<=UTC_TIMESTAMP() THEN b.discovered_at END) lastmod
          FROM blogs b LEFT JOIN posts p ON p.blog_id=b.id WHERE b.status='verified' GROUP BY b.id`,
          [since, now],
        );
        await c.commit();
        return {
          version: current?.id ?? null,
          topics: new Map(topics.map((r) => [String(r.entity_id), { posts: Number(r.posts), blogs: Number(r.blogs), lastmod: r.lastmod }])),
          blogs: new Map(blogs.map((r) => [String(r.entity_id), { posts: Number(r.posts), blogs: 1, lastmod: r.lastmod }])),
          sitemapBlogIds: new Set(blogs.filter(legacySitemapBlog).map((r) => String(r.entity_id))),
        };
      } catch (error) {
        await c.rollback();
        throw error;
      } finally {
        c.release();
      }
    });
  }
  /**
   * One blog's page reads only that blog's row: the same counts the projection holds for it (verified blogs only,
   * posts published in the window), without aggregating every topic and blog on each request (5–7 s on production).
   */
  private async blog(entityId: string): Promise<PageIndexability> {
    const now = new Date(),
      since = new Date(now.getTime() - INDEXABILITY_WINDOW_DAYS * 86400_000);
    const [[[current]], [[row]]] = await Promise.all([
      this.pool.query<RowDataPacket[]>(
        "SELECT s.id FROM topic_current c JOIN topic_snapshots s ON s.id=c.snapshot_id WHERE c.source=? AND s.status='published'",
        [SOURCE],
      ),
      this.pool.query<RowDataPacket[]>(
        `SELECT COUNT(p.id) posts FROM blogs b JOIN posts p ON p.blog_id=b.id
         WHERE b.id=? AND b.status='verified' AND p.published_at>=? AND p.published_at<=?`,
        [entityId, since, now],
      ),
    ]);
    return {
      indexable: true,
      indexabilityReason: null,
      windowDays: 90,
      posts: Number(row?.posts ?? 0),
      blogs: 1,
      currentVersion: current?.id ?? null,
    };
  }
  async page(kind: PublicPageKind, entityId: string): Promise<PageIndexability> {
    if (kind === 'blog') return this.blog(entityId);
    const projection = await this.projection();
    const matched = projection.topics.get(entityId);
    if (matched)
      return topicIndexability({ posts: matched.posts, blogs: matched.blogs }, projection.version, {
        exclusionReason: null,
        inactiveReason: null,
      });
    return this.cache.get(`topic:${projection.version}:${entityId}`, async () => {
      const [[term]] = projection.version
        ? await this.pool.query<RowDataPacket[]>(
            'SELECT label,exclusion_reason,inactive_reason FROM topic_canonical_terms_v3 WHERE snapshot_id=? AND id=? AND policy_version=?',
            [projection.version, entityId, POLICY_VERSION],
          )
        : [[]];
      const counts = projection.topics.get(entityId);
      return topicIndexability(
        { posts: counts?.posts ?? 0, blogs: counts?.blogs ?? 0 },
        projection.version,
        term ? { exclusionReason: term.exclusion_reason, inactiveReason: term.inactive_reason, label: term.label } : null,
      );
    });
  }
  async sitemap(kind: PublicPageKind): Promise<IndexablePage[]> {
    return this.cache.get(`sitemap:${kind}`, async () => {
      const projection = await this.projection();
      // Match the deployed sitemap set: >=1 valid article in 90 days, with no 3-post/2-blog gate.
      const rows = kind === 'blog' ? [...projection.blogs].filter(([id]) => projection.sitemapBlogIds.has(id)) : [...projection.topics];
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
async function cumulativeTopics(pool: Pool, ids?: string[]) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `WITH ${historyEvidenceSql(ids ? 'many' : false)}
 SELECT h.canonical_id entity_id,t.label,COUNT(*) posts,COUNT(DISTINCT h.blog_id) blogs,MAX(h.published_at) lastmod
 FROM historical h JOIN topic_pages t ON t.canonical_id=h.canonical_id
 WHERE t.state IN ('active','pending') AND ${historyPublicTopicSql('t')}
 GROUP BY h.canonical_id,t.label`,
    ids ? [ids] : [],
  );
  return rows.filter((row) => !exclusionReason(row.label));
}
export async function getPageIndexability(pool: Pool, kind: PublicPageKind, entityId: string): Promise<PageIndexability> {
  if (kind !== 'topic' || !historyReadsEnabled()) return store(pool).page(kind, entityId);
  const disposition = await topicHistoryDisposition(pool, entityId);
  const [counts] = disposition.status === 'available' ? await cumulativeTopics(pool, [disposition.canonicalId]) : [];
  return {
    indexable: disposition.status === 'available',
    indexabilityReason: disposition.status === 'available' ? null : disposition.status,
    windowDays: null,
    posts: Number(counts?.posts ?? 0),
    blogs: Number(counts?.blogs ?? 0),
    currentVersion: null,
  };
}
export async function getIndexablePages(pool: Pool, kind: PublicPageKind): Promise<IndexablePage[]> {
  if (kind !== 'topic' || !historyReadsEnabled()) return store(pool).sitemap(kind);
  const rows = await cumulativeTopics(pool),
    result: IndexablePage[] = [];
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = rows.slice(offset, offset + 500),
      pages = await getPublicPages(
        pool,
        'topic',
        batch.map((r) => r.entity_id),
      );
    for (const row of batch) {
      const page = pages.get(row.entity_id);
      if (page)
        result.push({
          ...page,
          indexable: true,
          indexabilityReason: null,
          windowDays: null,
          posts: Number(row.posts),
          blogs: Number(row.blogs),
          currentVersion: null,
          lastmod: row.lastmod,
        });
    }
  }
  return result.sort((a, b) => a.entityId.localeCompare(b.entityId, 'en'));
}
/** Bulk metadata enrichment reuses one projection and the bounded per-term cache. */
export async function getPageMetadata(pool: Pool, kind: PublicPageKind, entityIds: string[]) {
  const registry = await getPublicPages(pool, kind, entityIds);
  const result = new Map<string, PublicPage & PageIndexability>();
  if (kind === 'topic' && historyReadsEnabled()) {
    if (!registry.size) return result;
    const counts = await cumulativeTopics(pool, [...registry.keys()]);
    for (const row of counts) {
      const page = registry.get(row.entity_id);
      if (page)
        result.set(row.entity_id, {
          ...page,
          indexable: true,
          indexabilityReason: null,
          windowDays: null,
          posts: Number(row.posts),
          blogs: Number(row.blogs),
          currentVersion: null,
        });
    }
    return result;
  }
  // Sequential reads keep metadata enrichment within the shared DB concurrency budget.
  for (const [id, page] of registry) result.set(id, { ...page, ...(await getPageIndexability(pool, kind, id)) });
  return result;
}
