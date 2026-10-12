import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { runAiBatch } from './ai/batch.ts';
import { loadConfig } from './config.js';
import { runContentBatch } from './content/worker.ts';
import { runCandidateReviewBatch } from './crawl/candidate-review.ts';
import { discoverBlogblog, discoverSimilar } from './crawl/discovery.ts';
import { refreshMissingBlogFavicons } from './crawl/favicon-batch.ts';
import { crawlBlog } from './crawl/feed.ts';
import { runHistoryBatch } from './crawl/history.ts';
import { createHistoryStore, selectHistoryBlogs } from './crawl/history-store.ts';
import { createTagSimilarSitesClient } from './crawl/similarweb-client.ts';
import { createDb } from './db/client.ts';
import { runPublicationDiscoveryBatch } from './relations/home.ts';
import { runRelationSnapshotBatch } from './relations/routes.ts';
import { runRelationBatch } from './relations/worker.ts';
import { backfillPublicRoutes, backfillTopicRouteAliases } from './seo/page-routes.ts';
import { runTopicsBatch } from './topics/batch.ts';
import { refreshTopicFrequencies } from './topics/frequency.ts';
import { syncVocabulary } from './topics/sync.ts';
import { historyWritesEnabled } from './topics/history-contracts.ts';
import { backfillTopicHistory } from './topics/history-backfill.ts';
import { revalidateTopicHistory } from './topics/history-worker.ts';

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

await queue.upsertJobScheduler(
  'blogs-similarweb',
  // Wake hourly; the database gate permits API polling only every six hours.
  { every: 60 * 60_000 },
  { name: 'blogs-similarweb', data: {}, opts: { removeOnComplete: 10, removeOnFail: 10 } },
);
const historyEnabled = process.env.BLOG_HISTORY_ENABLED !== 'false';
const candidateReviewEnabled = process.env.BLOG_CANDIDATE_REVIEW_ENABLED !== 'false';
const relationsEnabled = process.env.BLOG_RELATIONS_ENABLED === 'true';
const aiEnabled = process.env.BLOG_AI_ENABLED === 'true';
const topicsEnabled = process.env.BLOG_TOPICS_ENABLED === 'true';
const vocabularyEnabled = process.env.BLOG_VOCABULARY_ENABLED === 'true';
const contentEnabled = process.env.BLOG_CONTENT_ENABLED === 'true';
const shutdown = new AbortController();
const missingIconsEnabled = process.env.BLOG_MISSING_FAVICONS_ENABLED !== 'false';
for (const [name, every, enabled] of [
  ['blogs-content', 5 * 60_000, contentEnabled],
  ['blogs-relation-snapshots', 5 * 60_000, process.env.BLOG_RELATION_SNAPSHOTS_ENABLED !== 'false'],
  ['blogs-relations', 5 * 60_000, relationsEnabled],
  ['blogs-publication-discovery', 30 * 60_000, relationsEnabled],
  ['blogs-ai', 60 * 60_000, aiEnabled],
  ['blogs-topics', 10 * 60_000, topicsEnabled],
  ['blogs-topic-history', 5 * 60_000, historyWritesEnabled()],
  ['blogs-topic-frequencies', 60 * 60_000, topicsEnabled],
  ['blogs-vocabulary', 15 * 60_000, vocabularyEnabled],
  ['blogs-history', 5 * 60_000, historyEnabled],
  ['blogs-candidate-review', 30 * 60_000, candidateReviewEnabled],
  ['blogs-missing-icons', 15 * 60_000, missingIconsEnabled],
  ['blogs-public-routes', 15 * 60_000, true],
] as const) {
  if (enabled) await queue.upsertJobScheduler(name, { every }, { name, data: {}, opts: { removeOnComplete: 20, removeOnFail: 20 } });
  else await queue.removeJobScheduler(name);
}
const similarWeb = { ...config.similarWeb, client: createTagSimilarSitesClient() };

let closing = false;
const worker = new Worker(
  config.queueName,
  async (job) => {
    const batchOptions = {
      signal: shutdown.signal,
      limit: 5,
      maxDurationMs: 120000,
      userAgent: config.crawlUserAgent,
      delayMs: config.crawlDelayMs,
    };
    if (job.name === 'blogs-public-routes') {
      // Missing-only batches avoid rewriting the full vocabulary or changing established slugs.
      const blogs = await backfillPublicRoutes(store.pool, { kind: 'blog', limit: 100, missingOnly: true });
      const topics = await backfillPublicRoutes(store.pool, { kind: 'topic', limit: 100, missingOnly: true });
      const aliases = await backfillTopicRouteAliases(store.pool, { limit: 100, missingOnly: true });
      return { blogs, topics, aliases };
    }
    if (job.name === 'blogs-content') return contentEnabled ? runContentBatch(store.pool, batchOptions) : { skipped: 'disabled' };
    if (job.name === 'blogs-relation-snapshots') return runRelationSnapshotBatch(store.pool, batchOptions);
    if (job.name === 'blogs-publication-discovery')
      return relationsEnabled ? runPublicationDiscoveryBatch(store.pool, batchOptions) : { skipped: 'disabled' };
    if (job.name === 'blogs-relations') return relationsEnabled ? runRelationBatch(store.pool, batchOptions) : { skipped: 'disabled' };
    if (job.name === 'blogs-ai') return aiEnabled ? runAiBatch(store.pool, { ...batchOptions, limit: 3 }) : { skipped: 'disabled' };
    if (job.name === 'blogs-topics') {
      if (!topicsEnabled) return { skipped: 'disabled' };
      const result = await runTopicsBatch(store.pool, { ...batchOptions, limit: 200 });
      if (result.processed) await refreshTopicFrequencies(store.pool, { force: true });
      return result;
    }
    if (job.name === 'blogs-topic-history') {
      if (!historyWritesEnabled()) return { skipped: 'disabled' };
      const capture = await backfillTopicHistory(store.pool, { signal: shutdown.signal, limit: 500, maxDurationMs: 30_000 });
      const revalidation = await revalidateTopicHistory(store.pool, { signal: shutdown.signal, limit: 50, maxDurationMs: 30_000 });
      return { capture, revalidation };
    }
    if (job.name === 'blogs-topic-frequencies') return topicsEnabled ? refreshTopicFrequencies(store.pool) : { skipped: 'disabled' };
    if (job.name === 'blogs-vocabulary')
      return vocabularyEnabled
        ? syncVocabulary(store.pool, { ...batchOptions, enabled: true, mode: 'window', maxPages: 10 })
        : { skipped: 'disabled' };
    if (job.name === 'blogs-history') {
      if (!historyEnabled) return { skipped: 'disabled' };
      const blogs = await selectHistoryBlogs(store.pool, 5);
      const history = createHistoryStore(store.pool);
      const results = [];
      for (const blog of blogs) {
        if (closing) break;
        try {
          const result = await runHistoryBatch(history, blog, {
            userAgent: config.crawlUserAgent,
            delayMs: config.crawlDelayMs,
            timeoutMs: 10000,
            maxPages: 5,
            maxArticles: 30,
            maxDurationMs: 45000,
          });
          results.push(result);
          if (result.status === 'busy') break;
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
          log.warn({ blogId: blog.id, code: /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'HISTORY_BATCH_FAILED' }, 'history batch failed');
          results.push({ blogId: blog.id, status: 'batch-failed' });
        }
      }
      return { count: results.length, results };
    }
    if (job.name === 'blogs-candidate-review') {
      if (!candidateReviewEnabled) return { skipped: 'disabled' };
      return runCandidateReviewBatch(store.pool, {
        apply: true,
        limit: 25,
        maxDurationMs: 120000,
        userAgent: config.crawlUserAgent,
        delayMs: config.crawlDelayMs,
        timeoutMs: 6000,
      });
    }
    if (job.name === 'blogs-missing-icons') {
      if (!missingIconsEnabled) return { skipped: 'disabled' };
      return refreshMissingBlogFavicons(store.pool, {
        limit: 10,
        maxDurationMs: 120000,
        userAgent: config.crawlUserAgent,
        delayMs: config.crawlDelayMs,
      });
    }
    if (job.name === 'blogs-discovery') {
      return discoverBlogblog(store.pool, config.crawlUserAgent);
    }
    if (job.name === 'blogs-similarweb') {
      const [domains] = (await store.pool.query(
        'SELECT canonical_host AS domain FROM blogs WHERE status="verified" AND canonical_host IS NOT NULL',
      )) as [Array<{ domain: string }>, unknown];
      const similar = await discoverSimilar(
        store.pool,
        domains.map((row) => row.domain),
        similarWeb,
      );
      return similar;
    }
    if (job.name !== 'blogs-feed') return { skipped: job.name };
    const [rows] = (await store.pool.query('SELECT id,slug,url FROM blogs WHERE status="verified" AND url IS NOT NULL ORDER BY id')) as [
      Array<{ id: number; slug: string; url: string }>,
      unknown,
    ];
    const results = [];
    for (const blog of rows) {
      if (closing) break;
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

async function close() {
  if (closing) return;
  closing = true;
  shutdown.abort();
  await worker.close();
  await queue.close();
  await connection.quit();
  await store.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => close().finally(() => process.exit(0)));
