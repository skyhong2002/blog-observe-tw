import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLIENT_TIMEOUT_MS, createPublicLoader, type PublicLoad } from '../src/lib/public-loader.ts';
import { PUBLIC_KINDS } from '../src/lib/public-paths.ts';
import { createRefreshSignal, REFRESH_MERGE_MS } from '../src/lib/public-refresh.ts';
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
  const timers = new Map<number, () => void>();
  let next = 0;
  return {
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

test('loader: every public kind is fetched no-store and nothing is remembered', async () => {
  const { calls, fetch } = deferredFetch();
  const loader = createPublicLoader({ fetch, ...clock() });
  assert.deepEqual(Object.keys(loader).sort(), ['load', 'runner'], 'no fresh/size: there is no answer store');
  for (const kind of PUBLIC_KINDS) {
    const result = loader.load(PATHS[kind], asIs, new AbortController().signal);
    await tick();
    const call = calls.at(-1);
    assert.equal(call?.path, PATHS[kind], kind);
    assert.equal(call?.init.cache, 'no-store', kind);
    assert.equal(call?.init.credentials, 'omit', kind);
    call?.answer(json(200, EMPTY[kind]));
    assert.deepEqual(await result, { status: 'ready', data: EMPTY[kind] }, kind);
  }
});

test('loader: showing a query again asks the gateway again, so an article hidden meanwhile is gone', async () => {
  const { calls, fetch } = deferredFetch();
  const loader = createPublicLoader({ fetch, ...clock() });
  const before = { ...(EMPTY.search as object), total: 1 };
  const settled: Array<[string, PublicLoad<unknown>]> = [];
  const view = loader.runner<unknown>((path, load) => settled.push([path, load]));
  const other = '/api/search?q=b';
  for (const [path, body] of [
    [PATHS.search, before],
    [other, EMPTY.search],
    [PATHS.search, EMPTY.search],
  ] as const) {
    view.run(path, asIs);
    await tick();
    calls.at(-1)?.answer(json(200, body));
    await tick();
  }
  assert.deepEqual(
    calls.map((call) => call.path),
    [PATHS.search, other, PATHS.search],
    'back to an earlier query is a new read, never an earlier answer',
  );
  assert.deepEqual(settled.at(-1), [PATHS.search, { status: 'ready', data: EMPTY.search }]);
  // Another view of the same query (a refresh, a second component) reads again too.
  loader.runner<unknown>(() => {}).run(PATHS.search, asIs);
  await tick();
  assert.equal(calls.length, 4);
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
});

test('loader: 404 is missing, other statuses and wrong shapes are errors', async () => {
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
  }
  // A parser that rejects the payload is an error too.
  const loader = createPublicLoader({ fetch: async () => json(200, EMPTY.topic), ...clock() });
  assert.deepEqual(await loader.load(PATHS.topic, () => null, new AbortController().signal), { status: 'error' });
});

test('loader: an aborted read settles nothing, even if its answer arrives', async () => {
  const { calls, fetch } = deferredFetch();
  const loader = createPublicLoader({ fetch, ...clock() });
  const controller = new AbortController();
  const result = loader.load(PATHS.topics, asIs, controller.signal);
  await tick();
  controller.abort();
  calls[0].answer(json(200, topics(7)));
  assert.equal(await result, null);
});

test('loader: an older query answering or parsing late never overwrites the newer one', async () => {
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
  // Back to the older query, then the newer one: both are read again, nothing settles from memory.
  view.run(older, parse);
  await tick();
  view.run(newer, parse);
  await tick();
  assert.equal(calls.length, 4);
  assert.equal(settled.length, 1);
  view.stop();
  calls[2].answer(json(200, topics(7)));
  calls[3].answer(json(200, topics(90)));
  await tick();
  assert.equal(settled.length, 1, 'a stopped view settles nothing');
});

/* Refresh signal (public-refresh.ts) ---------------------------------------- */

function fakeEnv() {
  const on = new Map<string, Set<(event: Event) => void>>();
  const target = {
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!on.has(type)) on.set(type, new Set());
      on.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      on.get(type)?.delete(listener);
    },
  };
  let at = 1_000_000;
  const document = { ...target, visibilityState: 'visible' };
  const emit = (type: string, extra: object = {}) => {
    for (const listener of [...(on.get(type) ?? [])]) listener(Object.assign(new Event(type), extra));
  };
  const listening = () => [...on.values()].reduce((sum, set) => sum + set.size, 0);
  const advance = (ms: number) => {
    at += ms;
  };
  return { env: { window: target, document, now: () => at }, document, emit, listening, advance };
}

test('refresh: a tab made visible, a bfcache restore and back/forward move the epoch; nothing polls', () => {
  const { env, document, emit, listening, advance } = fakeEnv();
  const signal = createRefreshSignal(env);
  let moves = 0;
  const unsubscribe = signal.subscribe(() => moves++);
  assert.equal(listening(), 3);
  document.visibilityState = 'hidden';
  emit('visibilitychange');
  assert.equal(moves, 0, 'hiding is not a reason to read');
  document.visibilityState = 'visible';
  emit('visibilitychange');
  assert.equal(moves, 1);
  advance(REFRESH_MERGE_MS);
  emit('pageshow', { persisted: false });
  assert.equal(moves, 1, 'a normal load already read the gateway');
  emit('pageshow', { persisted: true });
  assert.equal(moves, 2);
  // A bfcache restore fires visibilitychange too: one move.
  emit('visibilitychange');
  assert.equal(moves, 2);
  advance(REFRESH_MERGE_MS);
  emit('popstate');
  assert.equal(moves, 3);
  assert.equal(signal.epoch(), 3);
  advance(60 * 60_000);
  assert.equal(moves, 3, 'time alone never moves it');
  unsubscribe();
  assert.equal(listening(), 0);
});
