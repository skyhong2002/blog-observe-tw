/**
 * node --env-file=<private-env> tools/backfill-blog-tech.ts [--after-id 0] [--limit 10] [--apply]
 * Default: read-only preview. Resume with nextCursor; an exactly full last batch requires one empty batch.
 * Reads at most one existing 512 KiB HTML fragment per blog, sequentially, without HTTP or crawl budget changes.
 * observedAt AND lastAttemptAt retain content.obtained_at: this is re-analysis of stored evidence, not a new fetch.
 * Missing HTML remains not-observed; old evidence never replaces a newer attempt. Extracted fragments have partial coverage.
 */
import { createDb } from '../app/src/db/client.ts';
import { backfillBlogTechnology, parseTechBackfillArgs } from '../app/src/tech/backfill.ts';

let db: ReturnType<typeof createDb> | undefined;
try {
  const options = parseTechBackfillArgs(process.argv.slice(2));
  db = createDb(undefined, { poolSize: 1 });
  console.log(JSON.stringify(await backfillBlogTechnology(db.pool, options)));
} catch {
  // Driver messages and CLI arguments can contain credentials: never print them.
  console.error(JSON.stringify({ error: 'tech_backfill_unavailable_or_invalid_options' }));
  process.exitCode = 1;
} finally {
  await db?.close();
}
