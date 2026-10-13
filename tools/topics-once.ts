import { loadConfig } from '../app/src/config.js';
import { createDb } from '../app/src/db/client.ts';
import { runTopicsBatch } from '../app/src/topics/batch.ts';
import { syncVocabulary } from '../app/src/topics/sync.ts';

const args = process.argv.slice(2);
if (args.includes('--full-snapshot')) throw Error('Deprecated --full-snapshot refused; use explicit --full source/payload/contract flags');
const full = args.includes('--full');
if (
  full &&
  (!args.includes('--sync') ||
    !args.includes('--source=large5000') ||
    !args.includes('--payload=single-copy-v1') ||
    !args.includes('--contract=tag-a89908a-large5000-compact-v1'))
)
  throw Error(
    'Full mode requires explicit --sync --full --source=large5000 --payload=single-copy-v1 --contract=tag-a89908a-large5000-compact-v1; this is not staging permission',
  );
// Admission is an operator prerequisite, not staging permission; do not configure it implicitly.
if (full && process.env.BLOG_VOCABULARY_FULL_STAGE_ADMITTED !== 'true') {
  console.log(JSON.stringify({ status: 'disabled', reason: 'full-stage-not-admitted', becameCurrent: false }));
  process.exit(0);
}
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  if (args.includes('--sync'))
    console.log(
      JSON.stringify(
        await syncVocabulary(db.pool, {
          enabled: true,
          mode: full ? 'full' : 'window',
          full: full
            ? { sourceMode: 'large5000', payloadMode: 'single-copy-v1', largeContract: 'tag-a89908a-large5000-compact-v1' }
            : undefined,
        }),
      ),
    );
  else console.log(JSON.stringify(await runTopicsBatch(db.pool, { limit: 200 })));
} finally {
  await db.close();
}
