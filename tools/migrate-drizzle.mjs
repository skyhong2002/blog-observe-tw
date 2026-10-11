import { readdir, readFile } from 'node:fs/promises';
import { createDb } from '../app/src/db/client.ts';

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
  await store.pool.query(
    'CREATE TABLE IF NOT EXISTS _blog_observe_migrations (id varchar(255) NOT NULL PRIMARY KEY, applied_at datetime NOT NULL)',
  );
  const [rows] = await store.pool.query('SELECT TABLE_NAME AS name FROM information_schema.tables WHERE table_schema = DATABASE()');
  const found = new Set(rows.map((row) => row.name));
  const missing = expected.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`blog_observe baseline is missing tables: ${missing.join(', ')}`);
  await store.pool.execute(
    "INSERT IGNORE INTO _blog_observe_migrations (id, applied_at) VALUES ('0000_blog_observe_baseline', UTC_TIMESTAMP())",
  );
  const [appliedRows] = await store.pool.query('SELECT id FROM _blog_observe_migrations');
  const applied = new Set(appliedRows.map((row) => row.id));
  const dir = new URL('../app/src/db/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  const appliedNow = [];
  for (const file of files) {
    const id = file.replace(/\.sql$/, '');
    if (applied.has(id) || id === '0000_blog_observe_baseline') continue;
    const sql = await readFile(new URL(file, dir), 'utf8');
    const connection = await store.pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of sql
        .split(/--> statement-breakpoint/)
        .map((part) => part.trim())
        .filter(Boolean))
        await connection.query(statement);
      await connection.execute('INSERT INTO _blog_observe_migrations (id, applied_at) VALUES (?, UTC_TIMESTAMP())', [id]);
      await connection.commit();
      appliedNow.push(id);
    } catch (error) {
      await connection.rollback();
      throw new Error(`migration ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      connection.release();
    }
  }
  console.log(JSON.stringify({ baseline: '0000_blog_observe_baseline', applied: appliedNow, verifiedTables: expected.length }));
} finally {
  await store.close();
}
