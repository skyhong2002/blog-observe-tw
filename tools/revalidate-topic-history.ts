import { createDb } from '../app/src/db/client.ts';
import { revalidateTopicHistory } from '../app/src/topics/history-worker.ts';

const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const store = createDb();
try {
  console.log(
    JSON.stringify(
      await revalidateTopicHistory(store.pool, {
        enabled: args.includes('--enabled') ? true : undefined,
        limit: value('--limit') ? Number(value('--limit')) : undefined,
        maxDurationMs: value('--duration-ms') ? Number(value('--duration-ms')) : undefined,
      }),
    ),
  );
} catch {
  console.error('topic_history_revalidation_failed');
  process.exitCode = 1;
} finally {
  await store.close();
}
