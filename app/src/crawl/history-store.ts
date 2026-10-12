import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { type BlogToCrawl, isAllowedCrawlUrl, isNonSyndicationSource, writeFeedEntries } from './feed.ts';
import { historyInPublication, historySourceInScope, historyTaskKey } from './history-parse.ts';
import type { HistoryRun, HistoryStore, HistoryTask, HistoryTaskInput } from './history-types.ts';

const LOCK = 'blog_observe:history-import';
const kinds = new Set(['home', 'feed', 'sitemap', 'wordpress', 'article', 'entry']);
const parseJson = (value: unknown): unknown => (typeof value === 'string' ? JSON.parse(value) : value);
const iso = (value: unknown): string | null => (value == null ? null : new Date(value as string | Date).toISOString());
export const historyLimit = (reason: string) => Object.assign(new Error(reason), { code: 'HISTORY_LIMIT' });
function runOf(row: RowDataPacket): HistoryRun {
  return {
    blogId: Number(row.blog_id),
    status: row.status,
    pagesFetched: Number(row.pages_fetched),
    articlesWritten: Number(row.articles_written),
    tasksTotal: Number(row.tasks_total),
    tasksDone: Number(row.tasks_done),
    archiveSeen: Boolean(row.archive_seen),
    warnings: parseJson(row.warnings) as string[],
    nextAttemptAt: iso(row.next_attempt_at),
    lastError: row.last_error,
  };
}
function taskOf(row: RowDataPacket): HistoryTask {
  return {
    id: row.id,
    blogId: Number(row.blog_id),
    url: row.url,
    kind: row.kind,
    sourceUrl: row.source_url,
    sourceType: row.source_type,
    depth: Number(row.depth),
    payload: parseJson(row.payload) as HistoryTask['payload'],
    status: row.status,
    attempts: Number(row.attempts || 0),
    lastError: row.last_error || null,
  };
}
async function lockBlog(connection: PoolConnection, blog: BlogToCrawl) {
  const [[row]] = await connection.query<RowDataPacket[]>('SELECT id,url,status FROM blogs WHERE id=? FOR UPDATE', [blog.id]);
  if (row?.status !== 'verified' || row.url !== blog.url) throw new Error('history_blog_identity_changed');
}
async function sourceOwned(connection: PoolConnection, blog: BlogToCrawl, url: string) {
  if (url === blog.url) return;
  const [[row]] = await connection.query<RowDataPacket[]>('SELECT blog_id FROM feed_sources WHERE url=? FOR UPDATE', [url]);
  if (!row || Number(row.blog_id) !== blog.id) throw new Error('history_source_ownership_changed');
}
function validateTask(blog: BlogToCrawl, task: HistoryTaskInput) {
  if (
    !kinds.has(task.kind) ||
    !['rss', 'atom', 'sitemap', 'wordpress'].includes(task.sourceType) ||
    !isAllowedCrawlUrl(task.url) ||
    task.url.length > 1024 ||
    !isAllowedCrawlUrl(task.sourceUrl) ||
    task.sourceUrl.length > 1024 ||
    !Number.isInteger(task.depth) ||
    task.depth < 0 ||
    task.depth > 64 ||
    Buffer.byteLength(JSON.stringify(task.payload || {})) > 256 * 1024
  )
    throw historyLimit('history_task_bounds');
  if (
    task.kind === 'article' || task.kind === 'entry'
      ? !historyInPublication(task.url, blog.url)
      : !historySourceInScope(task.url, blog, task.sourceUrl)
  )
    throw new Error('history_task_outside_publication');
}
async function enqueue(connection: PoolConnection, blog: BlogToCrawl, tasks: HistoryTaskInput[], cap: number, now: Date): Promise<number> {
  const unique = new Map<string, HistoryTaskInput>();
  for (const task of tasks) {
    validateTask(blog, task);
    unique.set(historyTaskKey(blog.id, task), task);
  }
  if (!unique.size) return 0;
  const [[count]] = await connection.query<RowDataPacket[]>('SELECT COUNT(*) AS total FROM history_tasks WHERE blog_id=?', [blog.id]);
  const keys = [...unique.keys()];
  let existing = 0;
  for (let start = 0; start < keys.length; start += 500) {
    const batch = keys.slice(start, start + 500);
    const [rows] = await connection.query<RowDataPacket[]>(
      `SELECT id FROM history_tasks WHERE id IN (${batch.map(() => '?').join(',')})`,
      batch,
    );
    existing += rows.length;
  }
  const added = unique.size - existing;
  if (Number(count.total) + added > cap) throw historyLimit('history_task_limit');
  const entries = [...unique.entries()];
  for (let start = 0; start < entries.length; ) {
    // Full internal bodies make queued rows larger than the former short excerpts.
    // Bound the escaped SQL packet as well as row count; mysql2.query can double
    // backslashes/quotes when formatting JSON, so reserve twice the raw byte size.
    let end = start,
      bytes = 0;
    while (end < entries.length && end - start < 100) {
      const task = entries[end][1];
      const estimated = 2 * Buffer.byteLength(JSON.stringify(task)) + 2048;
      if (end > start && bytes + estimated > 4 * 1024 * 1024) break;
      bytes += estimated;
      end++;
    }
    const batch = entries.slice(start, end);
    start = end;
    await connection.query(
      `INSERT INTO history_tasks (id,blog_id,url,kind,source_url,source_type,depth,payload,status,created_at) VALUES ${batch.map(() => "(?,?,?,?,?,?,?,?,'pending',?)").join(',')} ON DUPLICATE KEY UPDATE id=id`,
      batch.flatMap(([id, task]) => [
        id,
        blog.id,
        task.url,
        task.kind,
        task.sourceUrl,
        task.sourceType,
        task.depth,
        JSON.stringify(task.payload || {}),
        now,
      ]),
    );
  }
  return added;
}

/** Dedicated global lease + one transaction connection: poolSize=2 is sufficient. No HTTP runs inside transactions. */
export function createHistoryStore(pool: Pool): HistoryStore {
  if ((pool as unknown as { pool?: { config?: { connectionLimit?: number } } }).pool?.config?.connectionLimit === 1)
    throw new Error('history requires poolSize >= 2');
  let lease: PoolConnection | null = null;
  let acquiring = false;
  async function assertLease() {
    const connection = lease;
    if (!connection) throw new Error('history lease not held');
    try {
      const [[row]] = await connection.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?)=CONNECTION_ID() AS held', [LOCK]);
      if (Number(row?.held) !== 1) throw new Error('history lease lost');
    } catch (error) {
      lease = null;
      connection.destroy();
      throw error;
    }
  }
  async function transaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    await assertLease();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await assertLease();
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
  return {
    async acquire() {
      if (lease || acquiring) return false;
      acquiring = true;
      let connection: PoolConnection | null = null;
      try {
        connection = await pool.getConnection();
        const [[row]] = await connection.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS acquired', [LOCK]);
        if (Number(row?.acquired) !== 1) {
          connection.release();
          return false;
        }
        lease = connection;
        return true;
      } catch (error) {
        connection?.destroy();
        throw error;
      } finally {
        acquiring = false;
      }
    },
    assertLease,
    async release() {
      if (!lease) return;
      const connection = lease;
      lease = null;
      try {
        const [[row]] = await connection.query<RowDataPacket[]>('SELECT RELEASE_LOCK(?) AS released', [LOCK]);
        if (Number(row?.released) !== 1) throw new Error('history lease lost');
        connection.release();
      } catch (error) {
        connection.destroy();
        throw error;
      }
    },
    async initialize(blog, caps, now) {
      return transaction(async (connection) => {
        await lockBlog(connection, blog);
        const [[previous]] = await connection.query<RowDataPacket[]>('SELECT * FROM history_runs WHERE blog_id=? FOR UPDATE', [blog.id]);
        if (!previous) {
          await connection.execute("INSERT INTO history_runs (blog_id,status,warnings,started_at,updated_at) VALUES (?,'partial',?, ?,?)", [
            blog.id,
            '[]',
            now,
            now,
          ]);
          // Legacy --history only replayed a feed window. It cannot certify this queue.
          await connection.execute('UPDATE blogs SET history_imported_at=NULL WHERE id=?', [blog.id]);
        }
        if (previous && previous.status !== 'complete')
          await connection.execute('UPDATE blogs SET history_imported_at=NULL WHERE id=?', [blog.id]);
        const [feeds] = await connection.query<RowDataPacket[]>(
          'SELECT url,type FROM feed_sources WHERE blog_id=? AND last_success_at IS NOT NULL ORDER BY id',
          [blog.id],
        );
        const tasks: HistoryTaskInput[] = [{ url: blog.url, kind: 'home', sourceUrl: blog.url, sourceType: 'rss', depth: 0 }];
        for (const feed of feeds)
          if (['rss', 'atom', 'sitemap'].includes(feed.type) && !isNonSyndicationSource(feed.url))
            tasks.push({
              url: feed.url,
              kind: feed.type === 'sitemap' ? 'sitemap' : 'feed',
              sourceUrl: feed.url,
              sourceType: feed.type,
              depth: 0,
            });
        const queued = await enqueue(connection, blog, tasks, caps.maxTasks, now);
        if (queued) {
          await connection.execute('UPDATE blogs SET history_imported_at=NULL WHERE id=?', [blog.id]);
          await connection.execute(
            "UPDATE history_runs SET tasks_total=tasks_total+?,status='partial',completed_at=NULL,updated_at=? WHERE blog_id=?",
            [queued, now, blog.id],
          );
        }
        const [[run]] = await connection.query<RowDataPacket[]>('SELECT * FROM history_runs WHERE blog_id=?', [blog.id]);
        return runOf(run);
      });
    },
    async nextTask(blogId, allowed) {
      if (!allowed.length) return null;
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT * FROM history_tasks WHERE blog_id=? AND status='pending' AND kind IN (${allowed.map(() => '?').join(',')}) ORDER BY CASE kind WHEN 'home' THEN 0 WHEN 'entry' THEN 1 WHEN 'article' THEN 2 WHEN 'feed' THEN 3 WHEN 'wordpress' THEN 3 ELSE 4 END,created_at,id LIMIT 1`,
        [blogId, ...allowed],
      );
      return rows[0] ? taskOf(rows[0]) : null;
    },
    async commitTask(blog, task, result, caps, now) {
      return transaction(async (connection) => {
        await lockBlog(connection, blog);
        await sourceOwned(connection, blog, task.sourceUrl);
        const [[saved]] = await connection.query<RowDataPacket[]>('SELECT * FROM history_tasks WHERE id=? AND blog_id=? FOR UPDATE', [
          task.id,
          blog.id,
        ]);
        if (!saved) throw new Error('history_task_missing');
        if (saved.status === 'done' || saved.status === 'failed') return { written: 0, queued: 0 };
        if (saved.url !== task.url || saved.source_url !== task.sourceUrl || saved.kind !== task.kind)
          throw new Error('history_task_changed');
        const [[run]] = await connection.query<RowDataPacket[]>('SELECT * FROM history_runs WHERE blog_id=? FOR UPDATE', [blog.id]);
        if (Number(run.pages_fetched) + Number(result.fetched) > caps.maxTotalPages) throw historyLimit('history_page_limit');
        if (Number(run.articles_written) + result.entries.length > caps.maxTotalArticles) throw historyLimit('history_article_limit');
        let tasks = result.tasks;
        const warnings = new Set<string>([...(parseJson(run.warnings) as string[]), ...(result.warnings || [])]);
        if (result.fingerprint && ['feed', 'wordpress'].includes(task.kind)) {
          const [same] = await connection.query<RowDataPacket[]>(
            "SELECT id FROM history_tasks WHERE blog_id=? AND source_url=? AND response_hash=? AND kind=? AND status='done' AND id<>? LIMIT 1",
            [blog.id, task.sourceUrl, result.fingerprint, task.kind, task.id],
          );
          if (same.length) {
            tasks = [];
            warnings.add('pagination-repeated-content');
          }
        }
        for (const child of tasks) if (child.sourceUrl !== task.sourceUrl) throw new Error('history_child_source_changed');
        const queued = await enqueue(connection, blog, tasks, caps.maxTasks, now);
        for (const entry of result.entries)
          if (!historyInPublication(entry.url, blog.url)) throw new Error('history_entry_outside_publication');
        const written = await writeFeedEntries(connection, blog, { url: task.url, type: task.sourceType }, result.entries, now);
        // Cursor completion is atomic with all post/author/tag writes and durable child work.
        await connection.execute("UPDATE history_tasks SET status='done',response_hash=?,completed_at=? WHERE id=? AND status='pending'", [
          result.fingerprint || null,
          now,
          task.id,
        ]);
        await connection.execute(
          "UPDATE history_runs SET pages_fetched=pages_fetched+?,articles_written=articles_written+?,tasks_total=tasks_total+?,tasks_done=tasks_done+1,archive_seen=archive_seen OR ?,warnings=?,status='partial',last_error=NULL,next_attempt_at=NULL,updated_at=? WHERE blog_id=?",
          [Number(result.fetched), written, queued, Boolean(result.archiveSeen), JSON.stringify([...warnings].slice(0, 100)), now, blog.id],
        );
        if (written)
          await connection.execute(
            'UPDATE blogs SET last_crawl_success_at=?,last_published_at=COALESCE((SELECT MAX(published_at) FROM posts WHERE blog_id=?),last_published_at) WHERE id=?',
            [now, blog.id, blog.id],
          );
        return { written, queued };
      });
    },
    async failTask(blog, task, reason, now) {
      return transaction(async (connection) => {
        await lockBlog(connection, blog);
        // No sourceOwned check: a deleted source is itself a terminal task error,
        // and must not prevent recording that failure without writing articles.
        const [[saved]] = await connection.query<RowDataPacket[]>('SELECT * FROM history_tasks WHERE id=? AND blog_id=? FOR UPDATE', [
          task.id,
          blog.id,
        ]);
        if (!saved || saved.url !== task.url || saved.source_url !== task.sourceUrl || saved.kind !== task.kind)
          throw new Error('history_task_changed');
        if (saved.status !== 'pending') return saved.status === 'failed';
        const attempts = Number(saved.attempts || 0) + 1;
        const terminal = attempts >= 3;
        await connection.execute('UPDATE history_tasks SET attempts=?,last_error=?,status=?,completed_at=? WHERE id=?', [
          attempts,
          reason.slice(0, 255),
          terminal ? 'failed' : 'pending',
          terminal ? now : null,
          task.id,
        ]);
        if (terminal) {
          const [[run]] = await connection.query<RowDataPacket[]>('SELECT * FROM history_runs WHERE blog_id=? FOR UPDATE', [blog.id]);
          const warnings = new Set<string>(parseJson(run.warnings) as string[]);
          warnings.add(`failed-task:${reason}`);
          await connection.execute(
            "UPDATE history_runs SET tasks_done=tasks_done+1,warnings=?,status='partial',last_error=?,next_attempt_at=NULL,updated_at=? WHERE blog_id=?",
            [JSON.stringify([...warnings].slice(0, 100)), reason.slice(0, 255), now, blog.id],
          );
          await connection.execute('UPDATE blogs SET history_imported_at=NULL WHERE id=?', [blog.id]);
        }
        return terminal;
      });
    },
    async defer(blogId, reason, until, status, now) {
      await assertLease();
      await pool.execute('UPDATE history_runs SET status=?,last_error=?,next_attempt_at=?,updated_at=? WHERE blog_id=?', [
        status,
        reason.slice(0, 255),
        until,
        now,
        blogId,
      ]);
    },
    async finish(blogId, now) {
      return transaction(async (connection) => {
        await connection.query('SELECT id FROM blogs WHERE id=? FOR UPDATE', [blogId]);
        const [[run]] = await connection.query<RowDataPacket[]>('SELECT * FROM history_runs WHERE blog_id=? FOR UPDATE', [blogId]);
        if (!run) throw new Error('history_run_missing');
        const [[count]] = await connection.query<RowDataPacket[]>(
          "SELECT COUNT(*) AS total FROM history_tasks WHERE blog_id=? AND status='pending'",
          [blogId],
        );
        let status = run.status;
        if (Number(count.total)) await connection.execute('UPDATE blogs SET history_imported_at=NULL WHERE id=?', [blogId]);
        if (!Number(count.total)) {
          const warnings = parseJson(run.warnings) as string[];
          status = run.archive_seen && warnings.length === 0 ? 'complete' : 'exhausted';
          await connection.execute('UPDATE history_runs SET status=?,completed_at=?,next_attempt_at=NULL,updated_at=? WHERE blog_id=?', [
            status,
            now,
            now,
            blogId,
          ]);
          await connection.execute('UPDATE blogs SET history_imported_at=? WHERE id=?', [status === 'complete' ? now : null, blogId]);
        } else if (!['blocked', 'limited'].includes(status)) {
          status = 'partial';
          await connection.execute("UPDATE history_runs SET status='partial',updated_at=? WHERE blog_id=?", [now, blogId]);
        }
        const [[fresh]] = await connection.query<RowDataPacket[]>('SELECT * FROM history_runs WHERE blog_id=?', [blogId]);
        return runOf(fresh);
      });
    },
  };
}

/** Oldest attempted eligible blog first; a large archive cannot starve later sources. */
export async function selectHistoryBlogs(pool: Pool, limit = 5): Promise<BlogToCrawl[]> {
  const size = Math.max(1, Math.min(50, Math.trunc(limit)));
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT b.id,b.slug,b.url FROM blogs b LEFT JOIN history_runs h ON h.blog_id=b.id
     WHERE b.status='verified' AND b.url IS NOT NULL AND (h.blog_id IS NULL OR (h.status IN ('partial','blocked') AND (h.next_attempt_at IS NULL OR h.next_attempt_at<=UTC_TIMESTAMP())))
     ORDER BY COALESCE(h.updated_at,'1970-01-01'),b.id LIMIT ${size}`,
  );
  return rows.map((row) => ({ id: Number(row.id), slug: row.slug, url: row.url }));
}
