import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { backfillTopicHistory } from './history-backfill.ts';
import { acceptsHistoryTransition, aggregateHistoryState } from './history-store.ts';
import { revalidateTopicHistory } from './history-worker.ts';

const at = (s: number) => new Date(s * 1000);
describe('durable history ordering', () => {
  it('never revives a newer tombstone with old or same-second backfill', () => {
    const previous = { state: 'revoked', checkedAt: at(10) };
    expect(acceptsHistoryTransition(previous, { state: 'confirmed', checkedAt: at(9) })).toBe(false);
    expect(acceptsHistoryTransition(previous, { state: 'confirmed', checkedAt: new Date(10999) })).toBe(false);
    expect(acceptsHistoryTransition(previous, { state: 'confirmed', checkedAt: at(11) })).toBe(true);
  });
  it('revocation wins ties and pending cannot be upgraded by equally old replay', () => {
    expect(acceptsHistoryTransition({ state: 'confirmed', checkedAt: at(10) }, { state: 'revoked', checkedAt: at(10) })).toBe(true);
    expect(acceptsHistoryTransition({ state: 'pending', checkedAt: at(10) }, { state: 'confirmed', checkedAt: at(10) })).toBe(false);
    expect(acceptsHistoryTransition({ state: 'confirmed', checkedAt: at(10) }, { state: 'pending', checkedAt: at(10) })).toBe(true);
  });
  it('does not classify pending evidence as revoked', () => {
    expect(aggregateHistoryState({ confirmed: 0, pending: 1 })).toBe('pending');
    expect(aggregateHistoryState({ confirmed: 1, pending: 1 })).toBe('active');
    expect(aggregateHistoryState({ confirmed: 0, pending: 0 })).toBe('revoked');
  });
  it('disabled jobs do not even access the pool', async () => {
    const pool = new Proxy({} as Pool, {
      get() {
        throw Error('unexpected DB access');
      },
    });
    expect((await backfillTopicHistory(pool, { enabled: false })).disabled).toBe(true);
    expect((await revalidateTopicHistory(pool, { enabled: false })).disabled).toBe(true);
  });
});
