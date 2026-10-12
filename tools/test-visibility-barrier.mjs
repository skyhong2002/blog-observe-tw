/** Dedicated B0 barrier runner. Explicit clone credentials; disposable 18169 only.
 * Required: B0_BARRIER_ARTIFACT=<ignored JSON path> node tools/test-visibility-barrier.mjs --env-file <mode600 clone.env>
 * Optional final-release provenance: B0_RELEASE_SHA, B0_SOURCE_TREE_HASH, B0_NEXT_BUILD_ID,
 * B0_GATEWAY_PORT, B0_WEB_PORT, B0_WEB_PID. Does not start/build/stop Next.
 * B0_NEGATIVE_CONTROL=true reenacts legacy singleflight; only an expected deadline failure counts as rejection.
 */
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
  phase = 'visibility-barrier';
  const { runVisibilityBarrierIntegration, barrierSourceTreeHash } = await import('../tests/integration/visibility-barrier.mjs');
  const { execFileSync } = await import('node:child_process');
  const releaseSHA =
    process.env.B0_RELEASE_SHA ||
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim();
  const negative = process.env.B0_NEGATIVE_CONTROL === 'true';
  const artifact = process.env.B0_BARRIER_ARTIFACT;
  if (!artifact) throw Error('B0_BARRIER_ARTIFACT_required');
  try {
    const result = await runVisibilityBarrierIntegration(store.pool, {
      provenance: {
        releaseSHA,
        nextBuildId: process.env.B0_NEXT_BUILD_ID || null,
        sourceTreeHash: process.env.B0_SOURCE_TREE_HASH || (await barrierSourceTreeHash()),
      },
      gatewayPort: Number(process.env.B0_GATEWAY_PORT || 0),
      webPort: process.env.B0_WEB_PORT ? Number(process.env.B0_WEB_PORT) : null,
      webPid: process.env.B0_WEB_PID ? Number(process.env.B0_WEB_PID) : undefined,
      artifactPath: artifact,
      negativeControlSharedRead: negative,
    });
    if (negative) throw Error('negative_control_did_not_reject_shared_result');
    console.log(
      JSON.stringify({
        passed: result.passed,
        scenarios: result.results.length,
        testedSurfaces: result.testedSurfaces,
        isolatedPorts: result.isolatedPorts,
      }),
    );
  } catch (error) {
    if (!negative) throw error;
    const proof = JSON.parse(await readFile(artifact, 'utf8'));
    if (
      proof.passed ||
      proof.failure?.reason !== 'request_deadline_before_B_completion' ||
      proof.events.some((e) => e.event === 'B.complete')
    )
      throw error;
    const order = ['A.sql-old-value-captured', 'mutation.commit-complete', 'B.start', 'scenario.failed', 'A.release-cleanup'].map(
      (name) => proof.events.find((e) => e.event === name)?.sequence,
    );
    if (order.some((v) => !Number.isInteger(v)) || order.some((v, i) => i > 0 && v <= order[i - 1]))
      throw Error('negative_control_missing_required_race_order');
    console.log(JSON.stringify({ passed: false, negativeControlRejected: true, expectedFailure: true, reason: proof.failure.reason }));
  }
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
