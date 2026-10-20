/**
 * node --env-file=<private-env> tools/discover-indieping.ts [--max-queries 2000]
 * Walks IndiePing's member list through its per-domain query (crawl/indieping.ts) at half its rate limit, adding new
 * members as `indieping` candidates. Prints one JSON line per added home or wait, then the totals.
 */
import { loadConfig } from '../app/src/config.js';
import { discoverIndieping } from '../app/src/crawl/indieping.ts';
import { createDb } from '../app/src/db/client.ts';

const at = process.argv.indexOf('--max-queries');
const maxQueries = at >= 0 ? Number(process.argv[at + 1]) : 2000;
if (!Number.isInteger(maxQueries) || maxQueries < 1) throw new Error('invalid --max-queries');
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 1 });
const stop = new AbortController();
process.once('SIGTERM', () => stop.abort());
try {
  const result = await discoverIndieping(db.pool, {
    maxQueries,
    signal: stop.signal,
    userAgent: config.crawlUserAgent,
    log: (event) => console.log(JSON.stringify({ at: new Date().toISOString(), ...event })),
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), done: true, ...result }));
} catch {
  // Driver messages can contain credentials: never print them.
  console.error(JSON.stringify({ error: 'indieping_discovery_failed' }));
  process.exitCode = 1;
} finally {
  await db.close();
}
