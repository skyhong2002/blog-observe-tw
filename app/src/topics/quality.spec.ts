import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TopicResponseCache } from './cache.ts';
import { readTagServiceToken } from './service-token.ts';
import { normalizeSourceTags, TAG_NORMALIZATION } from './tag-normalization.ts';
import { TagArticleSource, TagSourceSchemaError } from './tag-source.ts';
import { LOCAL_TAG_ORIGIN, PUBLIC_TAG_ORIGIN, TagApiTransport } from './transport.ts';

const fakeToken = 'fixture-only-never-a-live-credential-0123456789';
describe('isolated malformed labels', () => {
  it('classifies corrupt stored window/cursor as terminal schema failures without HTTP', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({}));
    const source = new TagArticleSource(request);
    const window = { since: '2026-10-11T00:00:00.000Z', until: '2026-10-12T00:00:00.000Z' };
    await expect(source.page(window, 'broken')).rejects.toBeInstanceOf(TagSourceSchemaError);
    await expect(source.page({ ...window, since: 'invalid' }, null)).rejects.toBeInstanceOf(TagSourceSchemaError);
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps valid labels and records bounded bad-tag evidence without rejecting article', () => {
    const result = normalizeSourceTags(['旅行', '\u2060AI\u2060', 'bad\u0000label', null, '字'.repeat(241), '  ', '生\u2060活']);
    expect(result.tags).toEqual(['旅行', 'AI']);
    expect(result.invalidTagCount).toBe(5);
    expect(result.normalizedTagCount).toBe(1);
    expect(result.rawTags).toEqual(['旅行', '\u2060AI\u2060']);
    expect(result.tagNormalization).toBe(TAG_NORMALIZATION);
    expect(result.invalidTagSamples.every((e) => (e.preview?.length ?? 0) <= 80)).toBe(true);
  });
  it('caps inspected labels and diagnostic samples; malformed-only articles remain valid empty evidence', () => {
    const result = normalizeSourceTags(Array.from({ length: 600 }, () => 42));
    expect(result.tags).toEqual([]);
    expect(result.invalidTagCount).toBe(600);
    expect(result.invalidTagSamples).toHaveLength(8);
    expect(normalizeSourceTags(['🍵', '\uD800']).tags).toEqual(['🍵']);
  });
});
describe('bounded API singleflight cache', () => {
  it('coalesces simultaneous loads and expires after configured bounded TTL', async () => {
    let now = 0;
    const cache = new TopicResponseCache(1, 3, () => now);
    const load = vi.fn(async () => ({ n: 1 }));
    const results = await Promise.all(Array.from({ length: 15 }, () => cache.get('same', load)));
    expect(load).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual({ n: 1 });
    now = 59999;
    await cache.get('same', load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 60001;
    await cache.get('same', load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('bounds cached keys and does not cache failed SQL', async () => {
    const cache = new TopicResponseCache(120000, 2);
    const load = vi.fn(async () => 1);
    for (const key of ['a', 'b', 'c', 'a']) await cache.get(key, load);
    expect(load).toHaveBeenCalledTimes(4);
    const failure = vi.fn(async () => {
      throw Error('query failure');
    });
    await expect(cache.get('broken', failure)).rejects.toThrow();
    await expect(cache.get('broken', failure)).rejects.toThrow();
    expect(failure).toHaveBeenCalledTimes(2);
  });
  it('bounds different in-flight keys and invalidation clears stored responses', async () => {
    const cache = new TopicResponseCache(120000, 1);
    let release!: (v: number) => void;
    const first = cache.get(
      'a',
      () =>
        new Promise<number>((r) => {
          release = r;
        }),
    );
    await Promise.resolve();
    await expect(cache.get('b', async () => 2)).rejects.toMatchObject({ statusCode: 503 });
    release(1);
    await first;
    cache.clear();
    expect(await cache.get('a', async () => 3)).toBe(3);
  });
});
describe('public fallback service token', () => {
  it('reads only owner-only regular mode600 files and returns no path or secret errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'blog-topic-token-'));
    const file = join(dir, 'token');
    try {
      await writeFile(file, fakeToken + '\n', { mode: 0o600 });
      expect(await readTagServiceToken(file)).toBe(fakeToken);
      await chmod(file, 0o644);
      expect(await readTagServiceToken(file)).toBeNull();
      await chmod(file, 0o600);
      const link = join(dir, 'link');
      await symlink(file, link);
      expect(await readTagServiceToken(link)).toBeNull();
      expect(await readTagServiceToken(dir)).toBeNull();
      expect(await readTagServiceToken(join(dir, 'missing'))).toBeNull();
      await writeFile(file, 'x'.repeat(4097));
      expect(await readTagServiceToken(file)).toBeNull();
      await writeFile(file, 'a'.repeat(35) + '\n' + 'b'.repeat(35));
      expect(await readTagServiceToken(file)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('sends token only to fixed public origin after loopback connection failure, never on redirect', async () => {
    let now = 0;
    const token = vi.fn(async () => fakeToken);
    let attempt = 0;
    const request = vi.fn<typeof fetch>(async () => {
      if (!attempt++) throw Object.assign(Error('refused'), { code: 'ECONNREFUSED' });
      return Response.json({ ok: true });
    });
    const transport = new TagApiTransport(request, {
      origin: LOCAL_TAG_ORIGIN,
      readServiceToken: token,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await transport.json('/api/v1/articles?limit=200', 100, 'tag');
    expect(token).toHaveBeenCalledTimes(1);
    expect(new Headers(request.mock.calls[0][1]?.headers).has('x-service-token')).toBe(false);
    expect(new URL(String(request.mock.calls[1][0])).origin).toBe(PUBLIC_TAG_ORIGIN);
    expect(new Headers(request.mock.calls[1][1]?.headers).get('x-service-token')).toBe(fakeToken);
    expect(request.mock.calls[1][1]?.redirect).toBe('error');
    expect(JSON.stringify(transport.diagnostics)).not.toContain(fakeToken);
  });
  it('allows anonymous public fallback when key unavailable and sanitizes downstream exceptions', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({}));
    await new TagApiTransport(request, { origin: PUBLIC_TAG_ORIGIN, readServiceToken: async () => null }).json(
      '/api/v1/articles?limit=200',
      100,
      'tag',
    );
    expect(new Headers(request.mock.calls[0][1]?.headers).has('x-service-token')).toBe(false);
    const transport = new TagApiTransport(
      async () => {
        throw Error(fakeToken);
      },
      { origin: PUBLIC_TAG_ORIGIN, readServiceToken: async () => fakeToken },
    );
    await expect(transport.json('/api/v1/articles?limit=200', 100, 'tag')).rejects.toThrow('Tag request failed');
  });
});
