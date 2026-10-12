import type { Pool, RowDataPacket } from 'mysql2/promise';
import { SOURCE } from './snapshot-client.ts';
import type { SourceArticle, Window } from './window-contract.ts';
import { validateWindow } from './window-contract.ts';

export const WINDOW_REQUEST_LIMIT = 600;
export const WINDOW_START_LIMIT = 96;
export const LOOKBACK_MS = 3600_000;
export type WindowPlan = {
  window: Window;
  coverageSince: string;
  parentVersion: string | null;
  strategy: 'full-window' | 'incremental-overlap';
};
export function planIncrementalWindow(now: Date, previous?: { id: string; until: string; coverageSince: string } | null): WindowPlan {
  const until = now.toISOString(),
    coverageSince = new Date(now.getTime() - 86400_000).toISOString();
  const previousUntil = previous ? Date.parse(previous.until) : NaN;
  const reusable =
    previous &&
    previousUntil < now.getTime() &&
    previousUntil >= Date.parse(coverageSince) &&
    Date.parse(previous.coverageSince) <= Date.parse(coverageSince);
  return {
    window: {
      since: reusable ? new Date(Math.max(Date.parse(coverageSince), previousUntil - LOOKBACK_MS)).toISOString() : coverageSince,
      until,
    },
    coverageSince,
    parentVersion: reusable ? previous.id : null,
    strategy: reusable ? 'incremental-overlap' : 'full-window',
  };
}
const value = <T>(input: unknown): T => (typeof input === 'string' ? JSON.parse(input) : input) as T;
/** Backfill only private cached metadata, locally and in bounded batches; never refetch the 24h corpus. */
async function backfillPublishedAt(pool: Pool, parent: string, assertLease: () => Promise<void>) {
  for (let batch = 0; batch < 100; batch++) {
    await assertLease();
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT article_id,payload FROM topic_window_articles WHERE run_id=? AND published_at IS NULL ORDER BY article_id LIMIT 500',
      [parent],
    );
    if (!rows.length) return;
    const args: unknown[] = [];
    for (const row of rows) {
      const article = value<SourceArticle>(row.payload);
      const date = new Date(article.publishedAt);
      if (!Number.isFinite(date.getTime())) throw Error('invalid_cached_article_date');
      args.push(row.article_id, date);
    }
    await pool.query(
      `UPDATE topic_window_articles SET published_at=CASE article_id ${rows.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE run_id=? AND article_id IN (?)`,
      [...args, parent, rows.map((r) => r.article_id)],
    );
  }
  const [[remaining]] = await pool.query<RowDataPacket[]>(
    'SELECT COUNT(*) n FROM topic_window_articles WHERE run_id=? AND published_at IS NULL',
    [parent],
  );
  if (Number(remaining.n)) throw Error('vocabulary cached article cap');
}
export async function startWindowRun(
  pool: Pool,
  id: string,
  now: Date,
  assertLease: () => Promise<void>,
  explicit?: Window,
  isolated = false,
): Promise<WindowPlan> {
  let plan: WindowPlan;
  if (explicit || isolated) {
    const window = explicit ?? { since: new Date(now.getTime() - 86400_000).toISOString(), until: now.toISOString() };
    validateWindow(window);
    plan = {
      window: { since: new Date(window.since).toISOString(), until: new Date(window.until).toISOString() },
      coverageSince: new Date(window.since).toISOString(),
      parentVersion: null,
      strategy: 'full-window',
    };
  } else {
    const [[previous]] = await pool.query<RowDataPacket[]>(
      "SELECT r.id,r.since_at,r.coverage_since,r.until_at FROM topic_current c JOIN topic_window_runs r ON r.id=c.snapshot_id WHERE c.source=? AND r.status='published' AND r.sync_strategy<>'cache-retired'",
      [SOURCE],
    );
    plan = planIncrementalWindow(
      now,
      previous ? { id: previous.id, until: previous.until_at, coverageSince: previous.coverage_since ?? previous.since_at } : null,
    );
  }
  if (plan.parentVersion) await backfillPublishedAt(pool, plan.parentVersion, assertLease);
  await assertLease();
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.execute(
      'INSERT INTO topic_window_runs(id,since_at,until_at,coverage_since,parent_run_id,sync_strategy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, plan.window.since, plan.window.until, plan.coverageSince, plan.parentVersion, plan.strategy, now, now],
    );
    if (plan.parentVersion) {
      const bounds = [plan.parentVersion, new Date(plan.coverageSince), new Date(plan.window.until)];
      const [[size]] = await c.query<RowDataPacket[]>(
        'SELECT COUNT(*) n,COALESCE(SUM(OCTET_LENGTH(payload)),0) bytes FROM topic_window_articles WHERE run_id=? AND published_at>=? AND published_at<?',
        bounds,
      );
      if (Number(size.n) > 50_000) throw Error('vocabulary 50000-article cap');
      if (Number(size.bytes) > 32_000_000) throw Error('vocabulary staged byte cap');
      await c.execute(
        'INSERT INTO topic_window_articles(run_id,article_id,payload,published_at) SELECT ?,article_id,payload,published_at FROM topic_window_articles WHERE run_id=? AND published_at>=? AND published_at<?',
        [id, ...bounds],
      );
    }
    await assertLease();
    await c.commit();
    return plan;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
/** Only disposable article caches are reclaimed. Source vocabulary, snapshots and current/active parents remain intact. */
export async function cleanupWindowCache(pool: Pool, assertLease: () => Promise<void>, options: { maxRows?: number; maxMs?: number } = {}) {
  const started = Date.now(),
    limit = Math.min(25_000, Math.max(0, options.maxRows ?? 25_000)),
    deadline = started + (options.maxMs ?? 5000);
  let deleted = 0;
  const eligible = `FROM topic_window_articles a JOIN topic_window_runs r ON r.id=a.run_id LEFT JOIN topic_current c ON c.snapshot_id=r.id WHERE c.snapshot_id IS NULL AND r.status NOT IN ('scanning','ready') AND NOT EXISTS (SELECT 1 FROM topic_window_runs active WHERE active.parent_run_id=r.id AND active.status IN ('scanning','ready'))`;
  while (deleted < limit && Date.now() < deadline) {
    await assertLease();
    const c = await pool.getConnection();
    let count = 0;
    try {
      await c.beginTransaction();
      // Pointer rollback and cache retirement serialize on the same rows. The marker and
      // first deletion must commit together: a partially reclaimed cache is never a baseline.
      await c.query('SELECT source,snapshot_id FROM topic_current FOR UPDATE');
      const [rows] = await c.query<RowDataPacket[]>(
        `SELECT a.run_id,a.article_id ${eligible} LIMIT ${Math.min(500, limit - deleted)} FOR UPDATE`,
      );
      if (!rows.length) {
        await c.rollback();
        return { deleted, backlog: false };
      }
      const runIds = [...new Set(rows.map((r) => String(r.run_id)))];
      await c.query("UPDATE topic_window_runs SET sync_strategy='cache-retired' WHERE id IN (?)", [runIds]);
      await c.query('DELETE FROM topic_window_articles WHERE (run_id,article_id) IN (?)', [rows.map((r) => [r.run_id, r.article_id])]);
      await assertLease();
      await c.commit();
      count = rows.length;
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
    deleted += count;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const [[left]] = await pool.query<RowDataPacket[]>(`SELECT 1 remaining ${eligible} LIMIT 1`);
  return { deleted, backlog: Boolean(left) };
}
