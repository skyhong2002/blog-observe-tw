import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import type { storeSharedLabelSnapshot } from './shared-label-store.ts';
import {
  type SharedLabelSyncDependencies,
  sharedLabelSyncClientFactory,
  sharedLabelSyncExitCode,
  syncSharedLabels,
} from './shared-label-sync.ts';
import { LOCAL_TAG_ORIGIN } from './transport.ts';

const label = '榴槤',
  now = new Date('2026-10-13T00:00:00Z'),
  pool = {} as Pool;
const packet = { tag: label, tagId: createHash('sha256').update(label).digest('hex'), relations: [], truncated: false };
function setup() {
  let cooldown = 0;
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    Response.json(String(url).endsWith('/relations') ? packet : { tag: label, visual: null }),
  );
  const write = vi.fn(async (..._args: Parameters<typeof storeSharedLabelSnapshot>) => true),
    reserveWire = vi.fn(async (_now: Date, _limit: number) => true),
    validatePublicLabel = vi.fn(async (_label: string) => true),
    assertLease = vi.fn(async () => {});
  const deps: SharedLabelSyncDependencies = {
    makeClient: sharedLabelSyncClientFactory(fetcher, {
      origin: LOCAL_TAG_ORIGIN,
      readServiceToken: async () => null,
      sleep: async () => {},
    }),
    write,
    reserveWire,
    validatePublicLabel,
    readCooldown: async () => cooldown,
    writeCooldown: async (value) => {
      cooldown = Math.max(cooldown, value);
      return true;
    },
    lease: async (work) => work(assertLease),
  };
  return { fetcher, write, reserveWire, validatePublicLabel, assertLease, deps, cooldown: () => cooldown };
}
describe('bounded manual shared label producer, mock only', () => {
  it('dry-run/off never creates client, writes DB or fetches; apply requires public validator', async () => {
    const f = setup();
    expect((await syncSharedLabels(pool, [label], f.deps)).mode).toBe('dry-run');
    expect((await syncSharedLabels(pool, [label], f.deps, { apply: true })).mode).toBe('disabled');
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    await expect(
      syncSharedLabels(pool, [label], { ...f.deps, validatePublicLabel: undefined }, { apply: true, enabled: true }),
    ).rejects.toThrow('public_validator_required');
    await expect(syncSharedLabels(pool, Array(11).fill(label), f.deps)).rejects.toThrow('invalid_shared_label_selection');
  });
  it('invalidates each kind before I/O, root eligibility rechecks per wire and after fetch, budget40 every wire', async () => {
    const f = setup();
    const result = await syncSharedLabels(pool, [label], f.deps, { apply: true, enabled: true, now: () => new Date() });
    expect(result).toMatchObject({ mode: 'apply', completedKinds: 2, stopped: false });
    expect(f.write.mock.calls.map((c) => c[3].status)).toEqual(['unavailable', 'ready', 'unavailable', 'ready']);
    expect(f.reserveWire).toHaveBeenCalledTimes(2);
    expect(f.reserveWire.mock.calls[0][1]).toBe(40);
    expect(f.validatePublicLabel.mock.calls.length).toBeGreaterThanOrEqual(5);
  });
  it('429 stops first batch, persists actual cooldown, new client/batch cannot bypass it', async () => {
    const f = setup();
    f.fetcher.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': String(10 * 86400) } }));
    const options = { apply: true, enabled: true, now: () => now };
    const first = await syncSharedLabels(pool, [label, '芒果'], f.deps, options);
    expect(first).toMatchObject({ stopped: true, stopReason: 'rate-limit', completedKinds: 1 });
    expect(f.cooldown()).toBe(now.getTime() + 10 * 86400_000);
    expect(f.fetcher).toHaveBeenCalledOnce();
    const second = await syncSharedLabels(pool, [label], f.deps, options);
    expect(second).toMatchObject({ stopped: true, stopReason: 'cooldown', completedKinds: 0 });
    expect(f.fetcher).toHaveBeenCalledOnce();
  });
  it('budget or failed cooldown persistence stops all later kind wires', async () => {
    const f = setup();
    f.reserveWire.mockResolvedValue(false);
    expect(await syncSharedLabels(pool, [label], f.deps, { apply: true, enabled: true, now: () => now })).toMatchObject({
      stopped: true,
      stopReason: 'budget',
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    const g = setup();
    g.deps.writeCooldown = async () => false;
    g.fetcher.mockImplementation(async () => new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
    expect(await syncSharedLabels(pool, [label], g.deps, { apply: true, enabled: true, now: () => now })).toMatchObject({
      stopped: true,
      stopReason: 'store',
    });
    expect(g.fetcher).toHaveBeenCalledOnce();
  });
  it('root rejects private/withdrawn topic without upstream read, and final-write crash cannot retain old ready', async () => {
    const f = setup();
    f.validatePublicLabel.mockResolvedValue(false);
    expect((await syncSharedLabels(pool, [label], f.deps, { apply: true, enabled: true, now: () => now })).skipped).toBe(1);
    expect(f.fetcher).not.toHaveBeenCalled();
    const g = setup();
    g.write.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await syncSharedLabels(pool, [label], g.deps, { apply: true, enabled: true, now: () => now })).toMatchObject({
      stopped: true,
      stopReason: 'store',
    });
    expect(g.write.mock.calls[0][3].status).toBe('unavailable');
    expect(g.fetcher).toHaveBeenCalledOnce();
  });
});

describe('producer deadline and CLI exit contract', () => {
  it('clock expiry after an in-flight kind stops before invalidating the untouched visual kind', async () => {
    const f = setup();
    let time = now.getTime();
    const visual = vi.fn(async () => ({ status: 'missing' as const }));
    f.deps.makeClient = () => ({
      relations: async () => {
        time += 30000;
        return { status: 'ready' as const, data: packet };
      },
      visual,
    });
    const result = await syncSharedLabels(pool, [label], f.deps, { apply: true, enabled: true, now: () => new Date(time) });
    expect(result).toMatchObject({ stopped: true, stopReason: 'deadline', completedKinds: 1 });
    expect(f.write.mock.calls.map((c) => [c[2], c[3].status])).toEqual([
      ['relations', 'unavailable'],
      ['relations', 'unavailable'],
    ]);
    expect(visual).not.toHaveBeenCalled();
    expect(f.reserveWire).not.toHaveBeenCalled();
  });
  it('clock expiry before preinvalidate leaves all not-started snapshots untouched', async () => {
    const f = setup();
    let time = now.getTime();
    f.assertLease.mockImplementation(async () => {
      time += 30000;
    });
    const result = await syncSharedLabels(pool, [label], f.deps, { apply: true, enabled: true, now: () => new Date(time) });
    expect(result).toMatchObject({ stopped: true, stopReason: 'deadline', completedKinds: 0 });
    expect(f.write).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('prewire rejects elapsed deadline without consuming a new wire budget', async () => {
    const f = setup();
    let time = now.getTime();
    f.deps.makeClient = (hooks) => ({
      relations: async () => {
        time += 30000;
        try {
          await hooks.beforeRequest?.();
        } catch {}
        return { status: 'unavailable' };
      },
      visual: async () => ({ status: 'missing' }),
    });
    expect(await syncSharedLabels(pool, [label], f.deps, { apply: true, enabled: true, now: () => new Date(time) })).toMatchObject({
      stopped: true,
      stopReason: 'deadline',
    });
    expect(f.reserveWire).not.toHaveBeenCalled();
  });
  it.each(['store', 'lease', 'deadline'] as const)('CLI %s failure exits nonzero', (stopReason) => {
    expect(sharedLabelSyncExitCode({ stopped: true, stopReason })).toBe(1);
  });
  it.each(['none', 'rate-limit', 'cooldown', 'budget'] as const)('CLI %s expected outcome keeps zero', (stopReason) => {
    expect(sharedLabelSyncExitCode({ stopped: stopReason !== 'none', stopReason })).toBe(0);
  });
});
