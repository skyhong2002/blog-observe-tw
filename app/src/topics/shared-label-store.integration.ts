/** Existing 18169 disposable runner only; never invoked by implementation task. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { SHARED_LABEL_CONTRACT } from './shared-label-contract.ts';
import {
  loadSharedLabelCooldown,
  loadSharedLabelSnapshot,
  reserveSharedLabelWire,
  SHARED_LABEL_EXPIRY_MS,
  storeSharedLabelCooldown,
  storeSharedLabelSnapshot,
  withSharedLabelProducerLease,
} from './shared-label-store.ts';
export async function runSharedLabelStoreIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const label = `離線fixture-${randomBytes(6).toString('hex')}`,
    labelHash = createHash('sha256').update(label).digest('hex'),
    now = new Date(),
    future = new Date(now.getTime() + SHARED_LABEL_EXPIRY_MS);
  let checks = 0;
  const check = (value: unknown) => {
    assert.ok(value);
    checks++;
  };
  const data = { tag: label, tagId: labelHash, relations: [], truncated: false };
  try {
    check(await storeSharedLabelSnapshot(pool, label, 'relations', { status: 'ready', data: { ...data, token: 'NEVER_PERSIST' } }, now));
    const first = await loadSharedLabelSnapshot(pool, label, 'relations', now);
    check(first.status === 'ready' && first.payloadVersion === null && first.sourceContractSha === SHARED_LABEL_CONTRACT.sourceSHA);
    const [[stored]] = await pool.query<RowDataPacket[]>(
      'SELECT validated_dto FROM topic_shared_label_snapshots WHERE label_hash=? AND kind=?',
      [labelHash, 'relations'],
    );
    check(!JSON.stringify(stored).includes('NEVER_PERSIST'));
    check((await loadSharedLabelSnapshot(pool, label, 'relations', future)).status === 'unavailable');
    check(await storeSharedLabelSnapshot(pool, label, 'visual', { status: 'missing' }, now));
    check((await loadSharedLabelSnapshot(pool, label, 'visual', now)).status === 'missing');
    const failed = new Date(now.getTime() + 1);
    check(await storeSharedLabelSnapshot(pool, label, 'relations', { status: 'unavailable' }, failed));
    check((await loadSharedLabelSnapshot(pool, label, 'relations', failed)).status === 'unavailable');
    check(await storeSharedLabelSnapshot(pool, label, 'relations', { status: 'ready', data }, now));
    check((await loadSharedLabelSnapshot(pool, label, 'relations', failed)).status === 'unavailable');
    check((await loadSharedLabelSnapshot(pool, label.toUpperCase(), 'relations', failed)).status === 'unavailable');
    check(await storeSharedLabelCooldown(pool, 8_640_000_000_000_000, now));
    check((await loadSharedLabelCooldown(pool)) === 8_640_000_000_000_000);
    check(await storeSharedLabelCooldown(pool, now.getTime() + 1000, now));
    check((await loadSharedLabelCooldown(pool)) === 8_640_000_000_000_000);
    check(
      (await withSharedLabelProducerLease(pool, async (assertLease) => {
        await assertLease();
        return true;
      })) === true,
    );
    check(await reserveSharedLabelWire(pool, now, 1));
    check(!(await reserveSharedLabelWire(pool, now, 1)));
    return { checks, realSql: true, isolatedPort: 18169, productionCostMeasured: false, networkRequests: 0 };
  } finally {
    await pool.query('DELETE FROM topic_shared_label_snapshots WHERE label_hash=?', [labelHash]);
    await pool.query("DELETE FROM shared_label_sync_control WHERE scope='tag'");
    await pool.query("DELETE FROM work_budgets WHERE scope='shared-label:wire'");
  }
}
