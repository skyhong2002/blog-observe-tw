import { describe, expect, it } from 'vitest';
import { TOPIC_FINGERPRINT_VERSION } from './provenance-fingerprint-sql.ts';
import {
  type IndexProof,
  knownProofAdapter,
  proofPinsMatch,
  STAGED_PROOF_VERSION,
  sameProofOrigin,
  validateIndexProof,
} from './staged-scan-proof.ts';

const proof: IndexProof = {
  snapshotId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  postId: 1,
  scanRunId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  proofVersion: STAGED_PROOF_VERSION,
  fingerprintVersion: TOPIC_FINGERPRINT_VERSION,
  policyVersion: 'policy-v1',
  selectionId: 'a'.repeat(64),
  matcherVersion: 'matcher-v1',
  cleanupVersion: 'cleanup-v1',
  kind: 'title-only',
  metadataFingerprint: 'b'.repeat(64),
  bodyFingerprint: null,
  bodyContentHash: null,
  bodyRevision: null,
  sourceKind: null,
  bodyObtainedAt: null,
  observedAt: '2026-10-14T00:00:00.000Z',
  checkedAt: '2026-10-14T00:00:00.000Z',
  inputHash: 'c'.repeat(64),
};
describe('generation-local proof structure only', () => {
  it('title-only requires all body attributes NULL', () => {
    expect(validateIndexProof(proof)).toEqual(proof);
    for (const k of ['bodyFingerprint', 'bodyContentHash', 'bodyRevision', 'sourceKind', 'bodyObtainedAt'])
      expect(() => validateIndexProof({ ...proof, [k]: 'non-null' })).toThrow();
  });
  it('full body requires nonNULL expected hash/provenance/revision', () => {
    const full = {
      ...proof,
      kind: 'full',
      bodyFingerprint: 'd'.repeat(64),
      bodyContentHash: 'e'.repeat(64),
      bodyRevision: 1,
      sourceKind: 'rss-content',
      bodyObtainedAt: proof.observedAt,
    };
    expect(validateIndexProof(full).kind).toBe('full');
    for (const k of ['bodyFingerprint', 'bodyContentHash', 'bodyRevision', 'sourceKind', 'bodyObtainedAt'])
      expect(() => validateIndexProof({ ...full, [k]: null })).toThrow();
  });
  it('invalid IDs/hash/versions/dates/extra/rawbody/proto/getter/proxy reject', () => {
    let invoked = 0;
    for (const bad of [
      { ...proof, postId: NaN },
      { ...proof, postId: 0 },
      { ...proof, metadataFingerprint: null },
      { ...proof, proofVersion: 'unknown' },
      { ...proof, kind: 'capped' },
      { ...proof, observedAt: 'yesterday' },
      { ...proof, body: 'raw' },
      Object.assign(Object.create({ x: 1 }), proof),
      Object.defineProperty({ ...proof }, 'postId', {
        get() {
          invoked++;
          return 1;
        },
      }),
      new Proxy(proof, {
        getPrototypeOf() {
          invoked++;
          throw Error('trap');
        },
      }),
    ])
      expect(() => validateIndexProof(bad)).toThrow();
    expect(invoked).toBe(0);
  });
  it('marker pins every reviewed contract, not source authenticity', () => {
    const pins = {
      target: proof.snapshotId,
      manifestSha256: 'f'.repeat(64),
      policyVersion: proof.policyVersion,
      selectionId: proof.selectionId,
      matcherVersion: proof.matcherVersion,
      cleanupVersion: proof.cleanupVersion,
    };
    const marker = {
      proof_version: STAGED_PROOF_VERSION,
      fingerprint_version: TOPIC_FINGERPRINT_VERSION,
      status: 'staging',
      scan_contract_version: 'scan-v2',
      manifest_sha256: pins.manifestSha256,
      policy_version: pins.policyVersion,
      selection_id: pins.selectionId,
      matcher_version: pins.matcherVersion,
      cleanup_version: pins.cleanupVersion,
    };
    expect(proofPinsMatch(marker, pins)).toBe(true);
    for (const k of Object.keys(marker)) expect(proofPinsMatch({ ...marker, [k]: 'changed' }, pins)).toBe(false);
  });
  it('origin exact protocol/host/port, no native redirect guesses', () => {
    expect(sameProofOrigin('https://x.example/a?utm_source=x', 'https://x.example/b')).toBe(true);
    for (const value of [
      'http://x.example/a',
      'https://www.x.example/a',
      'https://x.example:8443/a',
      'https://other.example/a',
      'https://user:password@x.example/a',
      'not a URL',
    ])
      expect(sameProofOrigin('https://x.example/a', value)).toBe(false);
  });
  it('serialized scalar proof is bounded and no public/verified capability', () => {
    expect(JSON.stringify(validateIndexProof(proof)).length).toBeLessThan(2048);
    expect(proof).not.toHaveProperty('canVerify');
    expect(proof).not.toHaveProperty('publish');
  });
});

it('new proof adapter accepts only exact registry IDs and signed positive rule revisions', () => {
  expect(knownProofAdapter({ adapter_id: 'generic-public', rule_revision: 1 })).toBe(true);
  expect(knownProofAdapter({ adapter_id: 'wordpress-public', rule_revision: 2147483647 })).toBe(true);
  for (const id of ['unknown-public', 'generic-public-extra', 'generic', ''])
    expect(knownProofAdapter({ adapter_id: id, rule_revision: 1 })).toBe(false);
  for (const revision of [0, -1, NaN, Infinity, 1.5, 2147483648, '1'])
    expect(knownProofAdapter({ adapter_id: 'generic-public', rule_revision: revision })).toBe(false);
});
