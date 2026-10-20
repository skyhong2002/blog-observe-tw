/**
 * node --env-file=<private-env> tools/clean-author-names.ts [--apply]
 * Default: read-only preview (counts only; no names or addresses are printed). --apply repairs the rows.
 * Strips addresses and placeholders from crawler-written author rows and posts.author (crawl/author-name.ts).
 */

import { applyAuthorCleanup, planAuthorCleanup } from '../app/src/crawl/author-cleanup.ts';
import { createDb } from '../app/src/db/client.ts';

let db: ReturnType<typeof createDb> | undefined;
try {
  const apply = process.argv.includes('--apply');
  db = createDb(undefined, { poolSize: 1 });
  const plan = await planAuthorCleanup(db.pool);
  const summary = {
    renamed: plan.renamed.length,
    merged: plan.merged.length,
    rejected: plan.rejected.length,
    posts: plan.posts.reduce((sum, group) => sum + group.ids.length, 0),
    applied: apply,
  };
  if (apply) await applyAuthorCleanup(db.pool, plan);
  console.log(JSON.stringify(summary));
} catch {
  // Driver messages can contain credentials: never print them.
  console.error(JSON.stringify({ error: 'author_cleanup_failed' }));
  process.exitCode = 1;
} finally {
  await db?.close();
}
