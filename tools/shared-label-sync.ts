/** Manual background producer only. Default dry-run never opens DB or HTTP. */
import { lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { createDb } from '../app/src/db/client.ts';
import { isPublicSharedLabelTopic } from '../app/src/topics/shared-label-selection.ts';
import { sharedLabelSyncClientFactory, sharedLabelSyncExitCode, syncSharedLabels } from '../app/src/topics/shared-label-sync.ts';

const args = process.argv.slice(2);
if (
  ![2, 3].includes(args.length) ||
  args[0] !== '--selection' ||
  (args.length === 3 && args[2] !== '--apply') ||
  basename(args[1]).startsWith('.env')
)
  throw Error('invalid_shared_label_arguments');
const stat = await lstat(args[1]);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw Error('invalid_shared_label_selection');
const bytes = await readFile(args[1]);
if (bytes.byteLength > 4096) throw Error('invalid_shared_label_selection');
const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
if (
  !Array.isArray(raw) ||
  raw.length > 10 ||
  new Set(raw).size !== raw.length ||
  raw.some(
    (label) => typeof label !== 'string' || !label || [...label].length > 60 || label !== label.trim() || /[\p{Cc}\p{Cs}]/u.test(label),
  )
)
  throw Error('invalid_shared_label_selection');
const selection = raw as string[];
if (args[2] !== '--apply') console.log(JSON.stringify({ mode: 'dry-run', selected: selection.length, networkRequests: 0, applied: false }));
else if (process.env.BLOG_SHARED_LABEL_SYNC_ENABLED !== 'true')
  console.log(JSON.stringify({ mode: 'disabled', selected: selection.length, networkRequests: 0, applied: false }));
else {
  const db = createDb(undefined, { poolSize: 4 });
  try {
    const result = await syncSharedLabels(
      db.pool,
      selection,
      { validatePublicLabel: (label) => isPublicSharedLabelTopic(db.pool, label), makeClient: sharedLabelSyncClientFactory(fetch) },
      { apply: true, enabled: true, dailyLimit: 40 },
    );
    console.log(JSON.stringify(result));
    process.exitCode = sharedLabelSyncExitCode(result);
  } catch {
    console.error(JSON.stringify({ mode: 'apply', status: 'unavailable' }));
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
