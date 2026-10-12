import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { syncVocabulary } from './sync.ts';
import { LOCAL_TAG_ORIGIN, PUBLIC_TAG_ORIGIN, retryAfterMs, TagApiTransport, tagApiOrigin } from './transport.ts';

const path = '/api/v1/articles?since=2026-10-01T00%3A00%3A00Z&until=2026-10-02T00%3A00%3A00Z&limit=200';
function clock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleeps,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}
describe('tag transport isolation and wire budget', () => {
  it('accepts only exact two origins and fixed paths', async () => {
    expect(tagApiOrigin(LOCAL_TAG_ORIGIN)).toBe(LOCAL_TAG_ORIGIN);
    expect(tagApiOrigin(PUBLIC_TAG_ORIGIN)).toBe(PUBLIC_TAG_ORIGIN);
    for (const origin of [
      'http://127.0.0.1:18160',
      'https://evil.example',
      'https://tag.observe.tw/',
      'https://tag.observe.tw@evil.example',
      'http://127.0.0.1:18130/internal',
    ])
      expect(() => tagApiOrigin(origin)).toThrow();
    const request = vi.fn<typeof fetch>(async () => Response.json({}));
    const t = new TagApiTransport(request, { readServiceToken: async () => null, origin: LOCAL_TAG_ORIGIN });
    await expect(t.json('//evil.example/api/v1/articles?x', 100, 'tag')).rejects.toThrow();
    await expect(t.json('/internal/similarweb/requests', 100, 'tag')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    [LOCAL_TAG_ORIGIN, 500],
    [PUBLIC_TAG_ORIGIN, 1100],
  ])('serializes %s with minimum spacing %s and strips credentials', async (origin, minimum) => {
    const time = clock();
    const request = vi.fn<typeof fetch>(async () => Response.json({ ok: true }));
    const budget = vi.fn(async () => {});
    const t = new TagApiTransport(request, { readServiceToken: async () => null, origin, ...time, beforeRequest: budget });
    await Promise.all([t.json(path, 100, 'tag'), t.json(path, 100, 'tag'), t.json(path, 100, 'tag')]);
    expect(time.sleeps).toEqual([minimum, minimum]);
    expect(budget).toHaveBeenCalledTimes(3);
    for (const [url, init] of request.mock.calls) {
      expect(new URL(String(url)).origin).toBe(origin);
      expect(init?.redirect).toBe('error');
      const headers = new Headers(init?.headers);
      expect([...headers.keys()].sort()).toEqual(['accept', 'user-agent']);
      for (const key of ['authorization', 'cookie', 'cf-connecting-ip', 'x-forwarded-for']) expect(headers.has(key)).toBe(false);
    }
  });
  it('uses Retry-After and charges every retry while remaining on loopback', async () => {
    const time = clock();
    let attempts = 0;
    const budget = vi.fn(async () => {});
    const request = vi.fn<typeof fetch>(async () =>
      ++attempts < 3 ? new Response('', { status: 429, headers: { 'Retry-After': '2' } }) : Response.json({ ok: true }),
    );
    const t = new TagApiTransport(request, {
      readServiceToken: async () => null,
      origin: LOCAL_TAG_ORIGIN,
      ...time,
      beforeRequest: budget,
    });
    expect(await t.json(path, 100, 'tag')).toEqual({ ok: true });
    expect(time.sleeps).toEqual([2000, 2000]);
    expect(budget).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every(([url]) => new URL(String(url)).origin === LOCAL_TAG_ORIGIN)).toBe(true);
    expect(t.diagnostics.retries).toBe(2);
  });
  it('stops after two 429 retries and uses second backoff when header absent', async () => {
    const time = clock();
    const request = vi.fn<typeof fetch>(async () => new Response('', { status: 429 }));
    const budget = vi.fn(async () => {});
    const t = new TagApiTransport(request, {
      readServiceToken: async () => null,
      origin: PUBLIC_TAG_ORIGIN,
      ...time,
      beforeRequest: budget,
    });
    await expect(t.json(path, 100, 'tag')).rejects.toThrow('429');
    expect(request).toHaveBeenCalledTimes(3);
    expect(budget).toHaveBeenCalledTimes(3);
    expect(time.now()).toBeGreaterThanOrEqual(3100);
    expect(t.diagnostics.fallbacks).toBe(0);
  });
  it('persists defer date rather than retrying before Retry-After or wall deadline', async () => {
    const time = clock();
    const persisted = vi.fn(async (_date: Date) => {});
    const request = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    const t = new TagApiTransport(request, {
      readServiceToken: async () => null,
      origin: LOCAL_TAG_ORIGIN,
      ...time,
      deadline: 20000,
      onRateLimit: persisted,
    });
    await expect(t.json(path, 100, 'tag')).rejects.toMatchObject({ retryAt: new Date(120000) });
    expect(request).toHaveBeenCalledTimes(1);
    expect(persisted).toHaveBeenCalledWith(new Date(120000));
    expect(time.sleeps).toEqual([]);
    expect(retryAfterMs('Thu, 01 Jan 1970 00:00:05 GMT', 0, 1000)).toBe(4000);
    expect(retryAfterMs('999999999999999999', 0, 0)).toBe(7 * 86400_000);
  });
  it('falls back once only for connection failure and charges fallback before public wire', async () => {
    const time = clock();
    let calls = 0;
    const request = vi.fn<typeof fetch>(async () => {
      if (!calls++) throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      return Response.json({});
    });
    const budget = vi.fn(async () => {});
    const t = new TagApiTransport(request, {
      readServiceToken: async () => null,
      origin: LOCAL_TAG_ORIGIN,
      ...time,
      beforeRequest: budget,
    });
    await t.json(path, 100, 'tag');
    await t.json(path, 100, 'tag');
    expect(request.mock.calls.map(([url]) => new URL(String(url)).origin)).toEqual([
      LOCAL_TAG_ORIGIN,
      PUBLIC_TAG_ORIGIN,
      PUBLIC_TAG_ORIGIN,
    ]);
    expect(time.sleeps).toEqual([1100, 1100]);
    expect(budget).toHaveBeenCalledTimes(3);
    expect(t.diagnostics.fallbacks).toBe(1);
  });
  it('does not fallback on HTTP failure or arbitrary fetch exception', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response('', { status: 503 }));
    await expect(
      new TagApiTransport(request, { readServiceToken: async () => null, origin: LOCAL_TAG_ORIGIN }).json(path, 100, 'tag'),
    ).rejects.toThrow('503');
    expect(request).toHaveBeenCalledTimes(1);
    const failure = vi.fn<typeof fetch>(async () => {
      throw Error('bad redirect');
    });
    await expect(
      new TagApiTransport(failure, { readServiceToken: async () => null, origin: LOCAL_TAG_ORIGIN }).json(path, 100, 'tag'),
    ).rejects.toThrow('Tag request failed');
    expect(failure).toHaveBeenCalledTimes(1);
  });
  it('does not send retry when its per-wire reservation fails', async () => {
    const time = clock();
    let reservations = 0;
    const request = vi.fn<typeof fetch>(async () => new Response('', { status: 429 }));
    const t = new TagApiTransport(request, {
      readServiceToken: async () => null,
      origin: LOCAL_TAG_ORIGIN,
      ...time,
      beforeRequest: async () => {
        if (++reservations === 2) throw Error('budget');
      },
    });
    await expect(t.json(path, 100, 'tag')).rejects.toThrow('budget');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('cancels oversized streams and responds to shutdown during body read', async () => {
    const cancel = vi.fn();
    const big = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(101));
      },
      cancel,
    });
    await expect(
      new TagApiTransport(async () => new Response(big), { readServiceToken: async () => null, origin: LOCAL_TAG_ORIGIN }).json(
        path,
        100,
        'tag',
      ),
    ).rejects.toThrow('byte cap');
    expect(cancel).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    const cancelled = vi.fn();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const hanging = new ReadableStream<Uint8Array>(
      {
        pull() {
          started();
        },
        cancel: cancelled,
      },
      { highWaterMark: 0 },
    );
    const t = new TagApiTransport(async () => new Response(hanging), {
      readServiceToken: async () => null,
      origin: LOCAL_TAG_ORIGIN,
      signal: controller.signal,
    });
    const result = t.json(path, 100, 'tag');
    await ready;
    controller.abort();
    await expect(result).rejects.toThrow();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it('keeps a second request queued until the first streamed body completes', async () => {
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    let started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        streamController = c;
      },
      pull() {
        started();
      },
    });
    let count = 0;
    const time = clock();
    const request = vi.fn<typeof fetch>(async () => (++count === 1 ? new Response(stream) : Response.json({})));
    const t = new TagApiTransport(request, { readServiceToken: async () => null, origin: LOCAL_TAG_ORIGIN, ...time });
    const first = t.json(path, 100, 'tag');
    const second = t.json(path, 100, 'tag');
    await ready;
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);
    streamController.enqueue(new TextEncoder().encode('{}'));
    streamController.close();
    await Promise.all([first, second]);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('observes a persisted window cooldown before any budget or network attempt', async () => {
    const now = new Date('2026-10-12T00:00:00Z');
    const until = new Date(now.getTime() + 3600000);
    const execute = vi.fn();
    const c = {
      query: async (sql: string) => (sql.includes('RELEASE_LOCK') ? [[{ released: 1 }]] : [[{ held: 1 }]]),
      release: () => {},
      destroy: () => {},
    };
    const pool = {
      getConnection: async () => c,
      query: async (sql: string) => {
        if (sql.includes('FROM topic_snapshots')) return [sql.includes('COUNT(*)') ? [{ n: 0 }] : []];
        return [[{ id: 'cooling', next_attempt_at: until }]];
      },
      execute,
    } as unknown as Pool;
    expect(await syncVocabulary(pool, { enabled: true, now: () => now })).toEqual({
      status: 'deferred',
      version: 'cooling',
      nextAttemptAt: until,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
