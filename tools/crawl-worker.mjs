import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { createDb } from "../src/db.mjs";
import { crawlBlog } from "../src/feed.mjs";

const redisUrl = process.env.BLOG_REDIS_URL || "redis://127.0.0.1:17379";
const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
const queueName = "blog-observe-crawl";
const queue = new Queue(queueName, { connection, prefix: "blog-observe" });
const store = createDb();
const interval = Number(process.env.BLOG_CRAWL_INTERVAL_MS || 21600000);

await queue.upsertJobScheduler("blog-crawl-all", { every: interval }, { name: "crawl-all", data: {}, opts: { removeOnComplete: 50, removeOnFail: 50 } });
const worker = new Worker(queueName, async (job) => {
  const [blogs] = await store.pool.execute("SELECT id,slug,name,url FROM blogs WHERE status='verified' AND url IS NOT NULL ORDER BY id");
  const results = [];
  for (const blog of blogs) {
    try { results.push(await crawlBlog(store, blog)); }
    catch (error) { results.push({ blog: blog.slug, error: error instanceof Error ? error.message : "unknown error" }); }
  }
  return { jobId: job.id, results };
}, { connection, prefix: "blog-observe", concurrency: 1 });

worker.on("completed", (job, result) => console.log(JSON.stringify({ event: "crawl-complete", jobId: job.id, result })));
worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "crawl-failed", jobId: job?.id, error: error.message })));
console.log(JSON.stringify({ event: "worker-ready", queue: queueName, redis: redisUrl.split("@").at(-1), interval }));
const close = async () => { await worker.close(); await queue.close(); await store.close(); await connection.quit(); process.exit(0); };
process.on("SIGTERM", close);
process.on("SIGINT", close);
