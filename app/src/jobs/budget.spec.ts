import { describe, expect, it } from 'vitest';
import { checkedReservations } from './budget.ts';

describe('durable work reservation contract', () => {
  it('orders scopes and rejects ambiguous, overflowing or empty reservations', () => {
    expect(
      checkedReservations([
        { scope: 'b', amount: 1, limit: 10 },
        { scope: 'a', amount: 2, limit: 10 },
      ]).map((x) => x.scope),
    ).toEqual(['a', 'b']);
    for (const input of [
      [],
      [{ scope: 'a', amount: 0, limit: 10 }],
      [{ scope: 'a', amount: 1, limit: Infinity }],
      [
        { scope: 'a', amount: 1, limit: 10 },
        { scope: 'a', amount: 1, limit: 10 },
      ],
      [{ scope: 'token secret', amount: 1, limit: 10 }],
    ])
      expect(() => checkedReservations(input)).toThrow();
  });
});
