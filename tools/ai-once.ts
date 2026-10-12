import { runAiBatch } from '../app/src/ai/batch.ts';
import { loadConfig } from '../app/src/config.js';
import { createDb } from '../app/src/db/client.ts';

const db = createDb(loadConfig().blogDbUrl, { poolSize: 2 });
try {
  console.log(JSON.stringify(await runAiBatch(db.pool, { limit: 3, maxDurationMs: 120000 })));
} finally {
  await db.close();
}
