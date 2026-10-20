/**
 * node --env-file=<private-env> tools/observe-sites.ts [--limit 25] [--stale-days 30]
 * Reads verified blogs' homepages (oldest observation first) into blog_site_observations, and names the author of
 * blogs that have none (crawl/site-observation.ts). The worker's blogs-site-observations job does ten an hour.
 */

import { observeSites } from '../app/src/crawl/site-observation.ts';
import { createDb } from '../app/src/db/client.ts';

const number = (flag: string, fallback: number) => {
  const at = process.argv.indexOf(flag);
  const value = at >= 0 ? Number(process.argv[at + 1]) : fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error('invalid option');
  return value;
};
let db: ReturnType<typeof createDb> | undefined;
try {
  const limit = number('--limit', 25);
  const staleDays = number('--stale-days', 30);
  db = createDb(undefined, { poolSize: 1 });
  console.log(JSON.stringify(await observeSites(db.pool, { limit, staleDays })));
} catch {
  // Driver messages can contain credentials: never print them.
  console.error(JSON.stringify({ error: 'site_observation_failed' }));
  process.exitCode = 1;
} finally {
  await db?.close();
}
