import type { Pool, RowDataPacket } from 'mysql2/promise';
import { withJobLease } from '../jobs/lease.ts';
import { budgetedCandidateFetcher } from './candidate-review.ts';
import { crawlBlog, type FeedCrawlerOptions } from './feed.ts';

/** Qualification never waits on network. This bounded queue handles the content separately and records real failures. */
export async function runCuratedContentBatch(pool: Pool, options: FeedCrawlerOptions & { limit?: number; maxDurationMs?: number } = {}) {
  return (
    (await withJobLease(pool, 'curated-content', async (assertLease) => {
      const limit = Math.max(1, Math.min(100, options.limit ?? 10));
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT MIN(d.id) candidateId,b.id,b.slug,b.url
      FROM discovery_candidates d JOIN blogs b ON b.id=JSON_EXTRACT(d.source_evidence,'$.automaticReview.blogId')
      WHERE d.status='approved' AND b.status='verified' AND JSON_EXTRACT(d.source_evidence,'$.curatedListings') IS NOT NULL
        AND (COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.source_evidence,'$.curatedContent.status')),'')<>'ready')
        AND (JSON_EXTRACT(d.source_evidence,'$.curatedContent.lastAttemptAt') IS NULL OR
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(d.source_evidence,'$.curatedContent.lastAttemptAt')),'')<DATE_FORMAT(UTC_TIMESTAMP()-INTERVAL 1 DAY,'%Y-%m-%dT%H:%i:%s'))
      GROUP BY b.id,b.slug,b.url ORDER BY EXISTS(SELECT 1 FROM posts p WHERE p.blog_id=b.id),b.id LIMIT ?`,
        [limit],
      );
      const deadline = Date.now() + (options.maxDurationMs ?? 120000),
        results = [];
      let stopped = false;
      const fetcher = budgetedCandidateFetcher(
        pool,
        options,
        assertLease,
        deadline,
        () => {
          stopped = true;
        },
        () => {},
        { scope: 'curated:content-http', limit: 1500 },
      );
      for (const row of rows) {
        if (stopped || Date.now() >= deadline) break;
        await assertLease();
        let error: string | null = null;
        let siteFailure: string | null = null;
        const siteDeadline = Date.now() + 45000;
        let requests = 0;
        const siteFetcher: NonNullable<FeedCrawlerOptions['fetcher']> = async (input, init) => {
          if (Date.now() >= siteDeadline || requests++ >= 24) {
            siteFailure = 'site_attempt_budget_exhausted';
            throw Error(siteFailure);
          }
          const response = await fetcher(input, init);
          if ([403, 429].includes(response.status)) siteFailure = `http_${response.status}`;
          return response;
        };
        const [[before]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM posts WHERE blog_id=?', [row.id]);
        if (!Number(before.n)) {
          try {
            const crawled = await crawlBlog(
              { pool },
              { id: Number(row.id), slug: String(row.slug), url: String(row.url) },
              { ...options, fetcher: siteFetcher },
            );
            if (!crawled.sources) error = 'no_usable_source';
          } catch (e) {
            const m = e instanceof Error ? e.message : '';
            error = m.match(/HTTP[ _]?(\d{3})/i)?.[1] || (/robots/i.test(m) ? 'robots_unreachable' : 'homepage_or_source_fetch_failed');
          }
        }
        if (stopped) break;
        const [[count]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM posts WHERE blog_id=?', [row.id]);
        const posts = Number(count.n),
          status = posts ? 'ready' : 'failed';
        const content = {
          status,
          posts,
          reason: posts ? null : siteFailure || error || 'no_articles_found',
          lastAttemptAt: new Date().toISOString(),
        };
        await pool.execute(
          `UPDATE discovery_candidates SET source_evidence=JSON_SET(source_evidence,'$.curatedContent',JSON_EXTRACT(?,'$'))
        WHERE status='approved' AND JSON_EXTRACT(source_evidence,'$.automaticReview.blogId')=? AND JSON_EXTRACT(source_evidence,'$.curatedListings') IS NOT NULL`,
          [JSON.stringify(content), row.id],
        );
        results.push({ blogId: Number(row.id), url: String(row.url), ...content });
      }
      return { selected: rows.length, processed: results.length, results };
    })) ?? { selected: 0, processed: 0, results: [], skipped: 'busy' }
  );
}
