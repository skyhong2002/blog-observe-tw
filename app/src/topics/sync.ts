import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { reserveBudget } from '../jobs/budget.ts';
import type { BatchOptions } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { topicDeferredReason } from './deferred-reason.ts';
import { carryTopicIndexes } from './index-carry.ts';
import { digest } from './matcher.ts';
import { storedNormalizedLabel } from './policy.ts';
import { writeTopicPolicy } from './policy-store.ts';
import { type ExportManifest, HttpSnapshotSource, type SnapshotSource, SOURCE } from './snapshot-client.ts';
import { importSnapshot } from './snapshot-import.ts';
import { canStartWindowSnapshot, cleanupTopicSnapshots } from './snapshot-retention.ts';
import { cleanupWindowCache, LOOKBACK_MS, startWindowRun, WINDOW_REQUEST_LIMIT, WINDOW_START_LIMIT } from './window-incremental.ts';

export { importSnapshot } from './snapshot-import.ts';

import { TAG_NORMALIZATION } from './tag-normalization.ts';
import { TagArticleSource, TagSourceSchemaError } from './tag-source.ts';
import { TagRateLimitError } from './transport.ts';
import type { ArticleSource, SourceArticle, Window } from './window-contract.ts';

const json = <T>(raw: unknown): T => (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
export type SyncOptions = BatchOptions & {
  enabled?: boolean;
  mode?: 'window' | 'snapshot';
  window?: Window;
  source?: ArticleSource;
  snapshotSource?: SnapshotSource;
  maxPages?: number;
};
export interface LocalManifest {
  id: string;
  source: typeof SOURCE;
  coverage: 'observed-article-window';
  window: Window;
  generatedAt: string;
  sourceWindow?: Window;
  syncStrategy?: string;
  lookbackSeconds?: number;
  parentVersion?: string | null;
  total: number;
  sha256: string;
  upstreamSnapshotConsistent: false;
  invalidTagCount: number;
  normalizedTagCount: number;
  tagNormalization: string;
  attribution: string;
}
/** Publish only after all staged data validates. Existing public pointer is unchanged on every failure. */
async function publish(
  pool: Pool,
  manifest: LocalManifest | ExportManifest,
  terms: { id: string; label: string; payload: unknown }[],
  now: Date,
  assertLease: () => Promise<void>,
) {
  await assertLease();
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[existing]] = await c.query<RowDataPacket[]>('SELECT manifest,status FROM topic_snapshots WHERE id=? FOR UPDATE', [manifest.id]);
    if (existing?.status === 'retiring') throw Error('topic_snapshot_retiring');
    if (existing && JSON.stringify(json(existing.manifest)) !== JSON.stringify(manifest))
      throw Error('snapshot id reused with changed contents');
    await c.execute('INSERT IGNORE INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,?,?)', [
      manifest.id,
      JSON.stringify(manifest),
      'staging',
      new Date(manifest.generatedAt),
    ]);
    for (let offset = 0; offset < terms.length; offset += 100) {
      const batch = terms.slice(offset, offset + 100);
      if (batch.length)
        await c.query(
          'INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload) VALUES ? ON DUPLICATE KEY UPDATE id=VALUES(id)',
          [batch.map((t) => [manifest.id, t.id, t.label, storedNormalizedLabel(t.label), JSON.stringify(t.payload)])],
        );
    }
    await writeTopicPolicy(c, manifest.id, terms);
    const [[count]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_terms WHERE snapshot_id=?', [manifest.id]);
    if (Number(count.n) !== manifest.total) throw Error('staged term count mismatch');
    const [[current]] = await c.query<RowDataPacket[]>(
      'SELECT s.id,s.manifest,s.generated_at FROM topic_current c JOIN topic_snapshots s ON s.id=c.snapshot_id WHERE c.source=? FOR UPDATE',
      [SOURCE],
    );
    const previous = current ? json<LocalManifest | ExportManifest>(current.manifest) : null;
    const newer =
      !previous ||
      (manifest.coverage === 'all-current-indexed-article-tags' && previous.coverage !== 'all-current-indexed-article-tags') ||
      (manifest.coverage === previous.coverage && Date.parse(manifest.generatedAt) > Date.parse(previous.generatedAt));
    await c.execute("UPDATE topic_snapshots SET status='published',synced_at=? WHERE id=?", [now, manifest.id]);
    if (newer) {
      if (current?.id) await carryTopicIndexes(c, current.id, manifest.id);
      await c.execute(
        'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
        [SOURCE, manifest.id],
      );
    }
    await c.execute("UPDATE topic_window_runs SET status='published',updated_at=? WHERE id=?", [now, manifest.id]);
    await assertLease();
    await c.commit();
    return { status: 'published', version: manifest.id, total: terms.length, becameCurrent: newer, coverage: manifest.coverage };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export async function syncVocabulary(pool: Pool, options: SyncOptions = {}) {
  if (!(options.enabled ?? process.env.BLOG_TOPICS_SYNC_ENABLED === 'true')) return { status: 'disabled' };
  const now = options.now?.() ?? new Date();
  const started = Date.now();
  const maxPages = Math.min(50, Math.max(1, options.maxPages ?? 10));
  return (
    (await withJobLease(pool, 'topics', async (assertLease) => {
      const timeout = Math.max(1, Math.min(600_000, options.maxDurationMs ?? 120_000));
      const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]);
      const snapshotCleanup = await cleanupTopicSnapshots(pool, assertLease);
      const beforeRequest = async () => {
        await assertLease();
        if (
          !(await reserveBudget(
            pool,
            [{ scope: 'topics:upstream-requests', amount: 1, limit: WINDOW_REQUEST_LIMIT }],
            options.now?.() ?? new Date(),
          ))
        )
          throw Error('topic_upstream_budget');
      };
      if (options.mode === 'snapshot') {
        return importSnapshot(
          pool,
          options.snapshotSource ?? new HttpSnapshotSource(fetch, signal, { deadline: started + timeout, beforeRequest }),
          now,
          assertLease,
          maxPages,
          {
            signal,
            deadline: started + timeout,
            beforeStart: () => reserveBudget(pool, [{ scope: 'topics:full-sync', amount: 1, limit: 1 }], now),
            beforeRequest: options.snapshotSource ? beforeRequest : undefined,
          },
        );
      }
      const [[failedCooldown]] = await pool.query<RowDataPacket[]>(
        "SELECT id,next_attempt_at FROM topic_window_runs WHERE status='failed-schema' AND next_attempt_at>? ORDER BY next_attempt_at DESC LIMIT 1",
        [now],
      );
      if (failedCooldown?.next_attempt_at)
        return { status: 'deferred', version: failedCooldown.id, nextAttemptAt: failedCooldown.next_attempt_at };
      const [[active]] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM topic_window_runs WHERE status IN ('scanning','ready') ORDER BY created_at LIMIT 1",
      );
      let id: string;
      let window: Window;
      let coverageSince: string;
      let parentVersion: string | null;
      let syncStrategy: string;
      const cleanupAllowed = !options.window && !options.source;
      const cleanupBefore = cleanupAllowed
        ? await cleanupWindowCache(pool, assertLease).catch(() => ({ deleted: 0, backlog: true, error: 'cache-cleanup-deferred' }))
        : { deleted: 0, backlog: false };
      let cursor: string | null;
      let pages: number;
      let status: string;
      if (active?.next_attempt_at && new Date(active.next_attempt_at).getTime() > now.getTime())
        return { status: 'deferred', version: active.id, nextAttemptAt: active.next_attempt_at };
      if (active) {
        id = active.id;
        window = { since: active.since_at, until: active.until_at };
        coverageSince = active.coverage_since ?? active.since_at;
        parentVersion = active.parent_run_id ?? null;
        syncStrategy = active.sync_strategy ?? 'full-window';
        cursor = active.cursor;
        pages = active.pages;
        status = active.status;
      } else {
        const capacity = await canStartWindowSnapshot(pool);
        if (capacity.blocked) return { status: 'retention-blocked', ...capacity, snapshotCleanup };
        if (!(await reserveBudget(pool, [{ scope: 'topics:window-start', amount: 1, limit: WINDOW_START_LIMIT }], now)))
          return { status: 'budget' };
        id = randomUUID();
        const plan = await startWindowRun(pool, id, now, assertLease, options.window, Boolean(options.source));
        window = plan.window;
        coverageSince = plan.coverageSince;
        parentVersion = plan.parentVersion;
        syncStrategy = plan.strategy;
        cursor = null;
        pages = 0;
        status = 'scanning';
      }
      try {
        const source =
          options.source ??
          new TagArticleSource(fetch, 500, signal, {
            deadline: started + timeout,
            beforeRequest,
            onRateLimit: async (retryAt) => {
              await assertLease();
              await pool.execute('UPDATE topic_window_runs SET next_attempt_at=?,updated_at=? WHERE id=?', [
                retryAt,
                options.now?.() ?? new Date(),
                id,
              ]);
            },
          });
        let processed = 0;
        while (
          status === 'scanning' &&
          processed < maxPages &&
          Date.now() - started < (options.maxDurationMs ?? 120_000) &&
          !options.signal?.aborted
        ) {
          if (pages >= 1000) throw Error('vocabulary 1000-page cap');
          if (
            !(await reserveBudget(
              pool,
              [{ scope: 'topics:window-pages', amount: 1, limit: WINDOW_REQUEST_LIMIT }],
              options.now?.() ?? new Date(),
            ))
          ) {
            const nextAttemptAt = new Date((options.now?.() ?? now).getTime() + 15 * 60_000);
            await pool.execute('UPDATE topic_window_runs SET next_attempt_at=?,updated_at=? WHERE id=?', [
              nextAttemptAt,
              options.now?.() ?? now,
              id,
            ]);
            break;
          }
          await assertLease();
          if (options.source) await beforeRequest();
          const page = await source.page(window, cursor);
          const articles = page.articles.map((a) => ({ ...a, publishedAt: new Date(a.publishedAt).toISOString() }));
          await assertLease();
          const c = await pool.getConnection();
          try {
            await c.beginTransaction();
            const [[run]] = await c.query<RowDataPacket[]>('SELECT `cursor`,status FROM topic_window_runs WHERE id=? FOR UPDATE', [id]);
            if (run.cursor !== cursor || run.status !== 'scanning') throw Error('stale vocabulary cursor');
            const [[count]] = await c.query<RowDataPacket[]>(
              'SELECT COUNT(*) n,COALESCE(SUM(OCTET_LENGTH(payload)),0) bytes FROM topic_window_articles WHERE run_id=?',
              [id],
            );
            const [oldRows] = articles.length
              ? await c.query<RowDataPacket[]>(
                  'SELECT article_id,OCTET_LENGTH(payload) bytes FROM topic_window_articles WHERE run_id=? AND article_id IN (?)',
                  [id, articles.map((a) => a.id)],
                )
              : [[]];
            const bytes = articles.reduce((sum, a) => sum + Buffer.byteLength(JSON.stringify(a)), 0);
            if (Number(count.bytes) - oldRows.reduce((sum, row) => sum + Number(row.bytes), 0) + bytes > 32_000_000)
              throw Error('vocabulary staged byte cap');
            if (Number(count.n) - oldRows.length + articles.length > 50_000) throw Error('vocabulary 50000-article cap');
            if (articles.length)
              await c.query(
                'INSERT INTO topic_window_articles(run_id,article_id,payload,published_at) VALUES ? ON DUPLICATE KEY UPDATE payload=VALUES(payload),published_at=VALUES(published_at)',
                [articles.map((a) => [id, a.id, JSON.stringify(a), new Date(a.publishedAt)])],
              );
            status = page.nextCursor ? 'scanning' : 'ready';
            await c.execute('UPDATE topic_window_runs SET `cursor`=?,pages=pages+1,status=?,updated_at=?,next_attempt_at=NULL WHERE id=?', [
              page.nextCursor,
              status,
              now,
              id,
            ]);
            await c.commit();
            cursor = page.nextCursor;
            pages++;
            processed++;
          } catch (e) {
            await c.rollback();
            throw e;
          } finally {
            c.release();
          }
        }
        if (status === 'scanning')
          return {
            status: 'incomplete',
            version: id,
            pages,
            processed,
            window,
            transport: source instanceof TagArticleSource ? source.diagnostics : null,
          };
        const [rows] = await pool.query<RowDataPacket[]>('SELECT payload FROM topic_window_articles WHERE run_id=?', [id]);
        const counts = new Map<string, { articleCount: number; firstPublishedAt: string; lastPublishedAt: string }>();
        let bytes = 0;
        let invalidTagCount = 0;
        let normalizedTagCount = 0;
        for (const row of rows) {
          const a = json<SourceArticle>(row.payload);
          invalidTagCount += a.invalidTagCount ?? 0;
          normalizedTagCount += a.normalizedTagCount ?? 0;
          bytes += Buffer.byteLength(JSON.stringify(a));
          if (bytes > 32_000_000) throw Error('vocabulary staged byte cap');
          for (const label of new Set(a.tags)) {
            const existing = counts.get(label);
            const publishedAt = new Date(a.publishedAt).toISOString();
            counts.set(label, {
              articleCount: (existing?.articleCount ?? 0) + 1,
              firstPublishedAt: existing && existing.firstPublishedAt < publishedAt ? existing.firstPublishedAt : publishedAt,
              lastPublishedAt: existing && existing.lastPublishedAt > publishedAt ? existing.lastPublishedAt : publishedAt,
            });
            if (counts.size > 50_000) throw Error('vocabulary 50000-term cap');
          }
        }
        const terms = [...counts]
          .map(([label, stats]) => ({
            id: digest(label),
            label,
            payload: { label, ...stats, origin: 'article-tags-mixed', journalistAssigned: null },
          }))
          .sort((a, b) => Buffer.compare(Buffer.from(a.label), Buffer.from(b.label)));
        const manifest: LocalManifest = {
          id,
          source: SOURCE,
          coverage: 'observed-article-window',
          invalidTagCount,
          normalizedTagCount,
          tagNormalization: TAG_NORMALIZATION,
          window: { since: coverageSince, until: window.until },
          sourceWindow: window,
          syncStrategy,
          lookbackSeconds: syncStrategy === 'incremental-overlap' ? LOOKBACK_MS / 1000 : 0,
          parentVersion,
          generatedAt: window.until,
          total: terms.length,
          sha256: digest(terms.map((t) => JSON.stringify(t.payload) + '\n').join('')),
          upstreamSnapshotConsistent: false,
          attribution: '新文易數 tag.observe.tw',
        };
        const publication = await publish(pool, manifest, terms, now, assertLease);
        const cleanupAfter = cleanupAllowed
          ? await cleanupWindowCache(pool, assertLease).catch(() => ({ deleted: 0, backlog: true, error: 'cache-cleanup-deferred' }))
          : { deleted: 0, backlog: false };
        return {
          ...publication,
          snapshotCleanup,
          cacheCleanup: { deleted: cleanupBefore.deleted + cleanupAfter.deleted, backlog: cleanupAfter.backlog },
          transport: source instanceof TagArticleSource ? source.diagnostics : null,
        };
      } catch (error) {
        if (error instanceof TagRateLimitError) return { status: 'deferred', version: id, nextAttemptAt: error.retryAt };
        const message = error instanceof Error ? error.message : '';
        if (message === 'topic_snapshot_retiring') {
          await assertLease();
          await pool.execute("UPDATE topic_window_runs SET status='failed-retired',next_attempt_at=NULL,updated_at=? WHERE id=?", [
            now,
            id,
          ]);
          return { status: 'retired', version: id };
        }
        if (
          error instanceof TagSourceSchemaError ||
          /^Tag source (?:invalid JSON|empty response)$/.test(message) ||
          (error as { code?: string })?.code === 'ER_DUP_ENTRY'
        ) {
          await assertLease();
          const nextAttemptAt = new Date((options.now?.() ?? new Date()).getTime() + 3600_000);
          await pool.execute("UPDATE topic_window_runs SET status='failed-schema',next_attempt_at=?,updated_at=? WHERE id=?", [
            nextAttemptAt,
            options.now?.() ?? new Date(),
            id,
          ]);
          return { status: 'failed-schema', version: id, nextAttemptAt };
        }
        if (message === 'topic_upstream_budget') {
          const nextAttemptAt = new Date(now.getTime() + 15 * 60_000);
          await pool.execute('UPDATE topic_window_runs SET next_attempt_at=?,updated_at=? WHERE id=?', [nextAttemptAt, now, id]);
          return { status: 'budget', version: id, nextAttemptAt };
        }
        const reason = message.includes('page cap')
          ? 'cap-pages'
          : message.includes('article cap')
            ? 'cap-articles'
            : message.includes('byte cap')
              ? 'cap-bytes'
              : message.includes('term cap')
                ? 'cap-terms'
                : message.includes('trie cap')
                  ? 'cap-trie'
                  : null;
        if (!reason) {
          if (options.source) throw error;
          const nextAttemptAt = new Date(now.getTime() + 15 * 60_000);
          await pool.execute('UPDATE topic_window_runs SET next_attempt_at=?,updated_at=? WHERE id=?', [nextAttemptAt, now, id]);
          return { status: 'deferred', version: id, nextAttemptAt, deferredReason: topicDeferredReason(error) };
        }
        await assertLease();
        await pool.execute('UPDATE topic_window_runs SET status=?,updated_at=? WHERE id=?', [reason, options.now?.() ?? new Date(), id]);
        return { status: 'capped', reason, version: id, pages, window };
      }
    })) ?? { status: 'busy' }
  );
}
