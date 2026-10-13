import { describe, expect, it, vi } from 'vitest';
import { HttpSnapshotChangesSource } from './snapshot-changes-client.ts';
import { pinChangesGeneration } from './snapshot-changes-contract.ts';
import { hash, MAX_SNAPSHOT_PAGE_BYTES, SOURCE } from './snapshot-client.ts';

const after = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  target = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const generation = {
  schemaVersion: 1,
  kind: 'delta',
  id: target,
  previousId: after,
  baseSnapshotId: after,
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: SOURCE,
  total: 0,
  pageSize: 500,
  changeCount: 0,
  changePages: [],
  noisePolicyVersion: 'v1',
};
const page = (cursor = '0', nextCursor: string | null = null) => ({
  snapshot: generation,
  entries: [],
  cursor,
  nextCursor,
  sha256: hash('[]\n'),
});
describe('opt-in read-only changes source', () => {
  it('default disabled and invalid selection never call transport', async () => {
    const request = vi.fn();
    expect(await new HttpSnapshotChangesSource(request).first(after)).toMatchObject({ status: 'disabled' });
    const source = new HttpSnapshotChangesSource(request, { enabled: true });
    expect(await source.first('secret/other')).toMatchObject({ status: 'invalid-selection' });
    expect(await source.page({ ...pinChangesGeneration(after, generation), target: '//evil' }, '0')).toMatchObject({
      status: 'invalid-selection',
    });
    expect(await source.page(pinChangesGeneration(after, generation), '0&evil=1')).toMatchObject({ status: 'invalid-selection' });
    expect(request).not.toHaveBeenCalled();
  });
  it('pins initial target and subsequent pages and retains the current pointer', async () => {
    const request = vi.fn(async (_url: string | URL | Request) => Response.json(page()));
    const source = new HttpSnapshotChangesSource(request, { enabled: true, delayMs: 500, sleep: async () => {} });
    const first = await source.first(after);
    expect(first).toMatchObject({
      status: 'ready',
      pin: { after, target },
      chain: 'unverified',
      cutoverAllowed: false,
      retainCurrent: true,
    });
    if (first.status !== 'ready') return;
    expect(await source.page(first.pin, '0')).toMatchObject({ status: 'ready', completeGeneration: false });
    expect(request.mock.calls.map((c) => String(c[0]))).toEqual([
      `http://127.0.0.1:18130/api/v1/vocabulary/changes?after=${after}&cursor=0`,
      `http://127.0.0.1:18130/api/v1/vocabulary/changes?after=${after}&target=${target}&cursor=0`,
    ]);
  });
  it('409 requires rebase without automatic full download; 503 stays unavailable', async () => {
    for (const status of [409, 503]) {
      const request = vi.fn(async () => new Response(null, { status }));
      expect(await new HttpSnapshotChangesSource(request, { enabled: true }).first(after)).toEqual({
        status: status === 409 ? 'need-full-rebase' : 'unavailable',
        retainCurrent: true,
      });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it('accepts a persisted JSON pin and never relies on JS object prototypes', async () => {
    const pin = JSON.parse(JSON.stringify(pinChangesGeneration(after, generation)));
    const request = vi.fn(async () => Response.json(page()));
    const result = await new HttpSnapshotChangesSource(request, { enabled: true }).page(pin, '0');
    expect(result).toMatchObject({ status: 'ready', chain: 'unverified', retainCurrent: true });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects null, array and primitive responses as permanent contract failures', async () => {
    for (const body of [null, [], 42, 'unexpected']) {
      const request = vi.fn(async () => Response.json(body));
      expect(await new HttpSnapshotChangesSource(request, { enabled: true }).first(after)).toEqual({
        status: 'failed',
        reason: 'invalid-contract',
        retainCurrent: true,
      });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it('preserves Retry-After defer time without shortening or automatically rebasing', async () => {
    const now = Date.parse('2026-10-13T00:00:00.000Z');
    const request = vi.fn(async () => new Response(null, { status: 429, headers: { 'retry-after': '3600' } }));
    expect(await new HttpSnapshotChangesSource(request, { enabled: true, now: () => now }).first(after)).toEqual({
      status: 'deferred',
      nextAttemptAt: '2026-10-13T01:00:00.000Z',
      retainCurrent: true,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('permanent malformed/oversize pages fail without raw data or transport retry', async () => {
    for (const response of [
      () => new Response('not json'),
      () => new Response('x'.repeat(MAX_SNAPSHOT_PAGE_BYTES + 1)),
      () => Response.json({ ...page(), sha256: '0'.repeat(64) }),
    ]) {
      const request = vi.fn(async () => response());
      const result = await new HttpSnapshotChangesSource(request, { enabled: true }).first(after);
      expect(result).toEqual({ status: 'failed', reason: 'invalid-contract', retainCurrent: true });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
  it('network failure preserves current; target metadata drift is a contract failure', async () => {
    const offline = vi.fn(async () => {
      throw Error('SECRET_VALUE');
    });
    expect(await new HttpSnapshotChangesSource(offline, { enabled: true, fallback: false }).first(after)).toEqual({
      status: 'unavailable',
      retainCurrent: true,
    });
    const request = vi.fn(async () => Response.json({ ...page(), snapshot: { ...generation, sourceAsOf: { changed: true } } }));
    expect(await new HttpSnapshotChangesSource(request, { enabled: true }).page(pinChangesGeneration(after, generation), '0')).toEqual({
      status: 'failed',
      reason: 'invalid-contract',
      retainCurrent: true,
    });
  });
});
