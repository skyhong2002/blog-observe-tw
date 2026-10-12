import type { RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../app/src/config.js';
import { runHistoryBatch } from '../app/src/crawl/history.ts';
import { createHistoryStore, selectHistoryBlogs } from '../app/src/crawl/history-store.ts';
import { createDb } from '../app/src/db/client.ts';

function numberArg(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(process.argv[index + 1]);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid ${name}`);
  return value;
}
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  const idsAt = process.argv.indexOf('--ids');
  const ids = idsAt >= 0 ? (process.argv[idsAt + 1] || '').split(',').map(Number) : null;
  if (ids && (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0))) throw new Error('invalid --ids');
  const limit = numberArg('--blogs', 5);
  const blogs = ids
    ? (
        await db.pool.query<RowDataPacket[]>(
          `SELECT id,slug,url FROM blogs WHERE status='verified' AND url IS NOT NULL AND id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
          ids,
        )
      )[0].map((row) => ({ id: Number(row.id), slug: String(row.slug), url: String(row.url) }))
    : await selectHistoryBlogs(db.pool, limit);
  const store = createHistoryStore(db.pool);
  for (const blog of blogs) {
    const result = await runHistoryBatch(store, blog, {
      userAgent: config.crawlUserAgent,
      delayMs: config.crawlDelayMs,
      timeoutMs: 10000,
      maxPages: numberArg('--pages', 5),
      maxArticles: numberArg('--articles', 30),
      maxDurationMs: numberArg('--duration-ms', 60000),
      maxTotalPages: numberArg('--total-pages', 10000),
      maxTotalArticles: numberArg('--total-articles', 100000),
      maxTasks: numberArg('--tasks', 200000),
    });
    console.log(JSON.stringify({ blog: blog.slug, ...result }));
    if (result.status === 'busy') break;
  }
} finally {
  await db.close();
}
