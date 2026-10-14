/** Small batches, resumable by --after. Only a DNT homepage health GET; no source crawl, raw text, credentials or user identifiers in output. */
import { setTimeout as delay } from 'node:timers/promises';
import { createDb } from '../app/src/db/client.ts';
import { runFulltextBatch } from '../app/src/search-fulltext.ts';
const args = process.argv.slice(2);
const number = (key: string, fallback: number) => (args.includes(key) ? Number(args[args.indexOf(key) + 1]) : fallback);
const max = number('--batches', 1),
  after = number('--after', 0),
  batchSize = number('--batch-size', 1),
  delayMs = number('--delay-ms', 60000);
if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10 || !Number.isInteger(delayMs) || delayMs < 5000 || delayMs > 3600000 || !Number.isInteger(max) || max < 1 || max > 2000 || !Number.isSafeInteger(after) || after < 0) throw Error('invalid_fulltext_run');
async function homepageGate() {
  const start = performance.now();
  const r = await fetch('https://blog.observe.tw/', { headers: { DNT: '1' }, signal: AbortSignal.timeout(13000) });
  const bytes = (await r.arrayBuffer()).byteLength;
  const elapsedMs = performance.now() - start;
  console.log(
    JSON.stringify({
      probeUtc: new Date().toISOString(),
      status: r.status,
      elapsedMs,
      bytes,
      cfCacheStatus: r.headers.get('cf-cache-status'),
    }),
  );
  if (r.status !== 200 || elapsedMs > 6170) throw Error('homepage_guard_closed');
}
const db = createDb(undefined, { poolSize: 1 });
let cursor = after,
  count = 0;
try {
  await homepageGate();
  for (let n = 0; n < max; n++) {
    const result = await runFulltextBatch(db.pool, { after: cursor, limit: batchSize });
    cursor = result.next;
    count += result.items.length;
    console.log(JSON.stringify({ batch: n + 1, indexed: result.items.length, total: count, next: cursor, done: result.done }));
    if (result.done) break;
    await delay(delayMs);
    await homepageGate();
  }
} catch {
  console.error(JSON.stringify({ error: 'fulltext_batch_failed_or_homepage_guard_closed', resumeAfter: cursor }));
  process.exitCode = 1;
} finally {
  await db.close();
}
