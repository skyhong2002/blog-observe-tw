import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLIENT_CACHE_MAX, CLIENT_CACHE_TTL_MS, CLIENT_TIMEOUT_MS, createPublicLoader, type PublicLoad } from '../src/lib/public-loader.ts';
import { EMPTY, json, PATHS } from './public-payloads.ts';

/** A fetch whose answers the test releases; it rejects when its request is aborted, as fetch does. */
function deferredFetch() {
  const calls: Array<{ path: string; init: RequestInit; answer: (response: Response) => void }> = [];
  const fetch = (path: string, init: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      calls.push({ path, init, answer: resolve });
    });
  return { calls, fetch };
}
function clock() {
  let at = 1_000_000;
  const timers = new Map<number, () => void>();
  let next = 0;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
    setTimer: (run: () => void, _ms: number) => {
      timers.set(++next, run);
      return next;
    },
    clearTimer: (timer: unknown) => {
      timers.delete(timer as number);
    },
    /** Fires every pending timer (the read timeouts). */
    fire: () => {
      for (const [id, run] of [...timers]) {
        timers.delete(id);
        run();
      }
    },
    pending: () => timers.size,
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const asIs = (raw: unknown) => raw;
const topics = (days: number) => ({ ...(EMPTY.topics as object), days });

test('loader: same-origin, cookie-free GET of a public path', async () => {
  const { calls, fetch } = deferredFetch();
  const time = clock();
  const loader = createPublicLoader({ fetch, ...time });
  const result = loader.load(PATHS.topics, asIs, new AbortController().signal);
  await tick();
  assert.equal(calls[0].path, PATHS.topics);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.deepEqual(calls[0].init.headers, { accept: 'application/json' });
  calls[0].answer(json(200, topics(7)));
  assert.deepEqual(await result, { status: 'ready', data: topics(7) });
  assert.equal(time.pending(), 0, 'the timeout is cleared');
  assert.deepEqual(await loader.load('/api/me/follows', asIs, new AbortController().signal), { status: 'error' });
  assert.equal(calls.length, 1, 'a private path is never requested');
});

test('loader: answers live CLIENT_CACHE_TTL_MS (the ISR period), then are read again', async () => {
  const { calls, fetch } = deferredFetch();
  const time = clock();
  const loader = createPublicLoader({ fetch, ...time });
  assert.equal(CLIENT_CACHE_TTL_MS, 120_000);
  const first = loader.load(PATHS.topics, asIs, new AbortController().signal);
  await tick();
  calls[0].answer(json(200, topics(7)));
  await first;
  time.advance(CLIENT_CACHE_TTL_MS - 1);
  assert.deepEqual(loader.fresh(PATHS.topics), { data: topics(7) });
  time.advance(1);
  assert.equal(loader.fresh(PATHS.topics), undefined, 'expired');
  assert.equal(loader.size(), 0);
  // Returning to the query after expiry asks the gateway again.
  const settled: Array<[string, PublicLoad<unknown>]> = [];
  loader.runner<unknown>((path, load) => settled.push([path, load])).run(PATHS.topics, asIs);
  await tick();
  assert.equal(calls.length, 2);
  calls[1].answer(json(200, topics(70)));
  await tick();
  assert.deepEqual(settled, [[PATHS.topics, { status: 'ready', data: topics(70) }]]);
});

test('loader: at most CLIENT_CACHE_MAX answers, least recently used out first', async () => {
  const path = (i: number) => `/api/catalog?page=${i}`;
  const catalog = (i: number) => ({ ...(EMPTY.catalog as object), page: i });
  const catalogFetch = async (p: string) => json(200, catalog(Number(new URL(p, 'http://x').searchParams.get('page'))));
  const catalogs = createPublicLoader({ fetch: catalogFetch, ...clock() });
  for (let i = 1; i <= CLIENT_CACHE_MAX; i++) await catalogs.load(path(i), asIs, new AbortController().signal);
  assert.equal(catalogs.size(), CLIENT_CACHE_MAX);
  await catalogs.load(path(1), asIs, new AbortController().signal); // page 1 is now the most recent
  await catalogs.load(path(CLIENT_CACHE_MAX + 1), asIs, new AbortController().signal);
  assert.equal(catalogs.size(), CLIENT_CACHE_MAX);
  assert.ok(catalogs.fresh(path(1)), 'recently used stays');
  assert.equal(catalogs.fresh(path(2)), undefined, 'least recently used is evicted');
});

test('loader: a timeout is an error, never an endless pending', async () => {
  const { calls, fetch } = deferredFetch();
  const time = clock();
  const loader = createPublicLoader({ fetch, ...time });
  assert.equal(CLIENT_TIMEOUT_MS, 10_000);
  const settled: Array<PublicLoad<unknown>> = [];
  loader.runner<unknown>((_path, load) => settled.push(load)).run(PATHS.topics, asIs);
  await tick();
  assert.equal(calls.length, 1);
  time.fire();
  await tick();
  assert.deepEqual(settled, [{ status: 'error' }]);
  assert.equal(loader.size(), 0);
});

test('loader: 404 is missing, other statuses and wrong shapes are errors; nothing is remembered', async () => {
  for (const [response, expected] of [
    [json(404, { error: 'tag not found' }), 'missing'],
    [json(500), 'error'],
    [json(503), 'error'],
    [json(200, {}), 'error'],
    [json(200, null), 'error'],
    [json(200, { topic: null, blogs: [], articles: [] }), 'error'],
    [new Response('<html>', { status: 200 }), 'error'],
  ] as const) {
    const loader = createPublicLoader({ fetch: async () => response, ...clock() });
    assert.deepEqual(await loader.load(PATHS.topic, asIs, new AbortController().signal), { status: expected });
    assert.equal(loader.size(), 0);
  }
  // A parser that rejects the payload is an error too.
  const loader = createPublicLoader({ fetch: async () => json(200, EMPTY.topic), ...clock() });
  assert.deepEqual(await loader.load(PATHS.topic, () => null, new AbortController().signal), { status: 'error' });
});

test('loader: an aborted read settles nothing and caches nothing, even if its answer arrives', async () => {
  const { calls, fetch } = deferredFetch();
  const loader = createPublicLoader({ fetch, ...clock() });
  const controller = new AbortController();
  const result = loader.load(PATHS.topics, asIs, controller.signal);
  await tick();
  controller.abort();
  calls[0].answer(json(200, topics(7)));
  assert.equal(await result, null);
  assert.equal(loader.size(), 0);
});

test('loader: an older query answering or parsing late never overwrites or caches over the newer one', async () => {
  const { calls, fetch } = deferredFetch();
  const loader = createPublicLoader({ fetch, ...clock() });
  const settled: Array<[string, PublicLoad<unknown>]> = [];
  const view = loader.runner<unknown>((path, load) => settled.push([path, load]));
  const older = '/api/topics?days=7';
  const newer = '/api/topics?days=90';
  let parsedOlder = 0;
  const parse = (raw: unknown, path: string) => {
    if (path === older) parsedOlder++;
    return raw;
  };
  view.run(older, parse);
  await tick();
  view.run(newer, parse);
  await tick();
  assert.equal(calls.length, 2);
  // The older request was aborted when the newer started; its late answer goes nowhere.
  assert.equal(calls[0].init.signal?.aborted, true);
  calls[0].answer(json(200, topics(7)));
  calls[1].answer(json(200, topics(90)));
  await tick();
  assert.deepEqual(settled, [[newer, { status: 'ready', data: topics(90) }]]);
  assert.equal(parsedOlder, 0);
  assert.equal(loader.fresh(older), undefined);
  assert.deepEqual(loader.fresh(newer), { data: topics(90) });
  // Back to the older query: read again (it was never cached), newer stays instant.
  view.run(older, parse);
  await tick();
  assert.equal(calls.length, 3);
  view.run(newer, parse);
  assert.deepEqual(settled.at(-1), [newer, { status: 'ready', data: topics(90) }]);
  view.stop();
  calls[2].answer(json(200, topics(7)));
  await tick();
  assert.equal(settled.length, 2, 'a stopped view settles nothing');
});
