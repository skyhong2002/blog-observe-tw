import type { Pool, RowDataPacket } from 'mysql2/promise';
import { politeFetch } from '../crawl/feed.ts';
import { reserveBudget } from '../jobs/budget.ts';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { budgetedRelationFetcher, relationBudgetAvailable, relationFailureCode } from '../relations/worker.ts';
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
/** Shared relations lease + actual HTTP scopes: the body worker and legacy article fetch can never race. */
export async function runContentBatch(pool: Pool, options: BatchOptions & { blogId?: number } = {}): Promise<BatchResult> {
  if (options.blogId !== undefined && (!Number.isSafeInteger(options.blogId) || options.blogId < 1)) throw Error('invalid blog id');
  const empty = { processed: 0, skipped: 0, truncated: false, reservedUnused: 0 };
  return (
    (await withJobLease(pool, 'relations', async (assertLease) => {
      const result = { ...empty },
        now = () => options.now?.() ?? new Date(),
        deadline = Date.now() + Math.max(1000, Math.min(120000, options.maxDurationMs ?? 120000));
      await initializeContentRules(pool, now());
      await pool.execute('DELETE FROM content_attempts WHERE observed_at<? LIMIT 1000', [new Date(now().getTime() - 30 * 86400000)]);
      const [posts] = await pool.query<RowDataPacket[]>(
        `SELECT p.id,p.blog_id,p.url,b.url blog_url,c.etag,c.last_modified,c.status,c.content_hash,c.source_kind,c.source_url
   FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN content_post_bodies c ON c.post_id=p.id
   WHERE b.status='verified' AND (? IS NULL OR p.blog_id=?) AND b.url IS NOT NULL AND (c.post_id IS NULL OR c.next_attempt_at<=? OR c.adapter_version<>?)
   ORDER BY COALESCE(c.next_attempt_at,'1970-01-01'),p.published_at DESC,p.id DESC LIMIT 50`,
        [options.blogId ?? null, options.blogId ?? null, now(), CONTENT_VERSION],
      );
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
        if (!(await reserveBudget(pool, [{ scope: 'relations:pages', amount: 1, limit: 300 }], now()))) {
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
            let status: string;
            try {
              await c.beginTransaction();
              const written = await ingestContentEvidence(c, evidence, now());
              status = written.status;
              await c.commit();
            } catch (e) {
              await c.rollback();
              throw e;
            } finally {
              c.release();
            }
            if (status === 'ok') {
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
      return result;
    })) ?? { ...empty, skipped: 1 }
  );
}
