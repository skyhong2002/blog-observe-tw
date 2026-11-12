import assert from 'node:assert/strict';
import { test } from 'node:test';
import { followsSnapshot, subscribeFollows } from '../src/lib/follows-store.ts';

type Pending = { url: string; init: RequestInit | undefined; resolve: (response: Response) => void; reject: (error: unknown) => void };

function fakeFetch() {
  const calls: Pending[] = [];
  const fetcher = ((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      calls.push({ url, init, resolve, reject });
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    })) as unknown as typeof fetch;
  return { calls, fetcher };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const follow = { slug: 'a', name: '甲', url: 'https://a.example/', category: null, iconUrl: null };

test('follows: components mounted together share one no-store, same-origin read', async () => {
  const { calls, fetcher } = fakeFetch();
  let notified = 0;
  const offButton = subscribeFollows(() => notified++, fetcher);
  const offList = subscribeFollows(() => notified++, fetcher);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/me/follows');
  assert.equal(calls[0].init?.cache, 'no-store');
  assert.equal(calls[0].init?.credentials, 'same-origin');
  assert.deepEqual(followsSnapshot(), { status: 'loading' });
  calls[0].resolve(json(200, { follows: [follow] }));
  await flush();
  assert.deepEqual(followsSnapshot(), { status: 'ready', follows: [follow] });
  assert.equal(notified, 2);
  // A third component mounting while the answer is held reuses it.
  const offThird = subscribeFollows(() => undefined, fetcher);
  assert.equal(calls.length, 1);
  offButton();
  offList();
  offThird();
});

test('follows: the answer is dropped with the last reader; the next mount reads again', async () => {
  const { calls, fetcher } = fakeFetch();
  const off = subscribeFollows(() => undefined, fetcher);
  calls[0].resolve(json(200, { follows: [follow] }));
  await flush();
  off();
  // Signed out or another account since: nothing personal outlives the components that showed it.
  assert.deepEqual(followsSnapshot(), { status: 'loading' });
  const again = subscribeFollows(() => undefined, fetcher);
  assert.equal(calls.length, 2);
  calls[1].resolve(json(401, { error: 'login required' }));
  await flush();
  assert.deepEqual(followsSnapshot(), { status: 'login' });
  again();
});

test('follows: unmounting aborts the read and a late answer publishes nothing', async () => {
  const { calls, fetcher } = fakeFetch();
  let notified = 0;
  const off = subscribeFollows(() => notified++, fetcher);
  off();
  assert.equal(calls[0].init?.signal?.aborted, true);
  await flush();
  assert.equal(notified, 0);
  assert.deepEqual(followsSnapshot(), { status: 'loading' });
});

test('follows: a failed or malformed read is an error, never an empty list', async () => {
  for (const response of [json(500, {}), json(200, { follows: 'x' }), json(200, {})]) {
    const { calls, fetcher } = fakeFetch();
    const off = subscribeFollows(() => undefined, fetcher);
    calls[0].resolve(response);
    await flush();
    assert.deepEqual(followsSnapshot(), { status: 'error' });
    off();
  }
  const { calls, fetcher } = fakeFetch();
  const off = subscribeFollows(() => undefined, fetcher);
  calls[0].reject(new TypeError('network'));
  await flush();
  assert.deepEqual(followsSnapshot(), { status: 'error' });
  off();
});
