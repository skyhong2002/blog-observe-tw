import type { Pool, PoolConnection, ResultSetHeader } from 'mysql2/promise';

export type Reservation = { scope: string; amount: number; limit: number };
export function checkedReservations(input: Reservation[]): Reservation[] {
  if (!input.length || input.length > 10) throw Error('invalid budget reservation');
  const seen = new Set<string>();
  for (const r of input) {
    if (
      !/^[a-z0-9:._-]{1,191}$/.test(r.scope) ||
      seen.has(r.scope) ||
      !Number.isSafeInteger(r.amount) ||
      r.amount < 1 ||
      !Number.isSafeInteger(r.limit) ||
      r.limit < 1 ||
      r.limit > 1_000_000_000
    ) {
      throw Error('invalid budget reservation');
    }
    seen.add(r.scope);
  }
  return [...input].sort((a, b) => a.scope.localeCompare(b.scope));
}
/** Caller owns an active transaction. Reservations roll back with a failed admission.
 * A savepoint makes a multi-counter refusal atomic without discarding the caller's audit. */
export async function reserveBudgetOnConnection(c: PoolConnection, reservations: Reservation[], now = new Date()): Promise<boolean> {
  const rows = checkedReservations(reservations);
  if (!Number.isFinite(now.getTime())) throw Error('invalid budget date');
  const day = now.toISOString().slice(0, 10);
  await c.query('SAVEPOINT blog_budget_reservation');
  for (const r of rows) {
    // Duplicate-key UPDATE takes an exclusive row lock immediately. INSERT IGNORE
    // would take a shared duplicate lock then deadlock when concurrent callers upgrade.
    await c.execute('INSERT INTO work_budgets (day,scope,used,updated_at) VALUES (?,?,0,?) ON DUPLICATE KEY UPDATE scope=VALUES(scope)', [
      day,
      r.scope,
      now,
    ]);
    const [result] = await c.execute<ResultSetHeader>(
      'UPDATE work_budgets SET used=used+?,updated_at=? WHERE day=? AND scope=? AND used<=?',
      [r.amount, now, day, r.scope, r.limit - r.amount],
    );
    if (result.affectedRows !== 1) {
      await c.query('ROLLBACK TO SAVEPOINT blog_budget_reservation');
      await c.query('RELEASE SAVEPOINT blog_budget_reservation');
      return false;
    }
  }
  await c.query('RELEASE SAVEPOINT blog_budget_reservation');
  return true;
}
/** Reserve all counters atomically before I/O. Never refund unknown network outcomes after a crash. */
export async function reserveBudget(pool: Pool, reservations: Reservation[], now = new Date()): Promise<boolean> {
  checkedReservations(reservations);
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const reserved = await reserveBudgetOnConnection(c, reservations, now);
    await c.commit();
    return reserved;
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
