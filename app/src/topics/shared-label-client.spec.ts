import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SharedLabelClient } from './shared-label-client.ts';
import { LOCAL_TAG_ORIGIN, PUBLIC_TAG_ORIGIN, TagApiTransport } from './transport.ts';

const tag = '榴槤';
const packet = { tag, tagId: createHash('sha256').update(tag).digest('hex'), truncated: false, relations: [] };
function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}
describe('optional shared-label injected client (no actual HTTP)', () => {
  it('uses fixed loopback paths/no-store/no credentials, projects each kind separately', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => Response.json(String(url).endsWith('/relations') ? packet : { tag, visual: null }));
    const token = vi.fn(async () => 'MOCK_ONLY_TOKEN');
    const client = new SharedLabelClient(fetcher, { origin: LOCAL_TAG_ORIGIN, readServiceToken: token, ...clock() });
    expect((await client.relations(tag)).status).toBe('ready');
    expect(await client.visual(tag)).toEqual({ status: 'ready', data: { tag, visual: null } });
    expect(token).not.toHaveBeenCalled();
    for (const [url, init] of fetcher.mock.calls) {
      expect(new URL(String(url)).origin).toBe(LOCAL_TAG_ORIGIN);
      expect(init?.cache).toBe('no-store');
      expect(init?.redirect).toBe('error');
      const h = new Headers(init?.headers);
      expect(h.has('x-service-token')).toBe(false);
      expect(h.has('cookie')).toBe(false);
      expect(h.has('authorization')).toBe(false);
    }
  });
  it('keeps 404/unsupported missing, 5xx unavailable, and does not poison another kind', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(Response.json({ tag, visual: null }))
      .mockResolvedValueOnce(new Response('', { status: 404 }));
    const client = new SharedLabelClient(fetcher, { origin: LOCAL_TAG_ORIGIN, readServiceToken: async () => null, ...clock() });
    expect(await client.relations(tag)).toEqual({ status: 'unavailable' });
    expect((await client.visual(tag)).status).toBe('ready');
    expect(await client.relations(tag)).toEqual({ status: 'missing' });
  });
  it('rejects schema mismatch, oversized responses and unsupported tags without inventing values', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ ...packet, tag: '芒果' }))
      .mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    const client = new SharedLabelClient(fetcher, { origin: LOCAL_TAG_ORIGIN, readServiceToken: async () => null, ...clock() });
    expect(await client.relations(tag)).toEqual({ status: 'unavailable' });
    expect(await client.visual(tag)).toEqual({ status: 'unavailable' });
    for (const t of ['.', '..', 'x\ud800', ' x', 'x\u0085']) expect(await client.relations(t)).toEqual({ status: 'missing' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('retains bounded 429 retries and prevents queued other-kind wire until Retry-After', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } }));
    const budget = vi.fn(async () => {});
    const client = new SharedLabelClient(fetcher, {
      origin: LOCAL_TAG_ORIGIN,
      readServiceToken: async () => null,
      beforeRequest: budget,
      ...clock(),
    });
    const [a, b] = await Promise.all([client.relations(tag), client.visual(tag)]);
    expect(a.status).toBe('unavailable');
    expect(b.status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledOnce();
    expect(budget).toHaveBeenCalledOnce();
  });
  it('uses existing two-retry bound, charging every mock attempt', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'Retry-After': '1' } }));
    const budget = vi.fn(async () => {});
    const client = new SharedLabelClient(fetcher, {
      origin: LOCAL_TAG_ORIGIN,
      readServiceToken: async () => null,
      beforeRequest: budget,
      ...clock(),
    });
    expect(await client.relations(tag)).toEqual({ status: 'unavailable' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(budget).toHaveBeenCalledTimes(3);
  });
  it('falls back only on existing connection error; token public-only and never enters result/error', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(Object.assign(Error('private failure'), { code: 'ECONNREFUSED' }))
      .mockResolvedValueOnce(Response.json(packet));
    const token = vi.fn(async () => 'MOCK_ONLY_TOKEN');
    const client = new SharedLabelClient(fetcher, { origin: LOCAL_TAG_ORIGIN, readServiceToken: token, ...clock() });
    const result = await client.relations(tag);
    expect(result.status).toBe('ready');
    expect(JSON.stringify(result)).not.toContain('MOCK_ONLY_TOKEN');
    expect(new URL(String(fetcher.mock.calls[1][0])).origin).toBe(PUBLIC_TAG_ORIGIN);
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('x-service-token')).toBe('MOCK_ONLY_TOKEN');
  });
  it('precision allowlist rejects origins, private/image routes, queries, path traversal and overlong tags', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({}));
    const transport = new TagApiTransport(fetcher, { origin: LOCAL_TAG_ORIGIN, readServiceToken: async () => null });
    for (const p of [
      '//evil.example/api/v1/tags/x/relations',
      '/api/v1/tags/x/avatar',
      '/api/v1/tags/x/visual-image',
      '/api/v1/tags/x/relations?token=secret',
      '/api/v1/tags/../relations',
      '/api/v1/tags/%2e/visual',
      '/api/v1/tags/%0085/relations',
      `/api/v1/tags/${'x'.repeat(61)}/relations`,
    ])
      await expect(transport.json(p, 100, 'Shared label')).rejects.toThrow('Invalid tag API request');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('B3 independent-review regressions (all injected mock fetch)', () => {
  it.each([false, true])('direct public token lookup: reader rejects=%s', async (rejects) => {
    const token = vi.fn(async () => {
      if (rejects) throw Error('MOCK_PRIVATE_TOKEN_ERROR');
      return 'MOCK_ONLY_TOKEN';
    });
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(packet));
    const client = new SharedLabelClient(fetcher, { origin: PUBLIC_TAG_ORIGIN, readServiceToken: token, ...clock() });
    const result = await client.relations(tag);
    expect(result.status).toBe('ready');
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get('x-service-token')).toBe(rejects ? null : 'MOCK_ONLY_TOKEN');
    expect(JSON.stringify(result)).not.toMatch(/MOCK_ONLY_TOKEN|MOCK_PRIVATE_TOKEN_ERROR/);
  });
  it('after connection fallback subsequent requests remain public and never return token to loopback', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(Object.assign(Error('connection'), { code: 'ECONNREFUSED' }))
      .mockResolvedValueOnce(Response.json(packet))
      .mockResolvedValueOnce(Response.json({ tag, visual: null }));
    const client = new SharedLabelClient(fetcher, {
      origin: LOCAL_TAG_ORIGIN,
      readServiceToken: async () => 'MOCK_ONLY_TOKEN',
      ...clock(),
    });
    expect((await client.relations(tag)).status).toBe('ready');
    expect((await client.visual(tag)).status).toBe('ready');
    expect(fetcher.mock.calls.map(([url]) => new URL(String(url)).origin)).toEqual([
      LOCAL_TAG_ORIGIN,
      PUBLIC_TAG_ORIGIN,
      PUBLIC_TAG_ORIGIN,
    ]);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).has('x-service-token')).toBe(false);
    for (const [, init] of fetcher.mock.calls.slice(1)) expect(new Headers(init?.headers).get('x-service-token')).toBe('MOCK_ONLY_TOKEN');
  });
  it('HTTP-date and >7day cooldown remain intact until actual expiry; extreme values stay safely deferred', async () => {
    for (const retryAfter of [new Date(10 * 86400_000).toUTCString(), String(10 * 86400)]) {
      let time = 0;
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': retryAfter } }))
        .mockResolvedValueOnce(Response.json({ tag, visual: null }));
      const client = new SharedLabelClient(fetcher, {
        origin: LOCAL_TAG_ORIGIN,
        readServiceToken: async () => null,
        now: () => time,
        sleep: async (ms) => {
          time += ms;
        },
      });
      expect((await client.relations(tag)).status).toBe('unavailable');
      time = 7 * 86400_000;
      expect((await client.visual(tag)).status).toBe('unavailable');
      expect(fetcher).toHaveBeenCalledOnce();
      time = 10 * 86400_000;
      expect((await client.visual(tag)).status).toBe('ready');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
    const fetcher = vi.fn<typeof fetch>(async () => new Response('', { status: 429, headers: { 'Retry-After': '9'.repeat(500) } }));
    let time = 0;
    const client = new SharedLabelClient(fetcher, { origin: LOCAL_TAG_ORIGIN, readServiceToken: async () => null, now: () => time });
    expect((await client.relations(tag)).status).toBe('unavailable');
    time = 30 * 86400_000;
    expect((await client.visual(tag)).status).toBe('unavailable');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('during short Retry-After sleep another kind is unavailable without consuming admission', async () => {
    let time = 0;
    const sleeping = Promise.withResolvers<void>(),
      resume = Promise.withResolvers<void>();
    const budget = vi.fn(async () => {});
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(Response.json(packet));
    const client = new SharedLabelClient(fetcher, {
      origin: LOCAL_TAG_ORIGIN,
      readServiceToken: async () => null,
      now: () => time,
      beforeRequest: budget,
      sleep: async (ms) => {
        sleeping.resolve();
        await resume.promise;
        time += ms;
      },
    });
    const reading = client.relations(tag);
    await sleeping.promise;
    expect((await client.visual(tag)).status).toBe('unavailable');
    expect(budget).toHaveBeenCalledOnce();
    resume.resolve();
    expect((await reading).status).toBe('ready');
    expect(budget).toHaveBeenCalledTimes(2);
  });
  it.each([
    () => new Response(null, { status: 200 }),
    () => new Response(null, { status: 204 }),
    () => Response.json(null),
    () => Response.json([]),
  ])('empty or non-record JSON is unavailable, not missing or ready', async (response) => {
    const client = new SharedLabelClient(
      vi.fn<typeof fetch>(async () => response()),
      { origin: LOCAL_TAG_ORIGIN, readServiceToken: async () => null },
    );
    expect(await client.relations(tag)).toEqual({ status: 'unavailable' });
  });
  it('invalid UTF8 rejects without silently substituting a valid-looking label', async () => {
    const bytes = Buffer.concat([Buffer.from('{"tag":"榴槤","visual":null,"extra":"'), Buffer.from([0xff]), Buffer.from('"}')]);
    const client = new SharedLabelClient(
      vi.fn<typeof fetch>(async () => new Response(bytes)),
      { origin: LOCAL_TAG_ORIGIN, readServiceToken: async () => null },
    );
    expect(await client.visual(tag)).toEqual({ status: 'unavailable' });
  });
});
