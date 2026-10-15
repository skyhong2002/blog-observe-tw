/** Small batches, resumable by --after. Only DNT homepage health GETs; no source crawl, raw text, credentials or user identifiers in output.
 * --adaptive paces itself from the homepage time and the active gateway's overview failure log: faster (bigger
 * batches up to --max-batch-size, shorter waits) while the homepage stays quick and overview reads succeed, back to
 * one post and long waits when either slips, and a 5-minute pause while the host or tag is busy.
 * A non-200 homepage ends the run. A >6.17s homepage (with --adaptive: the median of three probes) ends it too,
 * unless --cooldown-ms is set: then the backfill stops for that long, resumes at its slowest pace only once the host,
 * the homepage (median under 4.5s) and the overview log are healthy again, and ends after --max-cooldowns stops.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir, loadavg } from 'node:os';
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
  maxDelayMs = number('--max-delay-ms', 120000),
  maxBatch = number('--max-batch-size', 10),
  cooldownMs = number('--cooldown-ms', 0),
  maxCooldowns = number('--max-cooldowns', 6);
const delayOk = (ms: number) => Number.isInteger(ms) && ms >= 5000 && ms <= 3600000;
if (
  !Number.isInteger(batchSize) ||
  batchSize < 1 ||
  batchSize > 10 ||
  !Number.isInteger(maxBatch) ||
  maxBatch < batchSize ||
  maxBatch > 10 ||
  !(cooldownMs === 0 || (adaptive && delayOk(cooldownMs))) ||
  !Number.isInteger(maxCooldowns) ||
  maxCooldowns < 0 ||
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
/** `fatal`: a non-200 homepage; never cooled down and retried. */
class GateClosed extends Error {
  readonly fatal: boolean;
  constructor(fatal: boolean) {
    super('homepage_guard_closed');
    this.fatal = fatal;
  }
}
async function homepageProbe() {
  const probe = await timedGet('https://blog.observe.tw/');
  console.log(JSON.stringify({ probeUtc: new Date().toISOString(), ...probe }));
  if (probe.status !== 200) throw new GateClosed(true);
  return probe.elapsedMs;
}
/** Any non-200 closes the gate at once. With --adaptive a slow answer is re-measured twice, 15s apart,
 * and the median decides: one host-wide stall is not the backfill slowing the homepage. */
async function homepageGate() {
  const first = await homepageProbe();
  if (!adaptive || first <= SLOW_MS) {
    if (first > GATE_MS) throw new GateClosed(false);
    return first;
  }
  const samples = [first];
  for (let i = 0; i < 2; i++) {
    await delay(15000);
    samples.push(await homepageProbe());
  }
  const median = samples.sort((a, b) => a - b)[1];
  console.log(JSON.stringify({ medianMs: median }));
  if (median > GATE_MS) throw new GateClosed(false);
  return median;
}
/** Overview reads the active gateway logged as failed or degraded in the last two minutes (overview-diagnostics.ts).
 * Counts lines only; nothing from the log is printed. An unreadable log counts as one failure, never as healthy. */
function overviewFailures() {
  try {
    const { active } = JSON.parse(readFileSync(`${homedir()}/.local/share/blog-observe/edge/active.json`, 'utf8'));
    if (!/^(blue|green)$/.test(active)) return 1;
    const out = spawnSync('journalctl', ['--user', '-u', `blog-observe-gateway@${active}`, '--since', '-2min', '-o', 'cat', '--no-pager'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (out.status !== 0) return 1;
    return out.stdout.split('\n').filter((line) => line.includes('"operation":"overview"') && line.includes('"failureKind"')).length;
  } catch {
    return 1;
  }
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
/** After a cooldown: resume only when the host, the homepage median and the overview log are all healthy. */
async function healthyAgain() {
  if (await hostBusy()) return false;
  const samples = [];
  for (let i = 0; i < 3; i++) {
    if (i) await delay(15000);
    samples.push(await homepageProbe());
  }
  const median = samples.sort((a, b) => a - b)[1];
  const failures = overviewFailures();
  console.log(JSON.stringify({ recheckUtc: new Date().toISOString(), medianMs: median, overviewFailures: failures }));
  return median < SLOW_MS && failures === 0;
}
const db = createDb(undefined, { poolSize: 1 });
let cursor = after,
  count = 0,
  size = batchSize,
  wait = delayMs,
  lastProbe = 0,
  cooldowns = 0;
try {
  if (adaptive) while (await hostBusy()) await delay(BUSY_PAUSE_MS);
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
    try {
      while (await hostBusy()) {
        size = 1;
        wait = maxDelayMs;
        await delay(BUSY_PAUSE_MS);
      }
      const ms = await homepageGate();
      const failures = overviewFailures();
      lastProbe = Date.now();
      if (ms > SLOW_MS || failures > 0) {
        if (failures) console.log(JSON.stringify({ overviewFailures: failures }));
        size = 1;
        wait = Math.min(maxDelayMs, wait * 2);
      } else if (ms < QUICK_MS) {
        size = Math.min(maxBatch, size + 1);
        wait = Math.max(minDelayMs, Math.round(wait / 2));
      }
    } catch (error) {
      if (!(error instanceof GateClosed) || error.fatal || !cooldownMs || ++cooldowns > maxCooldowns) throw error;
      console.log(JSON.stringify({ cooldownUtc: new Date().toISOString(), cooldowns, resumeAfter: cursor }));
      do await delay(cooldownMs);
      while (!(await healthyAgain()));
      size = 1;
      wait = maxDelayMs;
      lastProbe = Date.now();
    }
  }
} catch {
  console.error(JSON.stringify({ error: 'fulltext_batch_failed_or_homepage_guard_closed', resumeAfter: cursor }));
  process.exitCode = 1;
} finally {
  await db.close();
}
