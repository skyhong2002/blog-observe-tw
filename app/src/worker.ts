import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { loadConfig } from './config.js';
import { discoverBlogblog, discoverSimilar } from './crawl/discovery.ts';
import { crawlBlog } from './crawl/feed.ts';
import { createDb } from './db/client.ts';

const config = loadConfig();
const log = pino({ level: config.logLevel });
const store = createDb(config.blogDbUrl, { poolSize: 2 });
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(config.queueName, { connection, prefix: config.queuePrefix });
const interval = Math.max(30 * 60_000, Number(process.env.BLOG_CRAWL_INTERVAL_MS || 6 * 60 * 60_000));

await queue.upsertJobScheduler(
  'blogs-feed',
  { every: interval },
  { name: 'blogs-feed', data: {}, opts: { removeOnComplete: 20, removeOnFail: 20 } },
);
await queue.upsertJobScheduler(
  'blogs-discovery',
  { every: 7 * 24 * 60 * 60_000 },
  { name: 'blogs-discovery', data: {}, opts: { removeOnComplete: 10, removeOnFail: 10 } },
);

const worker = new Worker(
  config.queueName,
  async (job) => {
    if (job.name === 'blogs-discovery') {
      const blogblog = await discoverBlogblog(store.pool, config.crawlUserAgent);
      const [domains] = (await store.pool.query(
        'SELECT canonical_host AS domain FROM blogs WHERE status="verified" AND canonical_host IS NOT NULL',
      )) as [Array<{ domain: string }>, unknown];
      const similar = await discoverSimilar(
        store.pool,
        domains.map((row) => row.domain),
      );
      return { blogblog, similar };
    }
    if (job.name !== 'blogs-feed') return { skipped: job.name };
    const [rows] = (await store.pool.query('SELECT id,slug,url FROM blogs WHERE status="verified" AND url IS NOT NULL ORDER BY id')) as [
      Array<{ id: number; slug: string; url: string }>,
      unknown,
    ];
    const results = [];
    for (const blog of rows) {
      try {
        results.push(await crawlBlog(store, blog, { userAgent: config.crawlUserAgent, delayMs: config.crawlDelayMs }));
      } catch (error) {
        log.warn({ blog: blog.slug, error: error instanceof Error ? error.message : String(error) }, 'blog crawl failed');
      }
    }
    return { count: results.length, results };
  },
  { connection, prefix: config.queuePrefix, concurrency: 1 },
);
worker.on('completed', (job) => log.info({ job: job.name }, 'blog worker job completed'));
worker.on('failed', (job, error) => log.error({ job: job?.name, error: error.message }, 'blog worker job failed'));

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await worker.close();
  await queue.close();
  await connection.quit();
  await store.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => close().finally(() => process.exit(0)));
