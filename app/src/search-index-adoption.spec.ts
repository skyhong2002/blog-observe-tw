import { describe, expect, it, vi } from 'vitest';
import { createSearchIndexAdoption } from './search-index-adoption.ts';

const event = (postId = 20875) => ({
  commitState: 'committed',
  status: 'ok',
  changed: true,
  publicationStatus: 'verified',
  postId,
  blogId: 38,
  postOwnerBlogId: 38,
  bodyOwnerBlogId: 38,
});
describe('unwired committed-body adoption contract', () => {
  it('defaults off without reading environment or invoking enqueue', async () => {
    const enqueue = vi.fn();
    const batch = createSearchIndexAdoption({ enqueue });
    expect(batch.recordCommitted(event()).status).toBe('disabled');
    expect((await batch.flush()).state).toBe('disabled');
    expect(enqueue).not.toHaveBeenCalled();
  });
  it.each([
    { commitState: 'pending' },
    { commitState: 'rollback' },
    { commitState: 'unknown' },
    { changed: false },
    { status: 'partial' },
    { publicationStatus: 'moved' },
    { postId: null },
    { postOwnerBlogId: 39 },
    { bodyOwnerBlogId: 39 },
  ])('requires explicit durable changed ok ownership, rejecting %j', (patch) => {
    const batch = createSearchIndexAdoption({ enabled: true });
    expect(batch.recordCommitted({ ...event(), ...patch }).status).toBe('skipped');
    expect(batch.snapshot().pending).toEqual([]);
  });
  it('retains only allowlisted metadata and deduplicates post IDs', async () => {
    const enqueue = vi.fn(async (ids) => ({ acceptedPostIds: ids }));
    const batch = createSearchIndexAdoption({ enabled: true, enqueue });
    expect(
      batch.recordCommitted({
        ...event(),
        body: 'PRIVATE_BODY',
        url: 'https://private.invalid/?token=PRIVATE_SECRET',
        hash: 'PRIVATE_HASH',
        secret: 'PRIVATE_SECRET',
      }).status,
    ).toBe('recorded');
    expect(batch.recordCommitted(event()).status).toBe('duplicate');
    expect(JSON.stringify(batch.snapshot())).not.toContain('PRIVATE');
    expect(enqueue).not.toHaveBeenCalled();
    const result = await batch.flush();
    expect(enqueue.mock.calls[0][0]).toEqual([20875]);
    expect(result).toMatchObject({ state: 'queued', indexed: false, acknowledgedPostIds: [20875], pending: [] });
  });
  it('caps10 unique IDs and declares overflow rather than accepting hidden extra work', () => {
    const batch = createSearchIndexAdoption({ enabled: true });
    for (let id = 1; id <= 10; id++) expect(batch.recordCommitted(event(id)).status).toBe('recorded');
    expect(batch.recordCommitted(event(11)).status).toBe('full');
    expect(batch.snapshot()).toMatchObject({ overflow: true });
    expect(batch.snapshot().pending).toHaveLength(10);
  });
  it('rollback/discard before flush schedulesnothing and closes that batch', async () => {
    const enqueue = vi.fn();
    const batch = createSearchIndexAdoption({ enabled: true, enqueue });
    batch.recordCommitted(event());
    batch.discard();
    expect((await batch.flush()).state).toBe('discarded');
    expect(batch.recordCommitted(event(2)).status).toBe('closed');
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('enqueue failure retains repair IDs and never repeats automatically or copies error text', async () => {
    const enqueue = vi.fn(async () => {
      throw Error('PRIVATE_QUEUE_SECRET');
    });
    const batch = createSearchIndexAdoption({ enabled: true, enqueue });
    batch.recordCommitted(event());
    const result = await batch.flush();
    expect(result).toMatchObject({ state: 'needs-repair', pending: [{ postId: 20875, blogId: 38 }], indexed: false });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
    await batch.flush();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('partial acknowledgement explicitly retains only unaccepted repair IDs', async () => {
    const enqueue = vi.fn(async () => ({ acceptedPostIds: [1] }));
    const batch = createSearchIndexAdoption({ enabled: true, enqueue });
    batch.recordCommitted(event(1));
    batch.recordCommitted(event(2));
    expect(await batch.flush()).toMatchObject({
      state: 'needs-repair',
      acknowledgedPostIds: [1],
      pending: [{ postId: 2, blogId: 38 }],
      indexed: false,
    });
  });
  it.each([undefined, { acceptedPostIds: [99] }, { acceptedPostIds: [1, 1] }, { acceptedPostIds: '1' }])(
    'unverified enqueue response is repair, not success: %j',
    async (ack) => {
      const batch = createSearchIndexAdoption({ enabled: true, enqueue: vi.fn(async () => ack) as never });
      batch.recordCommitted(event(1));
      expect((await batch.flush()).state).toBe('needs-repair');
    },
  );
  it('one in-flight flush cannot duplicate requests or add/discard work mid-enqueue', async () => {
    let resolve!: (v: { acceptedPostIds: number[] }) => void;
    const enqueue = vi.fn(() => new Promise<{ acceptedPostIds: number[] }>((r) => (resolve = r)));
    const batch = createSearchIndexAdoption({ enabled: true, enqueue });
    batch.recordCommitted(event(1));
    const run = batch.flush();
    expect((await batch.flush()).state).toBe('flushing');
    expect(batch.recordCommitted(event(2)).status).toBe('closed');
    expect(batch.discard()).toMatchObject({ status: 'in-flight', cancellation: 'not-guaranteed' });
    resolve({ acceptedPostIds: [1] });
    expect((await run).state).toBe('queued');
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
  it('missing injected enqueue is explicit repair andnever falls back to worker/network', async () => {
    const batch = createSearchIndexAdoption({ enabled: true });
    batch.recordCommitted(event());
    expect((await batch.flush()).state).toBe('needs-repair');
  });
  it('ignores adversarial ack iterator and copies only once-read indexed requested IDs', async () => {
    const accepted = [1];
    const iterator = vi.fn(() => [99][Symbol.iterator]());
    accepted[Symbol.iterator] = iterator;
    const batch = createSearchIndexAdoption({ enabled: true, enqueue: async () => ({ acceptedPostIds: accepted }) });
    batch.recordCommitted(event(1));
    expect(await batch.flush()).toMatchObject({ state: 'queued', acknowledgedPostIds: [1], pending: [] });
    expect(iterator).not.toHaveBeenCalled();
  });
  it('captures changing primitive event getters once and never stores their second secret value', () => {
    const batch = createSearchIndexAdoption({ enabled: true });
    const raw = { ...event(1) };
    const getPostId = vi.fn().mockReturnValueOnce(1).mockReturnValue('PRIVATE_FIXTURE');
    const getBlogId = vi.fn().mockReturnValueOnce(38).mockReturnValue(99);
    Object.defineProperty(raw, 'postId', { get: getPostId });
    Object.defineProperty(raw, 'blogId', { get: getBlogId });
    expect(batch.recordCommitted(raw).status).toBe('recorded');
    expect(batch.snapshot().pending).toEqual([{ postId: 1, blogId: 38 }]);
    expect(getPostId).toHaveBeenCalledTimes(1);
    expect(getBlogId).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(batch.snapshot())).not.toContain('PRIVATE_FIXTURE');
  });
  it('throwing metadata getters are skipped without bubbling secret errors into committed content callers', () => {
    const batch = createSearchIndexAdoption({ enabled: true });
    const raw = { ...event(1) };
    Object.defineProperty(raw, 'postId', {
      get() {
        throw Error('PRIVATE_FIXTURE');
      },
    });
    expect(batch.recordCommitted(raw)).toEqual({ status: 'skipped' });
    expect(batch.snapshot().pending).toEqual([]);
  });
  it('getter that closes the batch is conservatively skipped after capturing metadata', () => {
    const batch = createSearchIndexAdoption({ enabled: true });
    const raw = { ...event(1) };
    Object.defineProperty(raw, 'postId', {
      get() {
        batch.discard();
        return 1;
      },
    });
    expect(batch.recordCommitted(raw)).toEqual({ status: 'skipped' });
    expect(batch.snapshot()).toMatchObject({ state: 'discarded', pending: [] });
  });
  it('ack indexed accessor is captured once even if future reads change to an unrequested ID', async () => {
    const accepted = [1];
    const getId = vi.fn().mockReturnValueOnce(1).mockReturnValue(99);
    Object.defineProperty(accepted, '0', { get: getId });
    const batch = createSearchIndexAdoption({ enabled: true, enqueue: async () => ({ acceptedPostIds: accepted }) });
    batch.recordCommitted(event(1));
    expect(await batch.flush()).toMatchObject({ state: 'queued', acknowledgedPostIds: [1] });
    expect(getId).toHaveBeenCalledTimes(1);
  });
});
