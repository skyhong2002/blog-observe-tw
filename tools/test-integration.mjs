/** Explicit private clone credentials only. Never load .env or reuse the clone's existing database. */
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
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
  if (
    ![4, 6].includes(process.argv.length) ||
    process.argv[2] !== '--env-file' ||
    (process.argv.length === 6 &&
      (process.argv[4] !== '--suite' ||
        ![
          'f3-f4',
          'public-api',
          'fulltext',
          'b3',
          'vocabulary-snapshot',
          'staged-scan-v2',
          'topic-body-owner',
          'topic-policy-compat',
          'home-display',
          'topic-fingerprint-sql',
          'staged-scan-proof',
          'staged-proof-inspector',
        ].includes(process.argv[5])))
  )
    throw Error('explicit_private_clone_env_required');
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
  parsed.pathname = `/${name}`;
  process.env.BLOG_DB_URL = parsed.href;
  // Fixture suites inject their HTTP adapters; accidental direct global network is an error.
  globalThis.fetch = async () => {
    throw Error('integration_external_network_forbidden');
  };
  const dir = new URL('../app/src/db/migrations/', import.meta.url);
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.startsWith('0000_')).sort();
  // Drop (if any) and recreate the one disposable database, then apply baseline and migrations.
  const freshDatabase = async () => {
    if (store) await store.close();
    store = undefined;
    if (created) await control.query(`DROP DATABASE \`${name}\``);
    created = false;
    phase = 'create-disposable-database';
    await control.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    created = true;
    store = createDb(parsed.href, { poolSize: 8 });
    phase = 'migrations';
    const baseline = await readFile(new URL('../db/001_init.sql', import.meta.url), 'utf8');
    for (const statement of baseline
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await store.pool.query(statement);
    for (const file of files) {
      phase = `migration:${file}`;
      for (const sql of (await readFile(new URL(file, dir), 'utf8'))
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean))
        await store.pool.query(sql);
    }
  };
  await freshDatabase();
  const suites = [
    ['fulltext', '../app/src/search-fulltext.integration.ts', 'runFulltextIntegration'],
    ['home-display', '../app/src/topics/display-gate.integration.ts', 'runDisplayGateIntegration'],
    ['topic-policy-compat', '../app/src/topics/policy-compat.integration.ts', 'runTopicPolicyCompatibilityIntegration'],
    ['topic-fingerprint-sql', '../app/src/topics/provenance-fingerprint-sql.integration.ts', 'runProvenanceFingerprintSqlIntegration'],
    ['staged-scan-proof', '../app/src/topics/staged-scan-proof.integration.ts', 'runStagedScanProofIntegration'],
    ['staged-proof-inspector', '../app/src/topics/staged-proof-inspector.integration.ts', 'runStagedProofInspectorIntegration'],
    ['staged-scan-v2', '../app/src/topics/staged-scan-v2.integration.ts', 'runStagedScanV2Integration'],
    ['topic-body-owner', '../app/src/topics/body-owner.integration.ts', 'runTopicBodyOwnerIntegration'],
    ['budgets-ai', '../tests/integration/core.mjs', 'runCoreIntegration'],
    ['candidates', '../tests/integration/candidates.mjs', 'runCandidateIntegration'],
    ['relations', '../app/src/relations/integration.ts', 'runRelationIntegration'],
    ['relation-visibility', '../app/src/relations/visibility.integration.ts', 'runRelationVisibilityIntegration'],
    ['relations-quality', '../app/src/relations/quality.integration.ts', 'runRelationQualityIntegration'],
    ['topics', '../tests/integration/topics.mjs', 'runTopicsIntegration'],
    ['topic-frequency', '../app/src/topics/frequency.integration.ts', 'runTopicFrequencyIntegration'],
    ['topic-history', '../app/src/topics/history.integration.ts', 'runTopicHistoryIntegration'],
    ['content-visibility', '../tests/integration/content-visibility.mjs', 'runContentVisibilityIntegration'],
    ['future-visibility', '../app/src/future-visibility.integration.ts', 'runFutureVisibilityIntegration'],
    ['topic-history-read', '../app/src/topics/history-read.integration.ts', 'runTopicHistoryReadIntegration'],
    ['index-carry', '../app/src/topics/index-carry.integration.ts', 'runIndexCarryIntegration'],
    ['window-incremental', '../app/src/topics/window-incremental.integration.ts', 'runWindowIncrementalIntegration'],
    ['snapshot-retention', '../app/src/topics/snapshot-retention.integration.ts', 'runSnapshotRetentionIntegration'],
    ['topic-capacity', '../app/src/topics/capacity.integration.ts', 'runTopicCapacityIntegration'],
    ['snapshot-import', '../app/src/topics/snapshot.integration.ts', 'runSnapshotImportIntegration'],
    ['public-routes', '../app/src/seo/page-routes.integration.ts', 'runPublicRoutesIntegration'],
    ['page-links', '../app/src/seo/page-links.integration.ts', 'runPageLinksIntegration'],
    ['indexability', '../app/src/seo/indexability.integration.ts', 'runIndexabilityIntegration'],
    ['topics-ranking', '../app/src/topics/ranking.integration.ts', 'runTopicRankingIntegration'],
    ['home-ranking-freshness', '../app/src/topics/ranking-freshness.integration.ts', 'runRankingFreshnessIntegration'],
    ['topics-quality', '../app/src/topics/integration.ts', 'runTopicsQualityIntegration'],
    ['content-topics', '../app/src/topics/content.integration.ts', 'runContentTopicsIntegration'],
    ['content-feed', '../app/src/crawl/feed-content.integration.ts', 'runFeedContentIntegration'],
    ['content', '../app/src/content/content.integration.ts', 'runContentIntegration'],
    ['public-api', '../app/src/public-api/integration.ts', 'runPublicApiIntegration'],
    ['api-keys', '../app/src/reader/api-keys.integration.ts', 'runApiKeyIntegration'],
    ['admin', '../tests/integration/admin.mjs', 'runAdminIntegration'],
    ['search-recall', '../app/src/search.integration.ts', 'runSearchIntegration'],
    ['profile-evidence', '../app/src/relations/profile-evidence.integration.ts', 'runProfileEvidenceIntegration'],
    ['shared-tags', '../app/src/relations/shared-tags.integration.ts', 'runSharedTagsIntegration'],
    ['text-similarity', '../app/src/relations/text-similarity.integration.ts', 'runTextSimilarityIntegration'],
    ['shared-label-selection', '../app/src/topics/shared-label-selection.integration.ts', 'runSharedLabelSelectionIntegration'],
    ['shared-label-store', '../app/src/topics/shared-label-store.integration.ts', 'runSharedLabelStoreIntegration'],
    ['tech-store', '../app/src/tech/store.integration.ts', 'runTechStoreIntegration'],
    ['tech-routes', '../app/src/tech/routes.integration.ts', 'runTechRoutesIntegration'],
    ['tech-backfill', '../app/src/tech/backfill.integration.ts', 'runTechBackfillIntegration'],
    ['tech-fetch-batch', '../app/src/tech/fetch-batch.integration.ts', 'runTechFetchBatchIntegration'],
  ];
  const selected =
    process.argv[5] === 'public-api'
      ? suites.filter(([label]) => label === 'public-api')
      : process.argv[5] === 'fulltext'
        ? suites.filter(([label]) => label === 'fulltext')
        : process.argv[5] === 'home-display'
          ? suites.filter(
              ([label]) =>
                label === 'home-display' ||
                label === 'topic-policy-compat' ||
                label === 'home-ranking-freshness' ||
                label === 'relation-visibility',
            )
          : process.argv[5] === 'topic-policy-compat'
            ? suites.filter(([label]) => label === 'topic-policy-compat' || label === 'home-ranking-freshness')
            : process.argv[5] === 'f3-f4'
              ? suites.filter(
                  ([label]) =>
                    label === 'search-recall' ||
                    label === 'profile-evidence' ||
                    label === 'shared-tags' ||
                    label === 'text-similarity' ||
                    label === 'home-ranking-freshness' ||
                    label.startsWith('tech-'),
                )
              : process.argv[5] === 'b3'
                ? suites.filter(([label]) => label.startsWith('shared-label-'))
                : process.argv[5] === 'vocabulary-snapshot'
                  ? suites.filter(([label]) => label === 'snapshot-import')
                  : process.argv[5] === 'staged-scan-v2'
                    ? suites.filter(([label]) => label === 'staged-scan-v2')
                    : process.argv[5] === 'topic-body-owner'
                      ? suites.filter(([label]) => label === 'topic-body-owner')
                      : process.argv[5] === 'topic-fingerprint-sql'
                        ? suites.filter(([label]) => label === 'topic-fingerprint-sql')
                        : process.argv[5] === 'staged-scan-proof'
                          ? suites.filter(([label]) => label === 'staged-scan-proof')
                          : process.argv[5] === 'staged-proof-inspector'
                            ? suites.filter(([label]) => label === 'staged-proof-inspector')
                            : suites;
  // Without --suite every suite gets its own fresh database: several assume an empty corpus
  // (staged-scan-proof asserts it), so sharing one database made the full run stop there.
  for (const [index, [label, module, entry]] of selected.entries()) {
    if (index > 0 && process.argv.length === 4) await freshDatabase();
    phase = label;
    const result = await (await import(module))[entry](store.pool);
    console.log(JSON.stringify({ suite: label, passed: true, result }));
  }
  console.log(JSON.stringify({ passed: true, suites: selected.length, migrations: files.length, isolatedPort: 18169 }));
} catch (error) {
  // Database driver errors can contain SQL or connection credentials. Only a fixed phase and bounded error code leave this process.
  const code =
    error && typeof error === 'object' && typeof error.code === 'string' && /^[A-Z_0-9]{1,60}$/.test(error.code)
      ? error.code
      : 'INTEGRATION_FAILED';
  // Extract only repo-relative file:line:column. Never emit whole stack lines or error messages.
  const repoPattern = process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `${repoPattern}/((?:app/src|tests/integration|tools)/[A-Za-z0-9_./-]+\\.(?:ts|mjs|js)):(\\d{1,7}):(\\d{1,7})`,
    'g',
  );
  const frames = [...String(error?.stack || '').matchAll(pattern)]
    .filter((m) => m[1].length <= 240 && !m[1].split('/').includes('..') && existsSync(resolve(process.cwd(), m[1])))
    .slice(0, 3)
    .map((m) => `${m[1]}:${m[2]}:${m[3]}`);
  const ordinal = error?.testOrdinal;
  const rawDiagnostic = error?.syntheticDiagnostic;
  const diagnostic =
    rawDiagnostic && typeof rawDiagnostic === 'object'
      ? {
          sourceCase: ['rss', 'tracking', 'meaningful', 'capped', 'oversize'].includes(rawDiagnostic.sourceCase)
            ? rawDiagnostic.sourceCase
            : 'unknown',
          status: ['disabled', 'busy', 'blocked', 'deferred', 'conflict', 'scanning', 'scanned-as-of', 'unknown'].includes(
            rawDiagnostic.status,
          )
            ? rawDiagnostic.status
            : 'unknown',
          reason: [
            'none',
            'unknown',
            'deadline',
            'lease',
            'local-db-unavailable',
            'target-not-ready',
            'target-public',
            'active-scan',
            'invalid-input',
            'scan-owner',
            'missing-run',
            'policy-count',
            'cursor-conflict',
          ].includes(rawDiagnostic.reason)
            ? rawDiagnostic.reason
            : 'unknown',
          counters: Object.fromEntries(
            ['checked', 'eligible', 'titleOnly', 'zeroHit', 'skipped', 'capped', 'unresolved'].flatMap((k) => {
              const n = rawDiagnostic.counters?.[k];
              return Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 ? [[k, n]] : [];
            }),
          ),
        }
      : undefined;

  console.error(
    JSON.stringify({
      passed: false,
      phase,
      code,
      ...(Number.isSafeInteger(ordinal) && ordinal >= 1 && ordinal <= 100_000 ? { testOrdinal: ordinal } : {}),
      frames,
      ...(diagnostic ? { syntheticDiagnostic: diagnostic } : {}),
    }),
  );
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
