import { loadConfig } from '../app/src/config.js';
import { runCandidateReviewBatch } from '../app/src/crawl/candidate-review.ts';
import { createDb } from '../app/src/db/client.ts';

const args = process.argv.slice(2);
const value = (flag: string, fallback: number) => {
  const i = args.indexOf(flag);
  const n = i < 0 ? fallback : Number(args[i + 1]);
  if (!Number.isSafeInteger(n) || n < 1) throw Error(`invalid ${flag}`);
  return n;
};
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  console.log(
    JSON.stringify(
      await runCandidateReviewBatch(db.pool, {
        apply: args.includes('--apply'),
        limit: value('--limit', 25),
        maxDurationMs: value('--minutes', 10) * 60000,
        userAgent: config.crawlUserAgent,
        delayMs: 1500,
        timeoutMs: 6000,
      }),
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
