import { describe, expect, it } from 'vitest';
import {
  advancePublicationScan,
  type FreshArticleFact,
  type PublicationContinuation,
  type PublicationInput,
  parsePublicationContinuation,
  resumePublicationScan,
  startPublicationScan,
} from './snapshot-publication-contract.ts';

const input: PublicationInput = {
  enabled: true,
  target: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  expectedCurrent: null,
  manifestSha256: 'a'.repeat(64),
  policyVersion: 'policy-v1',
  selectionId: 'selection-v1',
  matcherVersion: 'matcher-v1',
  cleanupVersion: 'cleanup-v1',
  highWater: 100,
  asOf: '2026-10-13T00:00:00.000Z',
};
const start = () => startPublicationScan(input) as PublicationContinuation;
const fact = (postId: number, changes: Partial<FreshArticleFact> = {}): FreshArticleFact => ({
  postId,
  publicBefore: true,
  publicFresh: true,
  ownerFresh: true,
  dateFresh: true,
  revisionFresh: true,
  result: 'hits',
  ...changes,
});
const batch = (facts: FreshArticleFact[], exhausted = false) => ({ expectedCursor: 0, observedCurrent: null, epoch: 0, facts, exhausted });
describe('pure staged publication contract, no DB freshness proof', () => {
  it('default disabled, enabled getter not invoked', () => {
    expect(startPublicationScan({ ...input, enabled: false })).toEqual({ status: 'disabled' });
    let called = false;
    expect(
      startPublicationScan(
        Object.defineProperty({ ...input }, 'enabled', {
          get() {
            called = true;
            return true;
          },
        }),
      ),
    ).toEqual({ status: 'disabled' });
    expect(called).toBe(false);
  });
  it('null predecessor is exact, not wildcard', () => {
    expect(advancePublicationScan(start(), { ...batch([]), observedCurrent: input.target })).toEqual({
      status: 'conflict',
      reason: 'current',
    });
  });
  it('cursor CAS and epoch mismatch return conflicts with immutable input', () => {
    const s = start();
    expect(advancePublicationScan(s, { ...batch([]), expectedCursor: 1 })).toEqual({ status: 'conflict', reason: 'cursor' });
    expect(advancePublicationScan(s, { ...batch([]), epoch: 1 })).toEqual({ status: 'conflict', reason: 'dirty' });
    expect(s.cursor).toBe(0);
  });
  it('fresh withdrawal skips; stale revision unresolved; capped is not zero', () => {
    const s = advancePublicationScan(
      start(),
      batch(
        [
          fact(1, { result: 'zero' }),
          fact(2, { publicFresh: false }),
          fact(3, { ownerFresh: false }),
          fact(4, { dateFresh: false }),
          fact(5, { revisionFresh: false }),
          fact(6, { result: 'capped' }),
        ],
        true,
      ),
    ) as PublicationContinuation;
    expect(s).toMatchObject({
      checked: 6,
      eligible: 1,
      zeroHit: 1,
      skipped: 3,
      unresolved: 1,
      capped: 1,
      cursor: 100,
      state: 'scanned-as-of',
      canVerify: false,
    });
  });
  it('all clean complete still cannot verify/live claim', () => {
    const s = advancePublicationScan(start(), batch([fact(1)], true)) as PublicationContinuation;
    expect(s.state).toBe('scanned-as-of');
    expect(s.canVerify).toBe(false);
    expect(JSON.stringify(s)).not.toContain('verified');
  });
  it('max50, strict ascending keyset/highwater, holes/accessors fail', () => {
    for (const fs of [Array.from({ length: 51 }, (_, i) => fact(i + 1)), [fact(2), fact(1)], [fact(101)]])
      expect(() => advancePublicationScan(start(), batch(fs))).toThrow();
    const fs = [fact(1)];
    Object.defineProperty(fs, '0', {
      get() {
        throw Error('getter executed');
      },
    });
    expect(() => advancePublicationScan(start(), batch(fs))).toThrow('invalid-publication-contract');
  });
  it('strict continuation keys, getters, counters and format reject', () => {
    const s = start();
    for (const bad of [
      { ...s, secret: 'rawbody' },
      { ...s, canVerify: true },
      { ...s, cursor: 101 },
      { ...s, checked: 1 },
      { ...s, epoch: NaN },
      { ...s, asOf: 'yesterday' },
    ])
      expect(() => parsePublicationContinuation(bad)).toThrow();
    expect(() =>
      parsePublicationContinuation(
        Object.defineProperty({ ...s }, 'target', {
          get() {
            throw Error('getter executed');
          },
        }),
      ),
    ).toThrow('invalid-publication-contract');
  });
  it('JSON serialized resume pins all immutable identities', () => {
    const s = JSON.parse(JSON.stringify(start()));
    const { enabled: _, highWater: __, asOf: ___, ...pins } = input;
    expect(resumePublicationScan(s, pins)).toEqual(s);
    for (const key of ['target', 'expectedCurrent', 'manifestSha256', 'policyVersion', 'selectionId', 'matcherVersion', 'cleanupVersion'])
      expect(() =>
        resumePublicationScan(s, {
          ...pins,
          [key]:
            key === 'expectedCurrent'
              ? input.target
              : key === 'manifestSha256'
                ? 'b'.repeat(64)
                : key === 'target'
                  ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
                  : 'changed',
        }),
      ).toThrow();
  });
  it('unknown fact fields not propagated, no raw body collection', () => {
    expect(() => advancePublicationScan(start(), batch([{ ...fact(1), body: 'private' } as FreshArticleFact]))).toThrow();
    expect(JSON.stringify(start()).length).toBeLessThan(2048);
  });
});
