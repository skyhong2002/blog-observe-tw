import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { runAiBatch } from './ai/batch.ts';
import { loadConfig } from './config.js';
import { runContentBatch } from './content/worker.ts';
import { runCandidateReviewBatch } from './crawl/candidate-review.ts';
import { deriveDirectoryHomes } from './crawl/directory-listing.ts';
import { discoverBlogblog, discoverSimilar } from './crawl/discovery.ts';
import { refreshMissingBlogFavicons } from './crawl/favicon-batch.ts';
import { crawlBlog } from './crawl/feed.ts';
import { runHistoryBatch } from './crawl/history.ts';
import { createHistoryStore, selectHistoryBlogs } from './crawl/history-store.ts';
import { createTagSimilarSitesClient } from './crawl/similarweb-client.ts';
import { createDb } from './db/client.ts';
import { runPublicationDiscoveryBatch } from './relations/home.ts';
import { runRelationSnapshotBatch } from './relations/routes.ts';
import { RELATION_STORED_PER_RUN, runRelationBatch } from './relations/worker.ts';
import { runScraperRepairBatch } from './scrapers/repair.ts';
import { indexFulltextPosts, indexMissingFulltextPosts, runFulltextBatch } from './search-fulltext.ts';
import { createIndexJobClaim, createIndexJobEnqueue, runSearchIndexJob, SEARCH_INDEX_JOB } from './search-index-job.ts';
import { backfillPublicRoutes, backfillTopicRouteAliases } from './seo/page-routes.ts';
import { createTechFetchBatch } from './tech/fetch-batch.ts';
import { runTopicsBatch } from './topics/batch.ts';
import { refreshTopicFrequencies } from './topics/frequency.ts';
import { backfillTopicHistory } from './topics/history-backfill.ts';
import { historyWritesEnabled } from './topics/history-contracts.ts';
import { revalidateTopicHistory } from './topics/history-worker.ts';
import { runSharedLabelBatch } from './topics/shared-label-job.ts';
import { syncVocabulary } from './topics/sync.ts';

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
const indexAdoptionEnabled =
  process.env.BLOG_SEARCH_INDEX_ADOPTION_ENABLED === 'true' || process.env.BLOG_SEARCH_FULLTEXT_ENABLED === 'true';
const enqueueIndex = createIndexJobEnqueue((name, data, options) => queue.add(name, data, options));
const claimIndex = createIndexJobClaim(async (key) => (await connection.set(key, 'claimed-not-indexed', 'NX')) === 'OK');
const indexOptions = {
  indexAdoptionEnabled,
  enqueueIndex,
  onIndexAdoptionReport: (report: import('./search-index-staging.ts').IndexAdoptionReport) => {
    if (indexAdoptionEnabled) log.info({ indexAdoption: report }, 'body index adoption outcome');
  },
};
const contentEnabled = process.env.BLOG_CONTENT_ENABLED === 'true';
const shutdown = new AbortController();
const missingIconsEnabled = process.env.BLOG_MISSING_FAVICONS_ENABLED !== 'false';
for (const [name, every, enabled] of [
  ['blogs-fulltext', 5 * 60_000, process.env.BLOG_SEARCH_FULLTEXT_ENABLED === 'true'],
  ['blogs-content', 5 * 60_000, contentEnabled],
  ['blogs-relation-snapshots', 5 * 60_000, process.env.BLOG_RELATION_SNAPSHOTS_ENABLED !== 'false'],
  // Each run fetches at most 5 pages; the daily budgets in relations/worker.ts bound the total and per-site load.
  ['blogs-relations', 60_000, relationsEnabled],
  ['blogs-publication-discovery', 30 * 60_000, relationsEnabled],
  ['blogs-ai', 60 * 60_000, aiEnabled],
  ['blogs-topics', 10 * 60_000, topicsEnabled],
  ['blogs-topic-history', 5 * 60_000, historyWritesEnabled()],
  ['blogs-topic-frequencies', 60 * 60_000, topicsEnabled],
  ['blogs-shared-labels', 6 * 60 * 60_000, process.env.BLOG_SHARED_LABEL_SYNC_ENABLED === 'true'],
  ['blogs-vocabulary', 15 * 60_000, vocabularyEnabled],
  ['blogs-history', 5 * 60_000, historyEnabled],
  ['blogs-candidate-review', 5 * 60_000, candidateReviewEnabled],
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
    if (
      (process.env.BLOG_SEARCH_FULLTEXT_ENABLED === 'true' && job.name === 'blogs-fulltext') ||
      (indexAdoptionEnabled && job.name === SEARCH_INDEX_JOB)
    ) {
      const start = performance.now();
      const response = await fetch(config.publicOrigin + '/', { headers: { DNT: '1' }, signal: AbortSignal.timeout(13000) });
      await response.arrayBuffer();
      if (response.status !== 200 || performance.now() - start > 6170) return { deferred: 'homepage-unhealthy' };
    }
    if (job.name === 'blogs-fulltext') {
      const cursorKey = `${config.queueName}:fulltext-cursor`;
      const after = Number((await connection.get(cursorKey)) || 0);
      const newCursorKey = `${config.queueName}:fulltext-new-cursor`;
      let newCursor = await connection.get(newCursorKey);
      if (newCursor === null) {
        const [[watermark]] = await store.pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT MAX(id) AS id FROM posts');
        newCursor = String(Number(watermark.id || 0));
        await connection.set(newCursorKey, newCursor);
      }
      const missing = await indexMissingFulltextPosts(store.pool, Number(newCursor), 5);
      await connection.set(newCursorKey, String(missing.next));
      const result = await runFulltextBatch(store.pool, { after, limit: 5, signal: shutdown.signal });
      await connection.set(cursorKey, String(result.next));
      return { processed: result.items.length, newPosts: missing.items.length, next: result.next, done: result.done };
    }
    if (job.name === SEARCH_INDEX_JOB && process.env.BLOG_SEARCH_FULLTEXT_ENABLED === 'true')
      return indexFulltextPosts(store.pool, job.data.postIds);
    if (job.name === SEARCH_INDEX_JOB)
      return runSearchIndexJob(store.pool, job.data, {
        enabled: indexAdoptionEnabled,
        claim: async () => {
          if (!job.id) return false;
          return claimIndex(`${queue.toKey(job.id)}:body-index-claimed`);
        },
      });
    if (job.name === 'blogs-content')
      return contentEnabled
        ? runContentBatch(store.pool, { ...batchOptions, indexAdoptionEnabled, enqueueIndex })
        : { skipped: 'disabled' };
    if (job.name === 'blogs-relation-snapshots') return runRelationSnapshotBatch(store.pool, batchOptions);
    if (job.name === 'blogs-publication-discovery')
      return relationsEnabled ? runPublicationDiscoveryBatch(store.pool, batchOptions) : { skipped: 'disabled' };
    if (job.name === 'blogs-relations')
      return relationsEnabled
        ? runRelationBatch(store.pool, { ...batchOptions, ...indexOptions, storedLimit: RELATION_STORED_PER_RUN })
        : { skipped: 'disabled' };
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
    if (job.name === 'blogs-shared-labels') return runSharedLabelBatch(store.pool);
    if (job.name === 'blogs-vocabulary')
      return vocabularyEnabled
        ? syncVocabulary(store.pool, { ...batchOptions, enabled: true, mode: 'window', maxPages: 10 })
        : { skipped: 'disabled' };
    if (job.name === 'blogs-history') {
      if (!historyEnabled) return { skipped: 'disabled' };
      const blogs = await selectHistoryBlogs(store.pool, 5);
      const history = createHistoryStore(store.pool, indexOptions);
      const results = [];
      for (const blog of blogs) {
        if (closing) break;
        try {
          const result = await runHistoryBatch(history, blog, {
            passiveBatch: createTechFetchBatch(store.pool, { blogId: blog.id, blogUrl: blog.url }),
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
      // BlogBlog.Club listings point at blogroll pages and party posts; queue their publication homes first.
      const directory = await deriveDirectoryHomes(store.pool);
      if (directory.inspected) log.info({ directory }, 'directory homes derived');
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
        results.push(
          await crawlBlog(store, blog, {
            ...indexOptions,
            userAgent: config.crawlUserAgent,
            delayMs: config.crawlDelayMs,
            passiveBatch: createTechFetchBatch(store.pool, { blogId: blog.id, blogUrl: blog.url }),
          }),
        );
      } catch (error) {
        log.warn({ blog: blog.slug, error: error instanceof Error ? error.message : String(error) }, 'blog crawl failed');
      }
    }
    return { count: results.length, results };
  },
  { connection, prefix: config.queuePrefix, concurrency: 1 },
);
// Generating a scraper waits minutes on the model, so it has its own queue, worker and pool: the crawl queue keeps
// moving, and a held repair lease cannot take the crawl worker's last connection.
const scraperRepairEnabled = process.env.BLOG_SCRAPER_GENERATION_ENABLED === 'true';
const scraperQueueName = `${config.queueName}-scrapers`;
const scraperQueue = new Queue(scraperQueueName, { connection, prefix: config.queuePrefix });
const scraperStore = scraperRepairEnabled ? createDb(config.blogDbUrl, { poolSize: 2 }) : null;
if (scraperRepairEnabled)
  await scraperQueue.upsertJobScheduler(
    'blogs-scraper-repair',
    { every: 30 * 60_000 },
    { name: 'blogs-scraper-repair', data: {}, opts: { removeOnComplete: 20, removeOnFail: 20 } },
  );
else await scraperQueue.removeJobScheduler('blogs-scraper-repair');
const scraperWorker = scraperStore
  ? new Worker(
      scraperQueueName,
      async () => {
        const outcome = await runScraperRepairBatch(scraperStore.pool, {
          apply: true,
          signal: shutdown.signal,
          userAgent: config.crawlUserAgent,
          delayMs: config.crawlDelayMs,
          timeoutMs: 15000,
        });
        const { generation, ...summary } = outcome;
        if (outcome.target) log.info({ scraperRepair: { ...summary, rounds: generation?.rounds } }, 'scraper repair outcome');
        return summary;
      },
      { connection, prefix: config.queuePrefix, concurrency: 1, lockDuration: 120000 },
    )
  : null;
scraperWorker?.on('failed', (job, error) => log.error({ job: job?.name, error: error.message }, 'scraper repair job failed'));
worker.on('completed', (job) => log.info({ job: job.name }, 'blog worker job completed'));
worker.on('failed', (job, error) => log.error({ job: job?.name, error: error.message }, 'blog worker job failed'));

async function close() {
  if (closing) return;
  closing = true;
  shutdown.abort();
  await worker.close();
  await scraperWorker?.close();
  await scraperQueue.close();
  await scraperStore?.close();
  await queue.close();
  await connection.quit();
  await store.close();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => close().finally(() => process.exit(0)));
