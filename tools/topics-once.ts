import { loadConfig } from '../app/src/config.js';
import { createDb } from '../app/src/db/client.ts';
import { runTopicsBatch } from '../app/src/topics/batch.ts';
import { syncVocabulary } from '../app/src/topics/sync.ts';

const args = process.argv.slice(2);
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  if (args.includes('--sync'))
    console.log(
      JSON.stringify(await syncVocabulary(db.pool, { enabled: true, mode: args.includes('--full-snapshot') ? 'snapshot' : 'window' })),
    );
  else console.log(JSON.stringify(await runTopicsBatch(db.pool, { limit: 200 })));
} finally {
  await db.close();
}
