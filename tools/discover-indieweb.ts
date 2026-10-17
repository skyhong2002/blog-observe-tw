import { loadConfig } from '../app/src/config.js';
import { discoverIndieweb } from '../app/src/crawl/indieweb.ts';
import { createDb } from '../app/src/db/client.ts';

// Adds IndieWeb wiki members as `indieweb-wiki` candidates (the worker also runs this weekly with the directory crawl).
const config = loadConfig();
const db = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  console.log(JSON.stringify(await discoverIndieweb(db.pool, { userAgent: config.crawlUserAgent })));
} finally {
  await db.close();
}
