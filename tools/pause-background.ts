import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { loadConfig } from '../app/src/config.js';

// Stop blog-observe-worker first. Never drain/obliterate a shared Redis instance.
// Only these additive jobs are unknown to releases before history import.
const config = loadConfig();
const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(config.queueName, { connection, prefix: config.queuePrefix });
const names = new Set(['blogs-history', 'blogs-candidate-review', 'blogs-missing-icons']);
try {
  if ((await queue.getActiveCount()) > 0) throw new Error('Stop blog-observe-worker and wait for active jobs before rollback cleanup.');
  for (const name of names) await queue.removeJobScheduler(name);
  let removed = 0;
  // Removing while paging changes offsets: collect matching IDs first.
  const ids: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const jobs = await queue.getJobs(['waiting', 'delayed', 'prioritized'], offset, offset + 99);
    for (const job of jobs) if (names.has(job.name) && job.id) ids.push(job.id);
    if (jobs.length < 100) break;
  }
  for (const id of ids) {
    const job = await queue.getJob(id);
    if (job && names.has(job.name)) {
      await job.remove();
      removed++;
    }
  }
  const schedulers = await queue.getJobSchedulers();
  if (schedulers.some((scheduler) => names.has(scheduler.key))) throw new Error('Background scheduler cleanup incomplete');
  console.log(JSON.stringify({ removed, schedulers: schedulers.map((scheduler) => scheduler.key) }));
} finally {
  await queue.close();
  await connection.quit();
}
