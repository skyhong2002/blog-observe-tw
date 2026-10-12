import { createDb } from '../app/src/db/client.ts';
import { backfillTopicHistory } from '../app/src/topics/history-backfill.ts';

const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const store = createDb();
try {
  console.log(
    JSON.stringify(
      await backfillTopicHistory(store.pool, {
        enabled: args.includes('--enabled') ? true : undefined,
        snapshotId: value('--snapshot'),
        limit: value('--limit') ? Number(value('--limit')) : undefined,
        maxDurationMs: value('--duration-ms') ? Number(value('--duration-ms')) : undefined,
      }),
    ),
  );
} catch {
  console.error('topic_history_backfill_failed');
  process.exitCode = 1;
} finally {
  await store.close();
}
