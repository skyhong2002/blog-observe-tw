/** Small batches, resumable by --after. No HTTP, raw text, credentials or user identifiers in output. */
import { setTimeout as delay } from 'node:timers/promises';
import { createDb } from '../app/src/db/client.ts';
import { runFulltextBatch } from '../app/src/search-fulltext.ts';
const args = process.argv.slice(2);
const number = (key: string, fallback: number) => (args.includes(key) ? Number(args[args.indexOf(key) + 1]) : fallback);
const max = number('--batches', 1),
  after = number('--after', 0);
if (!Number.isInteger(max) || max < 1 || max > 2000 || !Number.isSafeInteger(after) || after < 0) throw Error('invalid_fulltext_run');
const db = createDb(undefined, { poolSize: 1 });
let cursor = after,
  count = 0;
try {
  for (let n = 0; n < max; n++) {
    const result = await runFulltextBatch(db.pool, { after: cursor, limit: 50 });
    cursor = result.next;
    count += result.items.length;
    console.log(JSON.stringify({ batch: n + 1, indexed: result.items.length, total: count, next: cursor, done: result.done }));
    if (result.done) break;
    await delay(1000);
  }
} catch {
  console.error(JSON.stringify({ error: 'fulltext_batch_failed', resumeAfter: cursor }));
  process.exitCode = 1;
} finally {
  await db.close();
}
