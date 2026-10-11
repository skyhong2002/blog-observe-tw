import { createDb } from '../app/src/db/client.ts';

// The 0000 migration is an intentionally empty baseline: blog_observe was
// provisioned by db/001_init.sql before Drizzle. Never run CREATE/ALTER against
// the live database from this command. Future migrations must be additive and
// explicitly reviewed in a clone first.
const expected = [
  'blogs',
  'blog_urls',
  'seed_records',
  'feed_sources',
  'posts',
  'users',
  'user_sessions',
  'user_follows',
  'discovery_candidates',
  'blog_links',
];
const store = createDb();
try {
  const [rows] = await store.pool.query('SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
  const found = new Set(rows.map((row) => row.name));
  const missing = expected.filter((name) => !found.has(name));
  if (missing.length)
    throw new Error(`blog_observe baseline is missing tables: ${missing.join(', ')}; provision with db/001_init.sql after review`);
  console.log(JSON.stringify({ baseline: '0000_blog_observe_baseline', applied: false, verifiedTables: expected.length, missing: [] }));
} finally {
  await store.close();
}
