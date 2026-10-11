import { loadConfig } from '../app/src/config.js';
import { crawlBlog } from '../app/src/crawl/feed.ts';
import { createDb } from '../app/src/db/client.ts';

const config = loadConfig();
const historyImport = process.argv.includes('--history');
const store = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  const [rows] = (await store.pool.query('SELECT id,slug,url FROM blogs WHERE status="verified" AND url IS NOT NULL ORDER BY id')) as [
    Array<{ id: number; slug: string; url: string }>,
    unknown,
  ];
  for (const blog of rows)
    console.log(
      JSON.stringify(await crawlBlog(store, blog, { userAgent: config.crawlUserAgent, delayMs: config.crawlDelayMs, historyImport })),
    );
} finally {
  await store.close();
}
