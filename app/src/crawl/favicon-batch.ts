import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { createTechFetchBatch } from '../tech/fetch-batch.ts';
import { type FaviconTarget, loadFaviconState, refreshFavicon } from './favicons.ts';
import type { FeedCrawlerOptions } from './feed.ts';

const RETRY_MS = 7 * 86_400_000;
type Options = FeedCrawlerOptions & { root?: string; limit?: number; maxDurationMs?: number; now?: () => Date };
function budget(value: number | undefined, maximum: number) {
  if (value === undefined) return maximum;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('invalid favicon batch budget');
  return Math.min(value, maximum);
}

/** Missing verified-site icons only. The CLI and worker serialize all cache writes with the same exclusive file. */
export async function refreshMissingBlogFavicons(pool: Pick<Pool, 'query'>, options: Options = {}) {
  const limit = budget(options.limit, 10);
  const duration = budget(options.maxDurationMs, 120_000);
  const root = resolve(options.root || process.env.BLOG_FAVICON_ROOT || new URL('../../../', import.meta.url).pathname);
  const now = options.now || (() => new Date());
  await mkdir(resolve(root, 'app/data'), { recursive: true });
  const lockPath = resolve(root, 'app/data/.favicon-refresh.lock');
  const lock = await open(lockPath, 'wx').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EEXIST') return null;
    throw error;
  });
  if (!lock) return { skipped: 'favicon-refresh-busy', selected: 0, processed: 0, results: [] };
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: now().toISOString() }));
    const deadline = Date.now() + duration;
    const state = await loadFaviconState(root);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id,slug,name,url FROM blogs WHERE status='verified' AND url IS NOT NULL ORDER BY id",
    );
    const targets: Array<{ target: FaviconTarget; attempted: number }> = [];
    for (const row of rows) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(row.slug)) continue;
      const local = state.local[row.slug];
      if (
        local?.targetUrl === row.url &&
        (await stat(resolve(root, 'web/public/favicons', `${row.slug}.png`))
          .then((file) => file.isFile())
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          }))
      )
        continue;
      const previous = state.catalog[row.slug];
      const checked = previous?.url === row.url ? Date.parse(previous.checkedAt) : NaN;
      if (previous?.status !== 'success' && Number.isFinite(checked) && now().getTime() - checked < RETRY_MS) continue;
      targets.push({
        target: { id: Number(row.id), slug: row.slug, title: row.name, url: row.url, kind: 'blog' },
        attempted: Number.isFinite(checked) ? checked : Number.NEGATIVE_INFINITY,
      });
    }
    targets.sort((a, b) => a.attempted - b.attempted || a.target.id - b.target.id);
    const selected = targets.slice(0, limit);
    const results: Awaited<ReturnType<typeof refreshFavicon>>[] = [];
    const batchCache = new Map<string, string>();
    for (const { target } of selected) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const passiveBatch = createTechFetchBatch(pool as Pool, { blogId: target.id, blogUrl: target.url! });
      const observer: FeedCrawlerOptions['observer'] = passiveBatch
        ? (event) => {
            passiveBatch.observer(event);
            try {
              const pending = options.observer?.(event);
              if (pending && typeof pending.catch === 'function') void pending.catch(() => undefined);
            } catch {
              /* Match politeFetch's failure-isolated, non-awaited callback contract. */
            }
          }
        : options.observer;
      results.push(
        await refreshFavicon(target, {
          ...options,
          observer,
          root,
          state,
          batchCache,
          now: now(),
          timeoutMs: Math.min(options.timeoutMs ?? 8000, remaining),
          maxTargetMs: Math.min(30_000, remaining),
        }),
      );
      await passiveBatch?.commit([]);
    }
    return { selected: selected.length, processed: results.length, results };
  } finally {
    // Do not race outstanding refreshes against a timer: a late cache write must never outlive this lock.
    try {
      await lock.close();
    } finally {
      await unlink(lockPath);
    }
  }
}
