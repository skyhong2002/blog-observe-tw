import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ActiveAccumulator,
  activeManifest,
  activePage,
  normalizePreview,
  PreviewFailure,
  PreviewTransport,
  previewChanges,
} from '../../../tools/preview-vocabulary-active.ts';

const id = '12345678-1234-4234-8234-123456789abc';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const term = (label: string, articleCount = 10, extra = {}) => ({ id: hash(label), label, articleCount, ...extra });
function fixture() {
  const entries = [term('AI 模型'), term('臺灣')];
  const raw = {
    source: 'https://tag.observe.tw',
    id,
    generatedAt: '2026-10-13T00:00:00.000Z',
    total: 4_733_073,
    pageSize: 500,
    sha256: 'a'.repeat(64),
    active: {
      total: 2,
      pages: [hash(`${JSON.stringify(entries)}\n`)],
      sha256: hash(entries.map((t) => `${JSON.stringify(t)}\n`).join('')),
      days: 30,
      minRecentArticleCount: 3,
    },
  };
  const page = {
    snapshot: { id: raw.id, generatedAt: raw.generatedAt, total: raw.total, pageSize: 500, sha256: raw.sha256 },
    subset: { total: 2, sha256: raw.active.sha256 },
    entries,
    cursor: '0',
    nextCursor: null,
    sha256: raw.active.pages[0],
  };
  return { manifest: activeManifest(raw), raw, page };
}

describe('preview-only active vocabulary contract', () => {
  it('allows a multi-million full pool while limiting the retained active subset', () => {
    const { raw, manifest, page } = fixture();
    expect(manifest.total).toBe(4_733_073);
    expect(activePage(page, manifest, 0)).toHaveLength(2);
    expect(() => activeManifest({ ...raw, active: { ...raw.active, total: 100_001 } })).toThrow('preview_active_manifest_cap_or_schema');
  });
  it('rejects mutated terms, wrong subset/version, and wrong cursor', () => {
    const { manifest, page } = fixture();
    for (const bad of [
      { ...page, entries: [term('modified')] },
      { ...page, subset: { total: 2, sha256: 'b'.repeat(64) } },
      { ...page, snapshot: { ...page.snapshot, id: 'different' } },
      { ...page, nextCursor: '1' },
    ])
      expect(() => activePage(bad, manifest, 0)).toThrow('preview_page_checksum_or_contract');
  });
  it('deduplicates NFKC/case and Cf, including 200B/C/D/FEFF, preserving the strongest label count', () => {
    const accumulator = new ActiveAccumulator();
    for (const label of ['AI', 'ＡＩ', 'a\u200bi', 'A\u200cI', 'A\u200dI', '\ufeffAI']) accumulator.add(term(label));
    accumulator.add(term('ai', 25));
    expect(accumulator.terms.size).toBe(1);
    expect(accumulator.duplicates).toBe(6);
    expect(accumulator.zeroWidthChanged).toBe(4);
    expect(accumulator.terms.get('ai')?.articleCount).toBe(25);
    expect(normalizePreview('臺\u2060灣')).toBe('臺灣');
    expect(accumulator.select().selected).toEqual([{ id: hash('ai'), label: 'ai' }]);
  });
  it('keeps exclusions and refuses unbounded retained terms/memory', () => {
    const accumulator = new ActiveAccumulator();
    accumulator.add(term('AI'));
    accumulator.add(term('ai', 20, { noise: true }));
    accumulator.add(term('2026'));
    accumulator.add(term('""'));
    expect(accumulator.select().exclusions).toMatchObject({ 'upstream-noise': 1, 'pure-number': 1, 'punctuation-only': 1 });
    expect(() => new ActiveAccumulator({ terms: 1, retainedBytes: 1 }).add(term('臺灣'))).toThrow('preview_retained_memory_cap');
  });
});

describe('preview transport is serial, bounded and credential safe', () => {
  const path = '/api/v1/vocabulary/snapshots/current';
  function clock() {
    let now = 0;
    return {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
  }
  it('spaces concurrent callers by at least 500ms and never forwards a token to loopback', async () => {
    const time = clock();
    const observed: number[] = [];
    const token = vi.fn(async () => 'secret-service-token');
    const transport = new PreviewTransport({
      ...time,
      token,
      fetch: (async (_url, init) => {
        observed.push(time.now());
        expect(new Headers(init?.headers).get('x-service-token')).toBeNull();
        return Response.json({ ok: true });
      }) as typeof fetch,
    });
    await Promise.all([transport.json(path), transport.json(path), transport.json(path)]);
    expect(observed).toEqual([0, 500, 1000]);
    expect(token).not.toHaveBeenCalled();
    await expect(transport.json('/api/v1/vocabulary/snapshots/' + id)).rejects.toThrow('preview_path_forbidden');
    await expect(transport.json('/internal/secret')).rejects.toThrow('preview_path_forbidden');
  });
  it('falls back only on connection failure, sends the service token only to public, and does not expose it', async () => {
    const time = clock();
    let attempts = 0;
    const transport = new PreviewTransport({
      ...time,
      token: async () => 'secret-service-token',
      fetch: (async (url, init) => {
        attempts++;
        if (attempts === 1) throw Object.assign(Error('connection'), { code: 'ECONNREFUSED' });
        expect(String(url).startsWith('https://tag.observe.tw/')).toBe(true);
        expect(new Headers(init?.headers).get('x-service-token')).toBe('secret-service-token');
        expect(time.now()).toBeGreaterThanOrEqual(1100);
        return Response.json({ error: 'expired' }, { status: 409 });
      }) as typeof fetch,
    });
    const error = await transport.json(path).catch((e) => e);
    expect(error).toMatchObject({ status: 409 });
    expect(JSON.stringify(error)).not.toContain('secret-service-token');
    expect(JSON.stringify(transport.diagnostics)).not.toContain('secret-service-token');
  });
  it('respects Retry-After and reports long deferral without shortening it', async () => {
    const time = clock();
    let attempts = 0;
    const transport = new PreviewTransport({
      ...time,
      fetch: (async () => {
        attempts++;
        return attempts === 1 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : Response.json({ ok: true });
      }) as typeof fetch,
    });
    await transport.json(path);
    expect(time.now()).toBe(2000);
    expect(transport.diagnostics.retries).toBe(1);
    const deferred = new PreviewTransport({
      ...time,
      fetch: (async () => new Response('', { status: 429, headers: { 'retry-after': '120' } })) as typeof fetch,
    });
    await expect(deferred.json(path)).rejects.toMatchObject({ status: 429, retryAfterMs: 120_000 });
  });
  it('rejects oversized bodies before retaining an unbounded response', async () => {
    const transport = new PreviewTransport({
      ...clock(),
      fetch: (async () => new Response('x'.repeat(2 * 1024 ** 2 + 1))) as typeof fetch,
    });
    await expect(transport.json(path)).rejects.toThrow('preview_response_byte_cap');
  });
});

describe('read-only changes probes', () => {
  it('reports 409 without changing anything or fetching the full pool', async () => {
    const request = vi.fn(async () => {
      throw new PreviewFailure('preview_http_failed', 409);
    });
    const results = await previewChanges({ json: request }, id);
    expect(results[0]).toMatchObject({ status: 409, resetRequired: true, pages: 0 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('pins target and advances after only when all pages finish', async () => {
    const target = '12345678-1234-4234-8234-123456789abd';
    const paths: string[] = [];
    const entries = [{ action: 'upsert', term: term('臺灣'), active: true }];
    const transport = {
      json: async (path: string) => {
        paths.push(path);
        const cursor = path.includes('cursor=1') ? '1' : '0';
        return {
          snapshot: { id: target, kind: 'delta' },
          entries,
          cursor,
          nextCursor: paths.length === 1 ? '1' : null,
          sha256: hash(`${JSON.stringify(entries)}\n`),
        };
      },
    };
    const report = await previewChanges(transport, id, 2);
    expect(paths[1]).toContain(`after=${id}&target=${target}&cursor=1`);
    expect(paths[2]).toContain(`after=${target}`);
    expect(report[0]).toMatchObject({ pages: 2, entries: 2, complete: true });
  });
});
