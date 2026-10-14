import assert from 'node:assert/strict';
import type { Pool } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { MATCHER_VERSION, POLICY_VERSION } from './policy.ts';
import { runTopicRankingIntegration } from './ranking.integration.ts';

/** Persisted release identities, deliberately independent from the source under test. */
export async function runTopicPolicyCompatibilityIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  assert.equal(process.versions.unicode, '17.0', 'use the release Node toolchain for persisted namespace compatibility');
  const persisted =
    process.env.BLOG_TOPIC_FORMAT_NORMALIZATION_ENABLED === 'true'
      ? {
          policy: 'topic-policy-v3:b70ade11f5c3cc7c5d88f36cc2e63c754beb04e87f5beee5bc25b8a5624b5c3f',
          matcher: 'topic-matcher-v3:ea4f7c2b5660f0b7585faa318c43fcca01dfeb6dbfdfd168beff81fa73e09244',
        }
      : {
          policy: 'topic-policy-v3:25670024a3b758518aa0895b6ca6ebc0d1a4e6540a48380d0aeade56fe703475',
          matcher: 'topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5',
        };
  assert.equal(POLICY_VERSION, persisted.policy);
  assert.equal(MATCHER_VERSION, persisted.matcher);
  // All ranking/detail/profile/alias/exclusion/hash assertions run on literal release data,
  // rather than giving every fixture the freshly computed hash that caused the regression.
  return runTopicRankingIntegration(pool, persisted);
}
