import { loadConfig } from '../app/src/config.js';
import { discoverSimilar } from '../app/src/crawl/discovery.ts';
import { createTagSimilarSitesClient } from '../app/src/crawl/similarweb-client.ts';
import { createDb } from '../app/src/db/client.ts';

const config = loadConfig();
const store = createDb(config.blogDbUrl, { poolSize: 2 });
try {
  const [rows] = (await store.pool.query(
    'SELECT canonical_host AS domain FROM blogs WHERE status="verified" AND canonical_host IS NOT NULL',
  )) as [Array<{ domain: string }>, unknown];
  console.log(
    JSON.stringify(
      await discoverSimilar(
        store.pool,
        rows.map((row) => row.domain),
        { ...config.similarWeb, client: createTagSimilarSitesClient() },
      ),
      null,
      2,
    ),
  );
} finally {
  await store.close();
}
