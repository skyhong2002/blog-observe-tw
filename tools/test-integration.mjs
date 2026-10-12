/** Explicit private clone credentials only. Never load .env or reuse the clone's existing database. */
import { randomBytes } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import mysql from 'mysql2/promise';
import { createDb, parseDbUrl } from '../app/src/db/client.ts';

let control;
let store;
let created = false;
let phase = 'configuration';
const name = `blog_observe_integration_${randomBytes(12).toString('hex')}`;
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--env-file') throw Error('explicit_private_clone_env_required');
  const file = resolve(process.argv[3]);
  if (basename(file) === '.env' || basename(file) === '.env.production') throw Error('production_env_prohibited');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077 || stat.uid !== process.getuid())
    throw Error('private_owned_file_required');
  const url = parseEnv(await readFile(file, 'utf8')).BLOG_DB_URL;
  if (!url) throw Error('clone_database_url_required');
  const parsed = new URL(url);
  if (parsed.protocol !== 'mysql:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '18169' || parsed.search || parsed.hash)
    throw Error('isolated_loopback_18169_required');
  const options = parseDbUrl(url);
  control = await mysql.createConnection({ ...options, database: undefined, charset: 'utf8mb4', connectTimeout: 5000 });
  phase = 'create-disposable-database';
  await control.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  created = true;
  parsed.pathname = `/${name}`;
  process.env.BLOG_DB_URL = parsed.href;
  // Fixture suites inject their HTTP adapters; accidental direct global network is an error.
  globalThis.fetch = async () => {
    throw Error('integration_external_network_forbidden');
  };
  store = createDb(parsed.href, { poolSize: 8 });
  phase = 'migrations';
  const baseline = await readFile(new URL('../db/001_init.sql', import.meta.url), 'utf8');
  for (const statement of baseline
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean))
    await store.pool.query(statement);
  const dir = new URL('../app/src/db/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.startsWith('0000_')).sort();
  for (const file of files) {
    phase = `migration:${file}`;
    for (const sql of (await readFile(new URL(file, dir), 'utf8'))
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean))
      await store.pool.query(sql);
  }
  const suites = [
    ['budgets-ai', '../tests/integration/core.mjs', 'runCoreIntegration'],
    ['candidates', '../tests/integration/candidates.mjs', 'runCandidateIntegration'],
    ['relations', '../app/src/relations/integration.ts', 'runRelationIntegration'],
    ['relation-visibility', '../app/src/relations/visibility.integration.ts', 'runRelationVisibilityIntegration'],
    ['relations-quality', '../app/src/relations/quality.integration.ts', 'runRelationQualityIntegration'],
    ['topics', '../tests/integration/topics.mjs', 'runTopicsIntegration'],
    ['topic-frequency', '../app/src/topics/frequency.integration.ts', 'runTopicFrequencyIntegration'],
    ['index-carry', '../app/src/topics/index-carry.integration.ts', 'runIndexCarryIntegration'],
    ['window-incremental', '../app/src/topics/window-incremental.integration.ts', 'runWindowIncrementalIntegration'],
    ['snapshot-retention', '../app/src/topics/snapshot-retention.integration.ts', 'runSnapshotRetentionIntegration'],
    ['topic-capacity', '../app/src/topics/capacity.integration.ts', 'runTopicCapacityIntegration'],
    ['snapshot-import', '../app/src/topics/snapshot.integration.ts', 'runSnapshotImportIntegration'],
    ['topics-ranking', '../app/src/topics/ranking.integration.ts', 'runTopicRankingIntegration'],
    ['topics-quality', '../app/src/topics/integration.ts', 'runTopicsQualityIntegration'],
    ['content-topics', '../app/src/topics/content.integration.ts', 'runContentTopicsIntegration'],
    ['content-feed', '../app/src/crawl/feed-content.integration.ts', 'runFeedContentIntegration'],
    ['content', '../app/src/content/content.integration.ts', 'runContentIntegration'],
    ['public-api', '../app/src/public-api/integration.ts', 'runPublicApiIntegration'],
    ['api-keys', '../app/src/reader/api-keys.integration.ts', 'runApiKeyIntegration'],
    ['admin', '../tests/integration/admin.mjs', 'runAdminIntegration'],
  ];
  for (const [label, module, entry] of suites) {
    phase = label;
    const result = await (await import(module))[entry](store.pool);
    console.log(JSON.stringify({ suite: label, passed: true, result }));
  }
  console.log(JSON.stringify({ passed: true, suites: suites.length, migrations: files.length, isolatedPort: 18169 }));
} catch (error) {
  // Database driver errors can contain SQL or connection credentials. Only a fixed phase and bounded error code leave this process.
  const code =
    error && typeof error === 'object' && typeof error.code === 'string' && /^[A-Z_0-9]{1,60}$/.test(error.code)
      ? error.code
      : 'INTEGRATION_FAILED';
  const location = String(error?.stack || '')
    .split('\n')
    .find((line) => /(?:tests\/integration\/|app\/src\/[^/]+\/[^/]*integration)/.test(line))
    ?.replace(process.cwd(), '<repo>');
  console.error(JSON.stringify({ passed: false, phase, code, location }));
  process.exitCode = 1;
} finally {
  if (store) await store.close();
  if (control) {
    try {
      if (created) await control.query(`DROP DATABASE \`${name}\``);
    } catch {
      console.error('disposable_database_cleanup_failed');
      process.exitCode = 1;
    }
    await control.end();
  }
}
