import { describe, expect, it, vi } from 'vitest';
import { createBodyIndexStages } from './search-index-staging.ts';

const event = (postId = 1) => ({
  postId,
  blogId: 5,
  postOwnerBlogId: 5,
  bodyOwnerBlogId: 5,
  publicationStatus: 'verified',
  status: 'ok',
  changed: true,
});
describe('transaction-local body stages', () => {
  it('staging is not committed; rollback discards only this transaction', async () => {
    const enqueue = vi.fn(async (ids: readonly number[]) => ({ acceptedPostIds: ids }));
    const batch = createBodyIndexStages({ indexAdoptionEnabled: true, enqueueIndex: enqueue }, 'relations');
    const first = batch.transaction();
    first.stage(event(1));
    first.committed();
    const second = batch.transaction();
    second.stage(event(2));
    second.discard();
    expect(enqueue).not.toHaveBeenCalled();
    expect(await batch.flush()).toMatchObject({ state: 'queued', acknowledgedPostIds: [1], indexed: false });
    expect(enqueue).toHaveBeenCalledWith([1]);
  });
  it('captures primitives once, skips throwing getter and never retains extras', async () => {
    const enqueue = vi.fn(async (ids: readonly number[]) => ({ acceptedPostIds: ids }));
    const batch = createBodyIndexStages({ indexAdoptionEnabled: true, enqueueIndex: enqueue }, 'feed');
    const staged = batch.transaction();
    let reads = 0;
    const changing = { ...event(), secret: 'PRIVATE' };
    Object.defineProperty(changing, 'postId', {
      get() {
        reads++;
        return reads === 1 ? 1 : 'PRIVATE';
      },
    });
    staged.stage(changing);
    const throwing = { ...event(2) };
    Object.defineProperty(throwing, 'postId', {
      get() {
        throw Error('secret');
      },
    });
    expect(() => staged.stage(throwing)).not.toThrow();
    staged.committed();
    expect(reads).toBe(1);
    expect(JSON.stringify(await batch.flush())).not.toContain('PRIVATE');
    expect(enqueue).toHaveBeenCalledWith([1]);
  });
  it('keeps first10 unique only; overflow events are not fictional unique counts', async () => {
    const batch = createBodyIndexStages({ indexAdoptionEnabled: true, enqueueIndex: async (ids) => ({ acceptedPostIds: ids }) }, 'history');
    const stage = batch.transaction();
    for (let i = 1; i <= 12; i++) stage.stage(event(i));
    stage.stage(event(1));
    stage.stage(event(12));
    stage.committed();
    expect(await batch.flush()).toMatchObject({
      state: 'needs-repair',
      partial: true,
      overflowed: true,
      overflowEvents: 3,
      scopeRepair: [5],
      acknowledgedPostIds: Array.from({ length: 10 }, (_, i) => i + 1),
    });
  });
  it('batch cap spans independently committed stages and is visibly partial', async () => {
    const batch = createBodyIndexStages(
      { indexAdoptionEnabled: true, enqueueIndex: async (ids) => ({ acceptedPostIds: ids }) },
      'relations',
    );
    for (let i = 1; i <= 11; i++) {
      const stage = batch.transaction();
      stage.stage(event(i));
      stage.committed();
    }
    expect(await batch.flush()).toMatchObject({ state: 'needs-repair', overflowEvents: 1 });
  });
  it('disabled/partial/retained/private ownership events never queue', async () => {
    for (const enabled of [false, true]) {
      const enqueue = vi.fn();
      const batch = createBodyIndexStages({ indexAdoptionEnabled: enabled, enqueueIndex: enqueue }, 'feed');
      const stage = batch.transaction();
      for (const patch of [{ changed: false }, { status: 'partial' }, { publicationStatus: 'hidden' }, { bodyOwnerBlogId: 6 }])
        stage.stage({ ...event(), ...patch });
      if (!enabled) stage.stage(event());
      stage.committed();
      await batch.flush();
      expect(enqueue).not.toHaveBeenCalled();
    }
  });
  it('unproven transaction never claims committed; emits scope repair without queue', async () => {
    const enqueue = vi.fn();
    const batch = createBodyIndexStages({ indexAdoptionEnabled: true, enqueueIndex: enqueue }, 'feed');
    const stage = batch.transaction();
    stage.stage(event());
    stage.unproven();
    expect(await batch.flush()).toMatchObject({
      state: 'needs-repair',
      reason: 'unproven-transaction',
      scopeRepair: [5],
      pendingPostIds: [],
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('partial ack and reporter failure cannot fail committed source; concurrent flush waits same outcome', async () => {
    let resolve!: (value: { acceptedPostIds: number[] }) => void;
    const enqueue = vi.fn(
      () =>
        new Promise<{ acceptedPostIds: number[] }>((r) => {
          resolve = r;
        }),
    );
    const batch = createBodyIndexStages(
      {
        indexAdoptionEnabled: true,
        enqueueIndex: enqueue,
        onIndexAdoptionReport: () => {
          throw Error('logger');
        },
      },
      'history',
    );
    const stage = batch.transaction();
    stage.stage(event(1));
    stage.stage(event(2));
    stage.committed();
    const first = batch.flush(),
      second = batch.flush();
    resolve({ acceptedPostIds: [1] });
    expect(await first).toMatchObject({ state: 'needs-repair', pendingPostIds: [2], acknowledgedPostIds: [1] });
    expect(await second).toEqual(await first);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});

it('async reporter rejection is caught without delaying committed work or claiming durable audit delivery', async () => {
  const batch = createBodyIndexStages(
    {
      indexAdoptionEnabled: true,
      enqueueIndex: async (ids) => ({ acceptedPostIds: ids }),
      onIndexAdoptionReport: async () => {
        throw Error('report failed');
      },
    },
    'feed',
  );
  const tx = batch.transaction();
  tx.stage(event());
  tx.committed();
  const result = await batch.flush();
  await Promise.resolve();
  expect(result).toMatchObject({ state: 'queued', indexed: false, reporting: 'failed' });
});
