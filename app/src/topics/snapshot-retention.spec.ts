import { describe, expect, it } from 'vitest';
import { retentionLimits, SNAPSHOT_RETENTION } from './snapshot-retention.ts';

describe('snapshot retention safety bounds', () => {
  it('defaults to 32 generations and bounded 500-row transactions', () => {
    expect(retentionLimits()).toEqual({ keepPublished: 32, maxRows: 250_000, maxMs: 10_000, batchRows: 500 });
    expect(SNAPSHOT_RETENTION.maxVersions).toBe(64);
  });
  it('cannot enlarge a destructive batch or its deadline', () => {
    expect(retentionLimits({ keepPublished: 999, maxRows: 1e9, maxMs: 1e9, batchRows: 1e9 })).toEqual(retentionLimits());
  });
  it('allows smaller test/operational budgets and disables deletion with zero rows', () => {
    expect(retentionLimits({ keepPublished: 2, maxRows: 0, maxMs: 1, batchRows: 1 })).toEqual({
      keepPublished: 2,
      maxRows: 0,
      maxMs: 1,
      batchRows: 1,
    });
    expect(retentionLimits({ maxRows: NaN, maxMs: -1, batchRows: -1 })).toMatchObject({ maxRows: 0, maxMs: 0, batchRows: 1 });
  });
});
