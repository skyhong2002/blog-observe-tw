import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { reserveBudget } from '../jobs/budget.ts';
import type { BatchOptions } from '../jobs/contracts.ts';
import { withJobLease } from '../jobs/lease.ts';
import { digest, normalizeTerm, TopicMatcher } from './matcher.ts';
import { type ExportManifest, HttpSnapshotSource, type SnapshotSource, SOURCE, validateManifest, validatePage } from './snapshot-client.ts';
import { TagArticleSource } from './tag-source.ts';
import { TagRateLimitError } from './transport.ts';
import { type ArticleSource, type SourceArticle, validateWindow, type Window } from './window-contract.ts';

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
  total: number;
  sha256: string;
  upstreamSnapshotConsistent: false;
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
  new TopicMatcher(terms); // Reject oversized matching state before publication.
  await assertLease();
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[existing]] = await c.query<RowDataPacket[]>('SELECT manifest,status FROM topic_snapshots WHERE id=? FOR UPDATE', [manifest.id]);
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
          [batch.map((t) => [manifest.id, t.id, t.label, normalizeTerm(t.label), JSON.stringify(t.payload)])],
        );
    }
    const [[count]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_terms WHERE snapshot_id=?', [manifest.id]);
    if (Number(count.n) !== manifest.total) throw Error('staged term count mismatch');
    const [[current]] = await c.query<RowDataPacket[]>(
      'SELECT s.manifest,s.generated_at FROM topic_current c JOIN topic_snapshots s ON s.id=c.snapshot_id WHERE c.source=? FOR UPDATE',
      [SOURCE],
    );
    const previous = current ? json<LocalManifest | ExportManifest>(current.manifest) : null;
    const newer =
      !previous ||
      (manifest.coverage === 'all-current-indexed-article-tags' && previous.coverage !== 'all-current-indexed-article-tags') ||
      (manifest.coverage === previous.coverage && Date.parse(manifest.generatedAt) > Date.parse(previous.generatedAt));
    await c.execute("UPDATE topic_snapshots SET status='published',synced_at=? WHERE id=?", [now, manifest.id]);
    if (newer)
      await c.execute(
        'INSERT INTO topic_current(source,snapshot_id) VALUES (?,?) ON DUPLICATE KEY UPDATE snapshot_id=VALUES(snapshot_id)',
        [SOURCE, manifest.id],
      );
    await c.execute("UPDATE topic_window_runs SET status='published',updated_at=? WHERE id=?", [now, manifest.id]);
    await c.commit();
    return { status: 'published', version: manifest.id, total: terms.length, becameCurrent: newer, coverage: manifest.coverage };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export async function importSnapshot(
  pool: Pool,
  source: SnapshotSource,
  now: Date,
  assertLease: () => Promise<void>,
  maxPages = 500,
  control: { signal?: AbortSignal; deadline?: number } = {},
) {
  const assertRunning = () => {
    control.signal?.throwIfAborted();
    if (Date.now() >= (control.deadline ?? Infinity)) throw Error('snapshot deadline; current retained');
  };
  assertRunning();
  const manifest = validateManifest(await source.current());
  if (manifest.pages.length > maxPages) throw Error('snapshot page cap; current retained');
  const hash = createHash('sha256');
  const terms: { id: string; label: string; payload: unknown }[] = [];
  let previous: Buffer | null = null;
  let bytes = 0;
  for (let i = 0; i < manifest.pages.length; i++) {
    assertRunning();
    await assertLease();
    if (i) await delay(500, undefined, { signal: control.signal });
    const page = validatePage(await source.page(manifest, i), manifest, i);
    for (const t of page.entries) {
      const label = Buffer.from(t.label);
      if (previous && Buffer.compare(previous, label) >= 0) throw Error('snapshot order or duplicate');
      previous = label;
      const encoded = JSON.stringify(t) + '\n';
      bytes += Buffer.byteLength(encoded);
      if (bytes > 64_000_000) throw Error('snapshot total byte cap');
      hash.update(encoded);
      terms.push({ id: t.id, label: t.label, payload: t });
    }
  }
  if (terms.length !== manifest.total || hash.digest('hex') !== manifest.sha256) throw Error('snapshot full checksum mismatch');
  assertRunning();
  return publish(pool, manifest, terms, now, assertLease);
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
      const beforeRequest = async () => {
        await assertLease();
        if (!(await reserveBudget(pool, [{ scope: 'topics:upstream-requests', amount: 1, limit: 100 }], options.now?.() ?? new Date())))
          throw Error('topic_upstream_budget');
      };
      if (options.mode === 'snapshot') {
        if (!(await reserveBudget(pool, [{ scope: 'topics:full-sync', amount: 1, limit: 1 }], now))) return { status: 'budget' };
        return importSnapshot(
          pool,
          options.snapshotSource ?? new HttpSnapshotSource(fetch, signal, { deadline: started + timeout, beforeRequest }),
          now,
          assertLease,
          500,
          {
            signal,
            deadline: started + timeout,
          },
        );
      }
      const [[active]] = await pool.query<RowDataPacket[]>(
        "SELECT * FROM topic_window_runs WHERE status IN ('scanning','ready') ORDER BY created_at LIMIT 1",
      );
      let id: string;
      let window: Window;
      let cursor: string | null;
      let pages: number;
      let status: string;
      if (active?.next_attempt_at && new Date(active.next_attempt_at).getTime() > now.getTime())
        return { status: 'deferred', version: active.id, nextAttemptAt: active.next_attempt_at };
      if (active) {
        id = active.id;
        window = { since: active.since_at, until: active.until_at };
        cursor = active.cursor;
        pages = active.pages;
        status = active.status;
      } else {
        if (!(await reserveBudget(pool, [{ scope: 'topics:window-start', amount: 1, limit: 1 }], now))) return { status: 'budget' };
        window = options.window ?? { since: new Date(now.getTime() - 86400_000).toISOString(), until: now.toISOString() };
        validateWindow(window);
        window = { since: new Date(window.since).toISOString(), until: new Date(window.until).toISOString() };
        id = randomUUID();
        cursor = null;
        pages = 0;
        status = 'scanning';
        await pool.execute('INSERT INTO topic_window_runs(id,since_at,until_at,created_at,updated_at) VALUES (?,?,?,?,?)', [
          id,
          window.since,
          window.until,
          now,
          now,
        ]);
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
          if (!(await reserveBudget(pool, [{ scope: 'topics:window-pages', amount: 1, limit: 100 }], options.now?.() ?? new Date()))) break;
          await assertLease();
          if (options.source) await beforeRequest();
          const page = await source.page(window, cursor);
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
            if (Number(count.bytes) + page.articles.reduce((sum, a) => sum + Buffer.byteLength(JSON.stringify(a)), 0) > 32_000_000)
              throw Error('vocabulary staged byte cap');
            if (Number(count.n) + page.articles.length > 50_000) throw Error('vocabulary 50000-article cap');
            if (page.articles.length)
              await c.query('INSERT INTO topic_window_articles(run_id,article_id,payload) VALUES ?', [
                page.articles.map((a) => [id, a.id, JSON.stringify(a)]),
              ]);
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
        const counts = new Map<string, number>();
        let bytes = 0;
        for (const row of rows) {
          const a = json<SourceArticle>(row.payload);
          bytes += Buffer.byteLength(JSON.stringify(a));
          if (bytes > 32_000_000) throw Error('vocabulary staged byte cap');
          for (const label of new Set(a.tags)) {
            counts.set(label, (counts.get(label) ?? 0) + 1);
            if (counts.size > 50_000) throw Error('vocabulary 50000-term cap');
          }
        }
        const terms = [...counts]
          .map(([label, articleCount]) => ({
            id: digest(label),
            label,
            payload: { label, articleCount, origin: 'article-tags-mixed', journalistAssigned: null },
          }))
          .sort((a, b) => Buffer.compare(Buffer.from(a.label), Buffer.from(b.label)));
        const manifest: LocalManifest = {
          id,
          source: SOURCE,
          coverage: 'observed-article-window',
          window,
          generatedAt: window.until,
          total: terms.length,
          sha256: digest(terms.map((t) => JSON.stringify(t.payload) + '\n').join('')),
          upstreamSnapshotConsistent: false,
          attribution: '新文易數 tag.observe.tw',
        };
        return {
          ...(await publish(pool, manifest, terms, now, assertLease)),
          transport: source instanceof TagArticleSource ? source.diagnostics : null,
        };
      } catch (error) {
        if (error instanceof TagRateLimitError) return { status: 'deferred', version: id, nextAttemptAt: error.retryAt };
        const message = error instanceof Error ? error.message : '';
        if (message === 'topic_upstream_budget') return { status: 'budget', version: id };
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
        if (!reason) throw error;
        await assertLease();
        await pool.execute('UPDATE topic_window_runs SET status=?,updated_at=? WHERE id=?', [reason, options.now?.() ?? new Date(), id]);
        return { status: 'capped', reason, version: id, pages, window };
      }
    })) ?? { status: 'busy' }
  );
}
