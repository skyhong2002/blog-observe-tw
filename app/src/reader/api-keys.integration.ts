import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { apiKeyHash, createApiKeyService } from './api-keys.ts';

/** Called only by tools/test-integration.mjs in its disposable database on 18169. */
export async function runApiKeyIntegration(pool: Pool) {
  const users: number[] = [];
  for (let i = 0; i < 2; i++) {
    const [result] = await pool.query<ResultSetHeader>(
      'INSERT INTO users(google_sub,email,created_at,last_login_at) VALUES(?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())',
      [`api-test-${randomUUID()}`, `api-${i}@example.test`],
    );
    users.push(result.insertId);
  }
  const service = createApiKeyService(pool);
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => service.create(users[0], `client ${i}`)));
  const created = attempts
    .filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof service.create>>> => item.status === 'fulfilled')
    .map((item) => item.value);
  assert.equal(created.length, 3, 'atomic quota holds across concurrent creators');
  for (const attempt of attempts) if (attempt.status === 'rejected') assert.equal(attempt.reason.code, 'key_limit');
  const [stored] = await pool.query<RowDataPacket[]>('SELECT * FROM user_api_keys WHERE user_id=?', [users[0]]);
  assert.equal(stored.length, 3);
  for (const item of created) {
    const row = stored.find((entry) => entry.key_hash === apiKeyHash(item.key));
    assert.ok(row);
    assert.equal(row.prefix, item.key.slice(0, 10));
    assert.ok(!JSON.stringify(stored).includes(item.key), 'raw key never persists');
    assert.ok(!JSON.stringify(await service.list(users[0])).includes(item.key));
  }
  const first = created[0];
  const identity = await service.identify(first.key);
  assert.ok(identity);
  await assert.rejects(service.revoke(users[1], identity.id), { code: 'not_found' });
  assert.deepEqual(await service.identify(first.key), identity, 'another user cannot revoke');
  await service.revoke(users[0], identity.id);
  assert.equal(await service.identify(first.key), null, 'revocation invalidates positive cache immediately');
  assert.equal((await service.list(users[0])).length, 2);
  await service.create(users[0], 'replacement');
  assert.equal((await service.list(users[0])).length, 3);
  assert.equal((await service.list(users[1])).length, 0);
  return { concurrentAttempts: 8, created: 3, hashOnly: true, ownership: true, immediateRevocation: true };
}
