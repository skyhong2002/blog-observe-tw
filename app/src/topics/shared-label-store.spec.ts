import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHARED_LABEL_CONTRACT } from './shared-label-contract.ts';
import {
  loadSharedLabelCooldown,
  loadSharedLabelSnapshot,
  SHARED_LABEL_EXPIRY_MS,
  storeSharedLabelCooldown,
  storeSharedLabelSnapshot,
} from './shared-label-store.ts';

const label = '榴槤',
  now = new Date('2026-10-13T00:00:00Z');
const data = { tag: label, tagId: createHash('sha256').update(label).digest('hex'), relations: [], truncated: false };
function fixture() {
  let row: Record<string, unknown> | undefined = {
    exact_label: label,
    status: 'ready',
    validated_dto: JSON.stringify(data),
    fetched_at: now,
    expires_at: new Date(now.getTime() + SHARED_LABEL_EXPIRY_MS),
    source_contract_sha: SHARED_LABEL_CONTRACT.sourceSHA,
    payload_version: null,
  };
  const query = vi.fn(async (options: { sql: string; values: unknown[]; timeout: number }) => {
    expect(options.sql).toMatch(/^SET STATEMENT max_statement_time=0.25 FOR /);
    expect(options.timeout).toBe(500);
    return [row ? [row] : []];
  });
  const c = { query, release: vi.fn(), destroy: vi.fn() };
  const pool = { getConnection: vi.fn(async () => c) } as unknown as Pool;
  return {
    pool,
    c,
    get: () => row,
    set: (value: Record<string, unknown> | undefined) => {
      row = value;
    },
  };
}
afterEach(() => vi.useRealTimers());
describe('local shared label snapshots, fresh bounded SQL', () => {
  it('freshly rereads current status and independently projects kind; UTC driver Date explicit', async () => {
    const f = fixture();
    expect(await loadSharedLabelSnapshot(f.pool, label, 'relations', now)).toMatchObject({ status: 'ready', data, payloadVersion: null });
    f.set({ ...f.get(), status: 'unavailable' });
    expect(await loadSharedLabelSnapshot(f.pool, label, 'relations', now)).toMatchObject({ status: 'unavailable' });
    f.set({ ...f.get(), status: 'missing' });
    expect(await loadSharedLabelSnapshot(f.pool, label, 'visual', now)).toMatchObject({ status: 'missing' });
    expect(f.c.query).toHaveBeenCalledTimes(3);
    f.set({ ...f.get(), fetched_at: '2026-10-13 00:00:00' });
    expect((await loadSharedLabelSnapshot(f.pool, label, 'relations', now)).status).toBe('unavailable');
  });
  it.each(['expiry', 'contract', 'label', 'payload-version', 'invalid-json'])(
    'fails closed for %s and never returns old ready',
    async (reason) => {
      const f = fixture(),
        r = f.get()!;
      if (reason === 'expiry') r.expires_at = now;
      if (reason === 'contract') r.source_contract_sha = '0'.repeat(40);
      if (reason === 'label') r.exact_label = '芒果';
      if (reason === 'payload-version') r.payload_version = 'invented';
      if (reason === 'invalid-json') r.validated_dto = '[]';
      expect((await loadSharedLabelSnapshot(f.pool, label, 'relations', now)).status).toBe('unavailable');
    },
  );
  it('persists only validated allowlist DTO; failure clears data and older writes use timestamp CAS', async () => {
    const f = fixture();
    expect(
      await storeSharedLabelSnapshot(f.pool, label, 'relations', { status: 'ready', data: { ...data, token: 'NEVER_STORE' } }, now),
    ).toBe(true);
    expect(JSON.stringify(f.c.query.mock.calls[0][0].values)).not.toContain('NEVER_STORE');
    expect(await storeSharedLabelSnapshot(f.pool, label, 'relations', { status: 'unavailable' }, now)).toBe(true);
    expect(f.c.query.mock.calls[1][0].values[4]).toBeNull();
    expect(f.c.query.mock.calls[1][0].sql).toContain('VALUES(fetched_at)>=fetched_at');
    expect(await storeSharedLabelSnapshot(f.pool, label, 'relations', { status: 'ready', data: { ...data, tag: '芒果' } }, now)).toBe(true);
    expect(f.c.query.mock.calls[2][0].values[3]).toBe('unavailable');
    expect(f.c.query.mock.calls[2][0].values[4]).toBeNull();
  });
  it('holds timed-out acquisition admissions until settled; late connection never queries', async () => {
    vi.useFakeTimers();
    const a = Promise.withResolvers<unknown>(),
      b = Promise.withResolvers<unknown>();
    const getConnection = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const pool = { getConnection } as unknown as Pool;
    const first = loadSharedLabelSnapshot(pool, label, 'relations', now),
      second = loadSharedLabelSnapshot(pool, label, 'visual', now);
    await vi.advanceTimersByTimeAsync(1501);
    expect((await first).status).toBe('unavailable');
    expect((await second).status).toBe('unavailable');
    for (let i = 0; i < 10; i++) expect((await loadSharedLabelSnapshot(pool, label, 'relations', now)).status).toBe('unavailable');
    expect(getConnection).toHaveBeenCalledTimes(2);
    const c = { query: vi.fn(), release: vi.fn(), destroy: vi.fn() };
    a.resolve(c);
    b.resolve(c);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.query).not.toHaveBeenCalled();
    expect(c.release).toHaveBeenCalledTimes(2);
  });
  it('persists maximum representable cooldown as BIGINT epoch, not limited DATETIME', async () => {
    const f = fixture();
    f.set({ retry_after_epoch_ms: '8640000000000000' });
    expect(await loadSharedLabelCooldown(f.pool)).toBe(8_640_000_000_000_000);
    expect(await storeSharedLabelCooldown(f.pool, 8_640_000_000_000_000, now)).toBe(true);
    expect(f.c.query.mock.calls[1][0].sql).toContain('GREATEST(retry_after_epoch_ms,VALUES(retry_after_epoch_ms))');
    f.set({ retry_after_epoch_ms: '9000000000000000' });
    expect(await loadSharedLabelCooldown(f.pool)).toBeNull();
  });
});
