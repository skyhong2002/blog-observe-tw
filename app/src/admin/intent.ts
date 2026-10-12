import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { reserveBudgetOnConnection } from '../jobs/budget.ts';
import { type AdminActor, requireAdminTransaction, writeAudit } from './identity.ts';
export const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export async function beginIntent(
  pool: Pool,
  actor: AdminActor,
  emails: Set<string>,
  key: unknown,
  action: string,
  payload: unknown,
  network = false,
) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(key))
    throw Object.assign(Error('idempotency_key_required'), { statusCode: 400 });
  const id = digest(`${actor.id}\0${key}`),
    hash = digest(JSON.stringify(payload));
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await requireAdminTransaction(c, actor, emails);
    const [[prior]] = await c.query<RowDataPacket[]>(
      'SELECT action,payload_hash,status,result_json FROM admin_intents WHERE id=? FOR UPDATE',
      [id],
    );
    if (prior) {
      await c.commit();
      if (prior.action !== action || prior.payload_hash !== hash) throw Object.assign(Error('idempotency_conflict'), { statusCode: 409 });
      return {
        id,
        prior: true,
        status: prior.status,
        result: typeof prior.result_json === 'string' ? JSON.parse(prior.result_json) : prior.result_json,
      };
    }
    if (
      !(await reserveBudgetOnConnection(c, [
        { scope: 'admin:mutations', amount: 1, limit: 100 },
        { scope: `admin:user:${actor.id}`, amount: 1, limit: 60 },
        ...(network ? [{ scope: 'admin:network-intents', amount: 1, limit: 20 }] : []),
      ]))
    )
      throw Object.assign(Error('admin_daily_budget'), { statusCode: 429 });
    await c.execute(
      "INSERT INTO admin_intents(id,actor_user_id,action,payload_hash,status,created_at,updated_at) VALUES (?,?,?,?,'pending',UTC_TIMESTAMP(),UTC_TIMESTAMP())",
      [id, actor.id, action, hash],
    );
    await writeAudit(c, actor.id, `${action}.intent`, 'intent', id, null, { status: 'pending' });
    await c.commit();
    return { id, prior: false, status: 'pending', result: null };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
export async function finishIntent(pool: Pool, id: string, result: unknown, state: 'done' | 'uncertain' = 'done') {
  await pool.execute("UPDATE admin_intents SET status=?,result_json=?,updated_at=UTC_TIMESTAMP() WHERE id=? AND status='pending'", [
    state,
    JSON.stringify(result),
    id,
  ]);
}
/** A sent external action cannot be undone by a role revocation. Record only an already authorized intent's outcome. */
export async function recordExternalOutcome(pool: Pool, intentId: string, actor: AdminActor, domain: string, status: string) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[intent]] = await c.query<RowDataPacket[]>('SELECT actor_user_id,action FROM admin_intents WHERE id=? FOR UPDATE', [intentId]);
    if (!intent || intent.actor_user_id !== actor.id || intent.action !== 'similarweb.submit') throw Error('external_intent_mismatch');
    await writeAudit(c, actor.id, 'similarweb.submit.outcome', 'domain', domain, null, { intentId, status });
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
/** Never retry externally visible work when only its final bookkeeping failed. */
export async function executeIntentWork<T>(
  work: () => Promise<T>,
  finish: (value: unknown, state: 'done' | 'uncertain') => Promise<void>,
): Promise<T> {
  let result: T;
  try {
    result = await work();
  } catch (error) {
    try {
      await finish({ error: 'admin_action_uncertain' }, 'uncertain');
    } catch {
      /* Keep pending; an operator must inspect the existing audit before any new key. */
    }
    throw error;
  }
  try {
    await finish(result, 'done');
  } catch {
    throw Object.assign(Error('intent_finalization_uncertain'), { statusCode: 503 });
  }
  return result;
}
