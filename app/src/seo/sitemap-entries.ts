import type { Pool, RowDataPacket } from 'mysql2/promise';
import { historyReadsEnabled } from '../topics/history-contracts.ts';
import { historyPublicEvidenceSql, historyPublicTopicSql } from '../topics/history-read.ts';
import { exclusionReason } from '../topics/policy.ts';
import { getIndexablePages, legacySitemapBlog, validPostDate } from './indexability.ts';
import { isPublicRouteKey, publicPage } from './page-routes.ts';

/**
 * Sitemap-only reads: the same URL set as getIndexablePages (public/verified, history, noise, revoked and merged rules),
 * but only id, canonical path and lastmod, read in bounded SQL chunks. Nothing is kept between requests, so a
 * revocation or blog rejection drops the URL from the next response.
 */
export type SitemapEntry = { entityId: string; canonicalPath: string; lastmod: unknown };
/** Topic ID range: `from` inclusive, `to` exclusive, both hex prefixes; null is open. */
export type TopicRange = { from: string | null; to: string | null };

const CHUNK = 1_000;
const byEntity = (a: SitemapEntry, b: SitemapEntry) => a.entityId.localeCompare(b.entityId, 'en');
export const inTopicRange = (id: string, range: TopicRange) =>
  (range.from === null || id >= range.from) && (range.to === null || id < range.to);
const topicCandidates = `FROM public_page_routes r JOIN topic_pages t ON t.canonical_id=r.entity_id
 WHERE r.kind='topic' AND t.state IN ('active','pending') AND ${historyPublicTopicSql('t')}`;
const listedTopic = (row: RowDataPacket) => isPublicRouteKey('topic', row.canonical_key) && !exclusionReason(row.label);

/** Verified blogs with a readable route; lastmod is the newest valid post date, else discovery. Reads no topic data. */
export async function sitemapBlogs(pool: Pool): Promise<SitemapEntry[]> {
  const entries: SitemapEntry[] = [];
  for (let after = ''; ; ) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.entity_id,r.canonical_key,b.slug,b.url,b.status,CASE WHEN b.discovered_at<=UTC_TIMESTAMP() THEN b.discovered_at END discovered_at
       FROM public_page_routes r JOIN blogs b ON b.id=r.entity_id
       WHERE r.kind='blog' AND r.entity_id>? AND b.status='verified' ORDER BY r.entity_id LIMIT ?`,
      [after, CHUNK],
    );
    const listed = rows.filter((row) => legacySitemapBlog(row) && isPublicRouteKey('blog', row.canonical_key));
    if (listed.length) {
      const [dates] = await pool.query<RowDataPacket[]>(
        `SELECT p.blog_id,MAX(${validPostDate}) lastmod FROM posts p WHERE p.blog_id IN (?) GROUP BY p.blog_id`,
        [listed.map((row) => row.entity_id)],
      );
      const newest = new Map(dates.map((row) => [String(row.blog_id), row.lastmod]));
      for (const row of listed)
        entries.push({
          entityId: String(row.entity_id),
          canonicalPath: publicPage('blog', row).canonicalPath,
          lastmod: newest.get(String(row.entity_id)) ?? row.discovered_at,
        });
    }
    if (rows.length < CHUNK) break;
    after = String(rows.at(-1)!.entity_id);
  }
  return entries.sort(byEntity);
}

/** Readable topic routes: an upper bound of the topic sitemap that only decides how many files to split into. */
export async function sitemapTopicRoutes(pool: Pool): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) n FROM public_page_routes WHERE kind='topic'");
  return Number(row?.n ?? 0);
}

/** Listed topics in one ID range, each with at least one public history article; lastmod is its newest one. */
export async function sitemapTopics(pool: Pool, range: TopicRange): Promise<SitemapEntry[]> {
  if (!historyReadsEnabled())
    return (await getIndexablePages(pool, 'topic'))
      .filter((page) => inTopicRange(page.entityId, range))
      .map(({ entityId, canonicalPath, lastmod }) => ({ entityId, canonicalPath, lastmod }));
  const entries: SitemapEntry[] = [];
  // A 64-hex ID is always greater than its own 8-hex prefix, so `>` on the prefix keeps `from` inclusive. The same
  // bounds on t.canonical_id (lowercase hex sorts alike in both collations) let its primary key drive the read.
  for (let after = range.from ?? ''; ; ) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT r.entity_id,r.canonical_key,t.label ${topicCandidates} AND r.entity_id>? AND t.canonical_id>?
       ${range.to === null ? '' : 'AND r.entity_id<? AND t.canonical_id<?'} ORDER BY t.canonical_id LIMIT ?`,
      range.to === null ? [after, after, CHUNK] : [after, after, range.to, range.to, CHUNK],
    );
    const listed = rows.filter(listedTopic);
    if (listed.length) {
      const [dates] = await pool.query<RowDataPacket[]>(
        `SELECT e.canonical_id,MAX(p.published_at) lastmod FROM topic_article_evidence e JOIN posts p ON p.id=e.post_id JOIN blogs b ON b.id=p.blog_id
         WHERE e.canonical_id IN (?) AND ${historyPublicEvidenceSql} GROUP BY e.canonical_id`,
        [listed.map((row) => row.entity_id)],
      );
      const newest = new Map(dates.map((row) => [String(row.canonical_id), row.lastmod]));
      for (const row of listed)
        if (newest.has(String(row.entity_id)))
          entries.push({
            entityId: String(row.entity_id),
            canonicalPath: publicPage('topic', row).canonicalPath,
            lastmod: newest.get(String(row.entity_id)),
          });
    }
    if (rows.length < CHUNK) break;
    after = String(rows.at(-1)!.entity_id);
  }
  return entries.sort(byEntity);
}

/**
 * Newest lastmod over all listed topics, without aggregating every topic: walk public posts newest first and stop at
 * the first one that is public evidence for a listed topic. Null when none is found within the bounded walk.
 */
export async function sitemapTopicsLastmod(pool: Pool, batches = 40): Promise<unknown> {
  if (!historyReadsEnabled())
    return (
      (await getIndexablePages(pool, 'topic'))
        .map((page) => page.lastmod)
        .filter((date) => date instanceof Date && date.getTime() <= Date.now())
        .sort((a, b) => (a as Date).getTime() - (b as Date).getTime())
        .at(-1) ?? null
    );
  let before: RowDataPacket | null = null;
  for (let batch = 0; batch < batches; batch++) {
    const [posts]: [RowDataPacket[], unknown] = await pool.query<RowDataPacket[]>(
      `SELECT p.id,p.published_at FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE b.status='verified' AND p.published_at<=UTC_TIMESTAMP()
       ${before ? 'AND (p.published_at<? OR (p.published_at=? AND p.id<?))' : ''} ORDER BY p.published_at DESC,p.id DESC LIMIT 5`,
      before ? [before.published_at, before.published_at, before.id] : [],
    );
    if (!posts.length) return null;
    const [evidence] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT e.post_id,e.canonical_id FROM topic_article_evidence e JOIN posts p ON p.id=e.post_id JOIN blogs b ON b.id=p.blog_id
       WHERE e.post_id IN (?) AND ${historyPublicEvidenceSql}`,
      [posts.map((post) => post.id)],
    );
    const ids = [...new Set(evidence.map((row) => String(row.canonical_id)))],
      listed = new Set<string>();
    for (let offset = 0; offset < ids.length; offset += CHUNK) {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT r.entity_id,r.canonical_key,t.label ${topicCandidates} AND r.entity_id IN (?)`,
        [ids.slice(offset, offset + CHUNK)],
      );
      for (const row of rows) if (listedTopic(row)) listed.add(String(row.entity_id));
    }
    const hit = posts.find((post) => evidence.some((row) => row.post_id === post.id && listed.has(String(row.canonical_id))));
    if (hit) return hit.published_at;
    before = posts.at(-1)!;
  }
  return null;
}
