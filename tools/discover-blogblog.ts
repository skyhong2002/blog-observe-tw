import { loadConfig } from '../app/src/config.js';
import { discoverBlogblog } from '../app/src/crawl/discovery.ts';
import { createDb } from '../app/src/db/client.ts';

const config = loadConfig();
const store = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  console.log(JSON.stringify(await discoverBlogblog(store.pool, config.crawlUserAgent), null, 2));
} finally {
  await store.close();
}
