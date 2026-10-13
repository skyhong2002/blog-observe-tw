import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type FeedFetcher, MAX_OBSERVER_HTML_BYTES, type PassiveFetchObservation, politeFetch } from '../crawl/feed.ts';
import type { RecordTechObservationInput, RecordTechObservationResult } from './contracts.ts';
import { createTechObserver, TechObservationQueue } from './observer.ts';

const pool = {} as Pool;
const success: RecordTechObservationResult = { written: true, reason: 'stored' };
const resolver = async () => ['93.184.216.34'];
const event = (url = 'https://tech-observer.test/', extra = {}): PassiveFetchObservation => ({
  requestedUrl: url,
  url,
  headers: { 'content-type': 'text/html' },
  status: 200,
  html: '<meta name="generator" content="WordPress 7.1.3"><script>const secret = "DO-NOT-RETAIN";</script>',
  htmlTruncated: false,
  observedAt: new Date(),
  ...extra,
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('existing fetch passive observation', () => {
  it.each(['sync', 'async', 'pending'])(
    'observer %s failure cannot fail or delay crawling, with zero additional requests',
    async (mode) => {
      const calls: string[] = [];
      const fetcher: FeedFetcher = async (url) => {
        calls.push(String(url));
        return String(url).endsWith('/robots.txt')
          ? new Response('')
          : new Response('<h1>unchanged</h1>', { headers: { 'content-type': 'text/html' } });
      };
      const observer = vi.fn(() => {
        if (mode === 'sync') throw Error('observer-fault');
        if (mode === 'async') return Promise.reject(Error('observer-fault'));
        return new Promise<void>(() => {});
      });
      const response = await politeFetch(`https://observer-${mode}.test/`, {}, { fetcher, resolveHost: resolver, observer });
      expect(await response.text()).toBe('<h1>unchanged</h1>');
      expect(observer).toHaveBeenCalledOnce();
      expect(calls).toEqual([`https://observer-${mode}.test/robots.txt`, `https://observer-${mode}.test/`]);
    },
  );
  it('captures only a 512KiB HTML prefix from the existing buffer while leaving full response readable', async () => {
    const html = '<meta name="generator" content="WordPress">' + 'x'.repeat(MAX_OBSERVER_HTML_BYTES + 100);
    const observer = vi.fn();
    const fetcher: FeedFetcher = async (url) =>
      String(url).endsWith('/robots.txt')
        ? new Response('')
        : new Response(html, {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'set-cookie': 'privatecookie',
              authorization: 'privateauthorization',
              'cf-ray': 'private-request-id',
              'x-vercel-id': 'private-vercel-id',
            },
          });
    const response = await politeFetch('https://observer-cap.test/', {}, { fetcher, resolveHost: resolver, observer });
    expect(await response.text()).toBe(html);
    const captured = observer.mock.calls[0][0] as PassiveFetchObservation;
    expect(Buffer.byteLength(captured.html!)).toBeLessThanOrEqual(MAX_OBSERVER_HTML_BYTES);
    expect(captured.htmlTruncated).toBe(true);
    expect(captured.headers).toEqual({ 'content-type': 'text/html; charset=utf-8', 'cf-ray': 'present', 'x-vercel-id': 'present' });
    expect(JSON.stringify(captured)).not.toMatch(/privatecookie|privateauthorization|private-request|private-vercel/);
  });
  it('keeps the byte cap even when decoding invalid UTF-8 expands replacement characters', async () => {
    const observer = vi.fn();
    const body = Buffer.alloc(MAX_OBSERVER_HTML_BYTES, 0xff);
    const fetcher: FeedFetcher = async (url) =>
      String(url).endsWith('/robots.txt') ? new Response('') : new Response(body, { headers: { 'content-type': 'text/html' } });
    const response = await politeFetch('https://observer-invalid-utf8.test/', {}, { fetcher, resolveHost: resolver, observer });
    expect((await response.arrayBuffer()).byteLength).toBe(body.length);
    const captured = observer.mock.calls[0][0] as PassiveFetchObservation;
    expect(Buffer.byteLength(captured.html!)).toBeLessThanOrEqual(MAX_OBSERVER_HTML_BYTES);
    expect(captured.htmlTruncated).toBe(true);
  });
  it('uses only the final redirect event and ignores foreign robots errors instead of attributing them to the initial blog', async () => {
    const calls: string[] = [];
    const writer = vi.fn(async (_pool: Pool, _input: RecordTechObservationInput) => success),
      queue = new TechObservationQueue(writer);
    const observer = createTechObserver(pool, { blogId: 1, blogUrl: 'https://observer-original.test/' }, { enabled: true, queue });
    const fetcher: FeedFetcher = async (url) => {
      calls.push(String(url));
      if (String(url) === 'https://observer-original.test/robots.txt') return new Response('');
      if (String(url) === 'https://observer-original.test/')
        return new Response(null, { status: 302, headers: { location: 'https://observer-foreign.test/' } });
      if (String(url) === 'https://observer-foreign.test/robots.txt') return new Response('User-agent: *\nDisallow: /');
      throw Error('unexpected_request');
    };
    await expect(politeFetch('https://observer-original.test/', {}, { fetcher, resolveHost: resolver, observer })).rejects.toThrow(
      'robots disallow',
    );
    await queue.idle();
    expect(calls).toHaveLength(3);
    expect(writer).not.toHaveBeenCalled();
  });
  it('records own robots blocking safely but does not observe the robots document as blog HTML', async () => {
    const writer = vi.fn(async (_pool: Pool, _input: RecordTechObservationInput) => success),
      queue = new TechObservationQueue(writer);
    const url = 'https://observer-denied.test/';
    const observer = createTechObserver(pool, { blogId: 1, blogUrl: url }, { enabled: true, queue });
    const fetcher = vi.fn(async () => new Response('User-agent: *\nDisallow: /'));
    await expect(politeFetch(url, {}, { fetcher, resolveHost: resolver, observer })).rejects.toThrow('robots disallow');
    await queue.idle();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(writer.mock.calls[0]?.[1]).toMatchObject({ observation: { status: 'blocked', errorCode: 'robots', detections: [] } });
  });
});

describe('technology background admission', () => {
  it('defaults off without parser/writer work and only opts in for the exact true flag', () => {
    const writer = vi.fn(async (_pool: Pool, _input: RecordTechObservationInput) => success),
      queue = new TechObservationQueue(writer);
    for (const value of ['', 'false', '1']) {
      vi.stubEnv('BLOG_TECH_ENABLED', value);
      expect(createTechObserver(pool, { blogId: 1, blogUrl: 'https://tech-observer.test/' }, { queue })).toBeUndefined();
    }
    expect(queue.stats().accepted).toBe(0);
    expect(writer).not.toHaveBeenCalled();
    vi.stubEnv('BLOG_TECH_ENABLED', 'true');
    expect(createTechObserver(pool, { blogId: 1, blogUrl: 'https://tech-observer.test/' }, { queue })).toBeTypeOf('function');
  });
  it('limits queued and running work to 32, one writer, and retains only small safe DTOs', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0,
      maximum = 0;
    const stored: RecordTechObservationInput[] = [];
    const queue = new TechObservationQueue(async (_pool, input) => {
      active++;
      maximum = Math.max(active, maximum);
      stored.push(input);
      await gate;
      active--;
      return success;
    });
    const observer = createTechObserver(pool, { blogId: 1, blogUrl: 'https://tech-observer.test/' }, { enabled: true, queue })!;
    for (let i = 0; i < 100; i++) observer(event());
    expect(queue.stats()).toMatchObject({ active: 1, pending: 31, accepted: 32, dropped: 68 });
    observer(event(undefined, { status: 304 }));
    expect(queue.stats().dropped).toBe(68);
    release();
    await queue.idle();
    expect(maximum).toBe(1);
    expect(stored).toHaveLength(32);
    expect(JSON.stringify(stored)).not.toContain('DO-NOT-RETAIN');
    expect(stored.every((s) => !Object.hasOwn(s, 'html') && Buffer.byteLength(JSON.stringify(s)) < 24 * 1024)).toBe(true);
    observer(event());
    await queue.idle();
    expect(queue.stats()).toMatchObject({ active: 0, pending: 0, accepted: 33, dropped: 68 });
    expect(stored).toHaveLength(33);
  });
  it('writer exceptions do not escape callbacks or strand the rest of the queue', async () => {
    let count = 0;
    const queue = new TechObservationQueue(async () => {
      if (++count === 1) throw Error('DB-password-secret');
      return success;
    });
    const observer = createTechObserver(pool, { blogId: 1, blogUrl: 'https://tech-observer.test/' }, { enabled: true, queue })!;
    expect(() => observer(event())).not.toThrow();
    observer(event());
    await queue.idle();
    expect(queue.stats()).toMatchObject({ active: 0, pending: 0, accepted: 2, failures: 1 });
  });
  it('requires matching publication and post provenance, skips 304, and preserves prefix coverage', async () => {
    const writer = vi.fn(async (_pool: Pool, _input: RecordTechObservationInput) => success),
      queue = new TechObservationQueue(writer);
    const home = createTechObserver(pool, { blogId: 1, blogUrl: 'https://tech-observer.test/' }, { enabled: true, queue })!;
    home(event('https://tech-observer.test/post'));
    home(event('https://foreign.test/'));
    home(event(undefined, { status: 304 }));
    const profile = createTechObserver(
      pool,
      { blogId: 2, blogUrl: 'https://medium.com/@alice', sourcePostId: 99 },
      { enabled: true, queue },
    )!;
    profile(event('https://medium.com/@bob/post'));
    expect(writer).not.toHaveBeenCalled();
    profile(event('https://medium.com/@alice/post', { htmlTruncated: true }));
    await queue.idle();
    expect(writer.mock.calls[0][1]).toMatchObject({
      blogId: 2,
      sourcePostId: 99,
      observation: { coverage: { partial: true, htmlTruncated: true } },
    });
  });
});
