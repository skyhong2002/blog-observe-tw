import type { RowDataPacket } from 'mysql2/promise';
import { loadConfig } from '../app/src/config.js';
import { readRobots } from '../app/src/crawl/feed.ts';
import { recordRobotsObservations, robotsHost } from '../app/src/crawl/robots-observations.ts';
import { createDb } from '../app/src/db/client.ts';

// One robots.txt read per host of every verified blog and open candidate, so /blogs/ and the admin candidate list
// show a status without waiting for the next crawl or weekly review. One request per host, a few hosts at a time.
// Usage: node --env-file=… tools/robots-refresh.ts [--blogs-only] [--concurrency 6]
const args = process.argv.slice(2);
const concurrency = Math.max(1, Math.min(16, Number(args[args.indexOf('--concurrency') + 1]) || 6));
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
const recorder = recordRobotsObservations(db.pool);
try {
  const [blogs] = await db.pool.query<RowDataPacket[]>("SELECT url FROM blogs WHERE status='verified' AND url IS NOT NULL");
  const [candidates] = args.includes('--blogs-only')
    ? [[] as RowDataPacket[]]
    : await db.pool.query<RowDataPacket[]>("SELECT url FROM discovery_candidates WHERE status='candidate'");
  const homes = new Map<string, string>();
  for (const { url } of [...blogs, ...candidates]) {
    const host = robotsHost(url);
    if (host && !homes.has(host)) homes.set(host, new URL(url).origin);
  }
  const queue = [...homes.values()];
  const tally: Record<string, number> = {};
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      for (let origin = queue.shift(); origin; origin = queue.shift()) {
        const answer = await readRobots(`${origin}/`, { userAgent: config.crawlUserAgent, timeoutMs: 15_000 }).catch(() => 'error');
        tally[String(answer)] = (tally[String(answer)] ?? 0) + 1;
      }
    }),
  );
  await recorder.idle();
  console.log(JSON.stringify({ hosts: homes.size, home: tally }));
} finally {
  await db.close();
}
