import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { fetch as undiciFetch } from 'undici';
import { type FeedFetcher, politeFetch } from '../crawl/feed.ts';
import { reserveBudget } from '../jobs/budget.ts';
import type { BatchOptions, BatchResult } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { PARSER_VERSION, parseArticleLinks } from './parser.ts';
import { invalidateRelationCache } from './routes.ts';
import {
  type ArticleRow,
  deferObservation,
  discoverCandidates,
  loadAliases,
  reconcileTargets,
  retainFailedObservation,
  saveObservation,
} from './store.ts';

type BudgetedFetcher = FeedFetcher & { lastFailure: 'budget-exhausted' | 'batch-stopped' | null };

/** All actual HTTP including robots and each redirect consumes a host/global reservation. */
export function budgetedRelationFetcher(
  pool: Pool,
  options: BatchOptions,
  assertLease: () => Promise<void>,
  deadline: number,
): BudgetedFetcher {
  const fetcher = options.fetcher ?? (undiciFetch as FeedFetcher);
  const wrapped: BudgetedFetcher = Object.assign(
    async (input: Parameters<FeedFetcher>[0], init?: Parameters<FeedFetcher>[1]) => {
      if (options.signal?.aborted || Date.now() >= deadline) {
        wrapped.lastFailure = 'batch-stopped';
        throw Error('relation_batch_stopped');
      }
      await assertLease();
      const origin = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).origin;
      const scope = `relations:host:${createHash('sha256').update(origin).digest('hex')}`;
      const allowed = await reserveBudget(
        pool,
        [
          { scope: 'relations:http', amount: 1, limit: 900 },
          { scope, amount: 1, limit: 20 },
        ],
        options.now?.() ?? new Date(),
      );
      if (!allowed) {
        wrapped.lastFailure = 'budget-exhausted';
        throw Error('relation_http_budget');
      }
      const signals = [init?.signal, options.signal].filter((s): s is AbortSignal => !!s);
      return fetcher(input, { ...init, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) });
    },
    { lastFailure: null as BudgetedFetcher['lastFailure'] },
  );
  return wrapped;
}

/** Read-only preflight prevents spending a page reservation on an already exhausted origin.
 * The actual HTTP fetch still atomically reserves both counters, including redirects. */
export async function relationBudgetAvailable(pool: Pool, url: string, now = new Date()): Promise<boolean> {
  const scope = `relations:host:${createHash('sha256').update(new URL(url).origin).digest('hex')}`;
  const [rows] = await pool.query<RowDataPacket[]>('SELECT scope,used FROM work_budgets WHERE day=? AND scope IN (?)', [
    now.toISOString().slice(0, 10),
    ['relations:http', scope],
  ]);
  return rows.every((r) => Number(r.used) < (r.scope === 'relations:http' ? 900 : 20));
}

export function relationFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/relation_http_budget/.test(message)) return 'budget-exhausted';
  if (/relation_batch_stopped/.test(message)) return 'batch-stopped';
  if (/robots disallow/.test(message)) return 'robots-denied-or-unavailable';
  if (/unsafe crawl/.test(message)) return 'unsafe-target';
  if (/response exceeds/.test(message)) return 'response-too-large';
  if (/^http_\d+$/.test(message)) return message.replace('_', '-');
  return 'fetch-or-parse-failed';
}

/** Called only by the explicitly enabled worker scheduler. One lease, bounded pages and durable UTC budgets. */
export async function runRelationBatch(pool: Pool, options: BatchOptions = {}): Promise<BatchResult> {
  const empty: BatchResult = { processed: 0, skipped: 0, truncated: false, reservedUnused: 0 };
  return (
    (await withJobLease(pool, 'relations', async (assertLease) => {
      const result = { ...empty };
      const now = () => options.now?.() ?? new Date();
      const deadline = Date.now() + Math.max(1000, Math.min(120000, options.maxDurationMs ?? 120000));
      const limit = Math.max(1, Math.min(5, Math.trunc(options.limit ?? 5)));
      const aliases = await loadAliases(pool);
      const resolved = await reconcileTargets(pool, aliases, now());
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT p.id,p.blog_id,p.url,p.published_at,b.url blog_url,COALESCE(rp.depth,0) depth,o.etag,o.last_modified,o.status,o.parser_version
      FROM posts p JOIN blogs b ON b.id=p.blog_id LEFT JOIN relation_observations o ON o.post_id=p.id
      LEFT JOIN relation_publications rp ON rp.blog_id=b.id
      WHERE b.status='verified' AND (o.post_id IS NULL OR o.next_attempt_at<=? OR (o.parser_version<>? AND o.status IN ('ok','no-body') AND o.error_code IS NULL))
      ORDER BY COALESCE(o.next_attempt_at,'1970-01-01'),p.published_at DESC,p.id DESC LIMIT ?`,
        [now(), PARSER_VERSION, 50],
      );
      const fetcher = budgetedRelationFetcher(pool, options, assertLease, deadline);
      let attempts = 0;
      for (const raw of rows) {
        if (attempts >= limit) break;
        if (options.signal?.aborted || Date.now() >= deadline) {
          result.truncated = true;
          break;
        }
        await assertLease();
        const post = raw as ArticleRow;
        if (!(await relationBudgetAvailable(pool, post.url, now()))) {
          await deferObservation(pool, post, now());
          result.skipped++;
          continue;
        }
        if (!(await reserveBudget(pool, [{ scope: 'relations:pages', amount: 1, limit: 300 }], now()))) {
          result.truncated = true;
          break;
        }
        attempts++;
        if (options.signal?.aborted) {
          result.reservedUnused++;
          break;
        }
        try {
          fetcher.lastFailure = null;
          const headers: Record<string, string> = { accept: 'text/html,application/xhtml+xml;q=0.9' };
          if (post.parser_version === PARSER_VERSION && post.etag) headers['if-none-match'] = post.etag;
          if (post.parser_version === PARSER_VERSION && post.last_modified) headers['if-modified-since'] = post.last_modified;
          const response = await politeFetch(post.url, headers, {
            ...options,
            timeoutMs: Math.min(options.timeoutMs ?? 15000, 20000),
            fetcher,
          });
          if (response.status === 304 && post.status && post.parser_version === PARSER_VERSION && (post.etag || post.last_modified)) {
            await pool.query(
              `UPDATE relation_observations SET status=IF(body_text IS NULL,'no-body','ok'),observed_at=?,last_success_at=?,next_attempt_at=?,error_code=NULL WHERE post_id=?`,
              [now(), now(), new Date(now().getTime() + 30 * 86400000), post.id],
            );
          } else {
            if (!response.ok) throw Error(`http_${response.status}`);
            if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw Error('non-html');
            const parsed = parseArticleLinks(await response.text(), response.url || post.url, post.blog_id, aliases);
            await assertLease();
            await saveObservation(pool, post, parsed, response, now());
            await discoverCandidates(pool, post, parsed, now());
            if (parsed.truncated) result.truncated = true;
          }
          result.processed++;
        } catch (error) {
          await assertLease();
          const reason = fetcher.lastFailure || relationFailureCode(error);
          if (/budget|batch-stopped/.test(reason)) await deferObservation(pool, post, now(), reason);
          else await retainFailedObservation(pool, post, reason, now(), 7);
          result.skipped++;
        }
      }
      if (result.processed || resolved) await invalidateRelationCache(pool);
      return result;
    })) ?? { ...empty, skipped: 1 }
  );
}
