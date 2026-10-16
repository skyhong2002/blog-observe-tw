import type { Pool, RowDataPacket } from 'mysql2/promise';
import { politeFetch } from '../crawl/feed.ts';
import { reserveBudget } from '../jobs/budget.ts';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { budgetedRelationFetcher, RELATION_PAGES_DAILY, relationBudgetAvailable, relationFailureCode } from '../relations/worker.ts';
import { type AdoptionEnqueue, createSearchIndexAdoption } from '../search-index-adoption.ts';
import { createTechObserver } from '../tech/observer.ts';
import { inPublication, wordpressEvidence } from './article-content.ts';
import { CONTENT_VERSION, type ContentEvidence, type ContentRule } from './contracts.ts';
import { contentRequestPlan } from './registry.ts';
import { ingestContentEvidence, initializeContentRules, loadContentRule, recordContentAttempt } from './store.ts';

async function noteFailure(pool: Pool, post: RowDataPacket, rule: ContentRule, reason: string, now: Date) {
  const deferred = /budget|batch-stopped/.test(reason),
    status = deferred ? 'deferred' : 'failed';
  const next = new Date(now.getTime() + (deferred ? 1 : 7) * 86400000);
  if (deferred) next.setUTCHours(0, 0, 0, 0);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[blog]] = await c.query<RowDataPacket[]>('SELECT url,status FROM blogs WHERE id=? FOR UPDATE', [post.blog_id]);
    const [[current]] = await c.query<RowDataPacket[]>('SELECT url,blog_id FROM posts WHERE id=? FOR UPDATE', [post.id]);
    if (
      blog?.status !== 'verified' ||
      blog.url !== post.blog_url ||
      !current ||
      current.blog_id !== post.blog_id ||
      current.url !== post.url
    ) {
      await c.rollback();
      return;
    }

    await c.execute(
      `INSERT INTO content_post_bodies(post_id,blog_id,revision,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,next_attempt_at,last_attempt_at,last_error,coverage)
  VALUES(?,?,1,'unknown',?,'article-html',?,?,?,?,?,?,?,?,?,'html-page') ON DUPLICATE KEY UPDATE next_attempt_at=VALUES(next_attempt_at),last_attempt_at=VALUES(last_attempt_at),last_error=VALUES(last_error),status=IF(status IN ('ok','partial'),status,VALUES(status))`,
      [post.id, post.blog_id, status, post.url, post.url, rule.adapterId, CONTENT_VERSION, rule.revision, now, next, now, reason],
    );
    await c.execute('UPDATE content_blog_rules SET last_status=?,last_error=?,last_attempt_at=?,updated_at=? WHERE blog_id=?', [
      status,
      reason,
      now,
      now,
      post.blog_id,
    ]);
    await recordContentAttempt(
      c,
      { postId: post.id, blogId: post.blog_id, sourceKind: 'article-html', sourceUrl: post.url, adapterId: rule.adapterId, status, reason },
      now,
    );
    await c.commit();
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
const UPGRADE = "c.adapter_version<>? AND c.source_kind='article-html' AND c.status<>'ok'";
/** The scheduler order over posts without a body, due bodies and older-adapter page failures, without reading
 * every stored body: each branch reads one index. No branch limit can drop a row from the first `limit`: posts
 * without a body share one sort key, and every row that can sort first (content-limit upgrades) is in the
 * unlimited upgrade branch. */
export async function selectContentCandidates(pool: Pool, blogId: number | null, now: Date, limit: number) {
  const scope = "b.status='verified' AND (? IS NULL OR p.blog_id=?) AND b.url IS NOT NULL";
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.id,p.blog_id,p.url,b.url blog_url,c.etag,c.last_modified,c.status,c.content_hash,c.source_kind,c.source_url FROM (
      (SELECT p.id FROM posts p JOIN blogs b ON b.id=p.blog_id WHERE ${scope}
        AND NOT EXISTS (SELECT 1 FROM content_post_bodies c FORCE INDEX (content_bodies_schedule) WHERE c.post_id=p.id)
        ORDER BY p.published_at DESC,p.id DESC LIMIT ?)
      UNION (SELECT p.id FROM content_post_bodies c FORCE INDEX (content_bodies_due) JOIN posts p ON p.id=c.post_id JOIN blogs b ON b.id=p.blog_id
        WHERE c.next_attempt_at<=? AND ${scope} ORDER BY c.next_attempt_at,p.published_at DESC,p.id DESC LIMIT ?)
      UNION (SELECT p.id FROM content_post_bodies c FORCE INDEX (content_bodies_schedule) JOIN posts p ON p.id=c.post_id JOIN blogs b ON b.id=p.blog_id
        WHERE ${UPGRADE} AND ${scope})
    ) pick JOIN posts p ON p.id=pick.id JOIN blogs b ON b.id=p.blog_id LEFT JOIN content_post_bodies c ON c.post_id=p.id
    ORDER BY CASE WHEN ${UPGRADE} AND c.last_error='content-limit' THEN 0 ELSE 1 END,COALESCE(c.next_attempt_at,'1970-01-01'),p.published_at DESC,p.id DESC LIMIT ?`,
    [blogId, blogId, limit, now, blogId, blogId, limit, CONTENT_VERSION, blogId, blogId, CONTENT_VERSION, limit],
  );
  return rows;
}
/** Shared relations lease + actual HTTP scopes: the body worker and legacy article fetch can never race. */
export async function runContentBatch(
  pool: Pool,
  options: BatchOptions & { blogId?: number; indexAdoptionEnabled?: boolean; enqueueIndex?: AdoptionEnqueue } = {},
): Promise<BatchResult & { indexAdoption?: ReturnType<ReturnType<typeof createSearchIndexAdoption>['snapshot']> }> {
  if (options.blogId !== undefined && (!Number.isSafeInteger(options.blogId) || options.blogId < 1)) throw Error('invalid blog id');
  const empty = { processed: 0, skipped: 0, truncated: false, reservedUnused: 0 };
  return (
    (await withJobLease(pool, 'relations', async (assertLease) => {
      const adoption = createSearchIndexAdoption({ enabled: options.indexAdoptionEnabled, enqueue: options.enqueueIndex });
      const result = { ...empty },
        now = () => options.now?.() ?? new Date(),
        deadline = Date.now() + Math.max(1000, Math.min(120000, options.maxDurationMs ?? 120000));
      await initializeContentRules(pool, now());
      await pool.execute('DELETE FROM content_attempts WHERE observed_at<? LIMIT 1000', [new Date(now().getTime() - 30 * 86400000)]);
      const posts = await selectContentCandidates(pool, options.blogId ?? null, now(), 50);
      const fetcher = budgetedRelationFetcher(pool, options, assertLease, deadline);
      let attempts = 0;
      for (const post of posts) {
        if (attempts >= Math.max(1, Math.min(5, options.limit ?? 5))) break;
        if (options.signal?.aborted || Date.now() >= deadline) {
          result.truncated = true;
          break;
        }
        await assertLease();
        const rule = await loadContentRule(pool, post.blog_id, post.blog_url);
        if (!inPublication(post.url, post.blog_url)) {
          await noteFailure(
            pool,
            post,
            rule,
            ['matters.town', 'matters.news', 'vocus.cc'].includes(new URL(post.url).hostname)
              ? 'unsupported-owner-proof'
              : 'outside-publication',
            now(),
          );
          result.skipped++;
          continue;
        }
        if (!(await relationBudgetAvailable(pool, post.url, now()))) {
          await noteFailure(pool, post, rule, 'budget-deferred', now());
          result.skipped++;
          continue;
        }
        if (!(await reserveBudget(pool, [{ scope: 'relations:pages', amount: 1, limit: RELATION_PAGES_DAILY }], now()))) {
          result.truncated = true;
          break;
        }
        attempts++;
        let complete = false;
        for (const request of contentRequestPlan(post.url, rule)) {
          if (options.signal?.aborted || Date.now() >= deadline) {
            result.truncated = true;
            break;
          }
          try {
            fetcher.lastFailure = null;
            const headers: Record<string, string> = {
              accept: request.method === 'wordpress-api' ? 'application/json' : 'text/html,application/xhtml+xml;q=0.9',
            };
            // Validators are scoped to the exact representation, not reused from an RSS or other API response.
            if (post.status === 'ok' && post.source_url === request.url && post.source_kind === request.method) {
              if (post.etag) headers['if-none-match'] = post.etag;
              if (post.last_modified) headers['if-modified-since'] = post.last_modified;
            }
            const response = await politeFetch(request.url, headers, {
              ...options,
              fetcher,
              timeoutMs: Math.min(options.timeoutMs ?? 15000, 20000),
              observer:
                request.method === 'article-html'
                  ? createTechObserver(pool, { blogId: post.blog_id, blogUrl: post.blog_url, sourcePostId: post.id })
                  : undefined,
            });
            const final = response.url || request.url;
            if (request.method === 'article-html' && !inPublication(final, post.blog_url)) throw Error('content_identity_mismatch');
            if (request.method === 'wordpress-api' && new URL(final).origin !== new URL(post.url).origin)
              throw Error('content_identity_mismatch');
            if (response.status === 304 && post.status === 'ok' && (headers['if-none-match'] || headers['if-modified-since'])) {
              await pool.execute('UPDATE content_post_bodies SET next_attempt_at=?,last_attempt_at=?,last_error=NULL WHERE post_id=?', [
                new Date(now().getTime() + 30 * 86400000),
                now(),
                post.id,
              ]);
              complete = true;
              break;
            }
            if (!response.ok) throw Error(`http_${response.status}`);
            const mime = response.headers.get('content-type') || '';
            if (request.method === 'article-html' && !/text\/html|application\/xhtml/i.test(mime)) throw Error('content_type_mismatch');
            if (request.method === 'wordpress-api' && !/(?:application|text)\/.*json/i.test(mime)) throw Error('content_type_mismatch');
            const raw = await response.text();
            const base = {
              postId: post.id,
              blogId: post.blog_id,
              blogUrl: post.blog_url,
              articleUrl: post.url,
              sourceUrl: final,
              obtainedAt: now(),
              etag: response.headers.get('etag'),
              lastModified: response.headers.get('last-modified'),
            };
            const evidence: ContentEvidence | null =
              request.method === 'wordpress-api' ? wordpressEvidence(raw, base) : { ...base, html: raw, kind: 'article-html' };
            if (!evidence) throw Error('content_api_no_matching_post');
            await assertLease();
            const c = await pool.getConnection();
            let written: Awaited<ReturnType<typeof ingestContentEvidence>>;
            try {
              await c.beginTransaction();
              written = await ingestContentEvidence(c, evidence, now());
              await c.commit();
            } catch (e) {
              await c.rollback();
              throw e;
            } finally {
              c.release();
            }
            // Only after successful COMMIT and connection release. No queue operation inside the body failure catch.
            if (written.postId === post.id)
              adoption.recordCommitted({
                commitState: 'committed',
                status: written.status,
                changed: written.changed,
                publicationStatus: 'verified',
                postId: post.id,
                blogId: post.blog_id,
                postOwnerBlogId: post.blog_id,
                bodyOwnerBlogId: evidence.blogId,
              });
            if (written.status === 'ok') {
              complete = true;
              break;
            }
            if (request.method === 'article-html') break;
          } catch (error) {
            await assertLease();
            const message = error instanceof Error ? error.message : '';
            const reason =
              fetcher.lastFailure ||
              (/^(?:content_identity_mismatch|content_type_mismatch|content_api_no_matching_post)$/.test(message)
                ? message
                : relationFailureCode(error));
            await noteFailure(pool, post, rule, reason, now());
            if (/budget|batch-stopped|robots|unsafe|http-(?:401|403|429)/.test(reason)) break;
          }
        }
        if (complete) result.processed++;
        else result.skipped++;
      }
      // Adoption catches queue errors locally; already committed bodies must never become noteFailure.
      return options.indexAdoptionEnabled === true ? { ...result, indexAdoption: await adoption.flush() } : result;
    })) ?? { ...empty, skipped: 1 }
  );
}
