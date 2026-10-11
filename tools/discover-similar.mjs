import { createDb } from "../src/db.mjs";
import { discoverSimilarSites } from "../src/discovery.mjs";
const store = createDb();
try {
  const [rows] = await store.pool.execute("SELECT canonical_host FROM blogs WHERE status='verified' AND canonical_host IS NOT NULL");
  console.log(JSON.stringify(await discoverSimilarSites({ ...store, domains: rows.map((row) => row.canonical_host) }), null, 2));
} finally { await store.close(); }
