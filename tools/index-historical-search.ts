/** Small batches, resumable by --after. Only DNT homepage health GETs; no source crawl, raw text, credentials or user identifiers in output.
 * --adaptive paces itself from the homepage time: faster (bigger batches, shorter waits) while the homepage stays
 * quick, back to one post and long waits when it slows, and a 5-minute pause while the host or tag is busy.
 * A non-200 or >6.17s homepage still ends the run without retrying.
 */
import { loadavg } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { createDb } from '../app/src/db/client.ts';
import { runFulltextBatch } from '../app/src/search-fulltext.ts';

const args = process.argv.slice(2);
const number = (key: string, fallback: number) => (args.includes(key) ? Number(args[args.indexOf(key) + 1]) : fallback);
const max = number('--batches', 1),
  after = number('--after', 0),
  batchSize = number('--batch-size', 1),
  delayMs = number('--delay-ms', 60000),
  adaptive = args.includes('--adaptive'),
  minDelayMs = number('--min-delay-ms', 5000),
  maxDelayMs = number('--max-delay-ms', 120000);
const delayOk = (ms: number) => Number.isInteger(ms) && ms >= 5000 && ms <= 3600000;
if (
  !Number.isInteger(batchSize) ||
  batchSize < 1 ||
  batchSize > 10 ||
  ![delayMs, minDelayMs, maxDelayMs].every(delayOk) ||
  minDelayMs > maxDelayMs ||
  !Number.isInteger(max) ||
  max < 1 ||
  max > 20000 ||
  !Number.isSafeInteger(after) ||
  after < 0
)
  throw Error('invalid_fulltext_run');
/** Homepage gates; adaptive steps between them. */
const GATE_MS = 6170,
  SLOW_MS = 4500,
  QUICK_MS = 3000,
  PROBE_EVERY_MS = 60000,
  BUSY_LOAD = 12,
  TAG_SLOW_MS = 2000,
  BUSY_PAUSE_MS = 300000;
async function timedGet(url: string) {
  const start = performance.now();
  const r = await fetch(url, { headers: { DNT: '1' }, signal: AbortSignal.timeout(13000) });
  const bytes = (await r.arrayBuffer()).byteLength;
  return { status: r.status, elapsedMs: performance.now() - start, bytes, cfCacheStatus: r.headers.get('cf-cache-status') };
}
async function homepageGate() {
  const probe = await timedGet('https://blog.observe.tw/');
  console.log(JSON.stringify({ probeUtc: new Date().toISOString(), ...probe }));
  if (probe.status !== 200 || probe.elapsedMs > GATE_MS) throw Error('homepage_guard_closed');
  return probe.elapsedMs;
}
/** Other sites on this host come first: high load or a slow tag homepage pauses the backfill. */
async function hostBusy() {
  const load1 = loadavg()[0];
  const tag = await timedGet('https://tag.observe.tw/').catch(() => null);
  const busy = load1 > BUSY_LOAD || !tag || tag.status !== 200 || tag.elapsedMs > TAG_SLOW_MS;
  if (busy)
    console.log(
      JSON.stringify({ pausedUtc: new Date().toISOString(), load1, tagStatus: tag?.status ?? null, tagMs: tag?.elapsedMs ?? null }),
    );
  return busy;
}
const db = createDb(undefined, { poolSize: 1 });
let cursor = after,
  count = 0,
  size = batchSize,
  wait = delayMs,
  lastProbe = 0;
try {
  await homepageGate();
  lastProbe = Date.now();
  for (let n = 0; n < max; n++) {
    const result = await runFulltextBatch(db.pool, { after: cursor, limit: size });
    cursor = result.next;
    count += result.items.length;
    console.log(
      JSON.stringify({ batch: n + 1, size, waitMs: wait, indexed: result.items.length, total: count, next: cursor, done: result.done }),
    );
    if (result.done) break;
    await delay(wait);
    if (!adaptive) {
      await homepageGate();
      continue;
    }
    if (Date.now() - lastProbe < PROBE_EVERY_MS) continue;
    while (await hostBusy()) {
      size = 1;
      wait = maxDelayMs;
      await delay(BUSY_PAUSE_MS);
    }
    const ms = await homepageGate();
    lastProbe = Date.now();
    if (ms > SLOW_MS) {
      size = 1;
      wait = Math.min(maxDelayMs, wait * 2);
    } else if (ms < QUICK_MS) {
      size = Math.min(10, size + 1);
      wait = Math.max(minDelayMs, Math.round(wait / 2));
    }
  }
} catch {
  console.error(JSON.stringify({ error: 'fulltext_batch_failed_or_homepage_guard_closed', resumeAfter: cursor }));
  process.exitCode = 1;
} finally {
  await db.close();
}
