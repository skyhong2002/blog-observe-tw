import { writeFile } from 'node:fs/promises';
import { loadConfig } from '../app/src/config.js';
import { runCuratedContentBatch } from '../app/src/crawl/curated-content.ts';
import { fetchCuratedMembers, runCuratedDirectorySync } from '../app/src/crawl/curated-directories.ts';
import { createDb } from '../app/src/db/client.ts';

const args = process.argv.slice(2),
  config = loadConfig();
const options = { userAgent: config.crawlUserAgent, delayMs: 1500, timeoutMs: 6000 };
if (!args.includes('--apply')) {
  const result = await fetchCuratedMembers(options);
  console.log(JSON.stringify(result, null, 2));
} else {
  const db = createDb(config.blogDbUrl, { poolSize: 4 });
  try {
    const limitAt = args.indexOf('--limit');
    const limit = limitAt < 0 ? 10 : Number(args[limitAt + 1]);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('invalid_limit');
    const result = args.includes('--content')
      ? await runCuratedContentBatch(db.pool, { ...options, limit, maxDurationMs: 600000 })
      : await runCuratedDirectorySync(db.pool, options);
    const outputAt = args.indexOf('--output');
    if (outputAt >= 0) await writeFile(args[outputAt + 1], JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify(result));
  } finally {
    await db.close();
  }
}
