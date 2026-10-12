import { loadConfig } from '../app/src/config.js';
import { runContentBatch } from '../app/src/content/worker.ts';
import { createDb } from '../app/src/db/client.ts';

const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  console.log(
    JSON.stringify(
      await runContentBatch(db.pool, {
        limit: 5,
        maxDurationMs: 120000,
        userAgent: config.crawlUserAgent,
        delayMs: config.crawlDelayMs,
      }),
    ),
  );
} finally {
  await db.close();
}
