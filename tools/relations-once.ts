import { loadConfig } from '../app/src/config.js';
import { createDb } from '../app/src/db/client.ts';
import { runRelationBatch } from '../app/src/relations/worker.ts';

const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  console.log(
    JSON.stringify(
      await runRelationBatch(db.pool, { limit: 5, maxDurationMs: 120000, userAgent: config.crawlUserAgent, delayMs: config.crawlDelayMs }),
    ),
  );
} finally {
  await db.close();
}
