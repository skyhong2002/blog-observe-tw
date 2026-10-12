/** Resumable, budgeted shadow-index rebuild. Raw terms/bodies and the old index are never modified. */
import { setTimeout as delay } from 'node:timers/promises';
import { createDb } from '../app/src/db/client.ts';
import { runTopicsBatch } from '../app/src/topics/batch.ts';
import { topicBodyHash, topicBodyJoins } from '../app/src/topics/body.ts';
import { MATCHER_VERSION } from '../app/src/topics/policy.ts';
import { SOURCE } from '../app/src/topics/snapshot-client.ts';

const maintenance = process.argv.includes('--maintenance');
const args = process.argv.slice(2).filter((arg) => arg !== '--maintenance');
if (args.length !== 2 || args[0] !== '--since' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(args[1]))
  throw Error('usage: node --env-file=<private-env> tools/reindex-topics.ts --since <UTC-ISO-timestamp>');
const since = new Date(args[1]);
if (!Number.isFinite(since.getTime())) throw Error('invalid_since');
const store = createDb(undefined, { poolSize: 2 });
let processed = 0;
try {
  for (let batch = 0; batch < 200; batch++) {
    const result = await runTopicsBatch(store.pool, { maintenance, since, limit: 100, maxDurationMs: 60000 });
    processed += result.processed;
    const [[pending]] = await store.pool.query<import('mysql2/promise').RowDataPacket[]>(
      `SELECT COUNT(*) n FROM posts p JOIN blogs b ON b.id=p.blog_id ${topicBodyJoins}
       JOIN topic_current c ON c.source=? LEFT JOIN topic_post_indexes_v3 i ON i.post_id=p.id AND i.snapshot_id=c.snapshot_id
       WHERE b.status<>'moved' AND p.published_at>=? AND (i.post_id IS NULL OR i.snapshot_id<>c.snapshot_id
       OR i.matcher_version<>? OR i.needs_refresh=1 OR NOT(i.post_hash<=>p.content_hash) OR NOT(i.body_hash<=>(${topicBodyHash})))`,
      [SOURCE, since, MATCHER_VERSION],
    );
    console.log(JSON.stringify({ batch: batch + 1, processed, remaining: Number(pending.n), since: since.toISOString(), result }));
    if (!Number(pending.n)) break;
    if (!result.processed || batch === 199) {
      process.exitCode = 2;
      break;
    }
    await delay(500);
  }
} finally {
  await store.close();
}
