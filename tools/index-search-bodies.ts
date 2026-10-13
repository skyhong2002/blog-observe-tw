/** Explicit <=10 existing article IDs only; dry-run by default, no network or scheduler. */
import { createDb } from '../app/src/db/client.ts';
import { produceBodySearchIndex, searchIndexPostIds } from '../app/src/search-index-producer.ts';

let db: ReturnType<typeof createDb> | undefined;
try {
  const args = process.argv.slice(2);
  const apply = args.at(-1) === '--apply';
  if (args.length !== (apply ? 3 : 2) || args[0] !== '--post-ids' || !/^\d+(,\d+)*$/.test(args[1] ?? '')) throw Error('invalid_args');
  const ids = searchIndexPostIds(args[1].split(',').map(Number));
  db = createDb(undefined, { poolSize: 1 });
  console.log(JSON.stringify(await produceBodySearchIndex(db.pool, ids, apply)));
} catch {
  console.error(JSON.stringify({ error: 'search_index_unavailable_or_invalid_selection' }));
  process.exitCode = 1;
} finally {
  await db?.close();
}
