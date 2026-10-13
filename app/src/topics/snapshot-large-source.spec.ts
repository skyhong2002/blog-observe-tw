import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { type ExportManifest, type ExportTerm, MAX_SNAPSHOT_PAGE_BYTES, SOURCE } from './snapshot-client.ts';
import { LARGE_SNAPSHOT_CONTRACT, LargeSnapshotSource } from './snapshot-large-source.ts';
import { TagApiTransport } from './transport.ts';

const hash = (x: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(x) + '\n')
    .digest('hex');
function fixture(total = 5001) {
  const terms = Array.from(
    { length: total },
    (_, i) =>
      ({
        id: createHash('sha256')
          .update(`部落格${String(i).padStart(5, '0')}`)
          .digest('hex'),
        label: `部落格${String(i).padStart(5, '0')}`,
        articleCount: 3,
        recentArticleCount: 3,
        noise: false,
        noEqual: false,
        firstPublishedAt: '2026-10-12T00:00:00.000Z',
        lastPublishedAt: '2026-10-12T00:00:00.000Z',
        origin: 'article-tags-mixed',
        journalistAssigned: null,
      }) as ExportTerm,
  );
  const small = Array.from({ length: Math.ceil(total / 500) }, (_, i) => terms.slice(i * 500, (i + 1) * 500)),
    groups = Array.from({ length: Math.ceil(total / 5000) }, (_, i) => terms.slice(i * 5000, (i + 1) * 5000));
  const manifest = {
    schemaVersion: 1,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    previousId: null,
    generatedAt: '2026-10-13T00:00:00.000Z',
    source: SOURCE,
    coverage: 'all-current-indexed-article-tags',
    identity: 'sha256-exact-utf8-label',
    attribution: 'fixture',
    provenance: 'fixture',
    total,
    pageSize: 500,
    pages: small.map(hash),
    sha256: createHash('sha256')
      .update(terms.map((t) => JSON.stringify(t) + '\n').join(''))
      .digest('hex'),
    changeCount: 0,
    changePages: [],
    largePages: groups.map(hash),
    opaque: { keep: true },
  } as ExportManifest & { largePages: string[]; opaque: { keep: boolean } };
  const identity = () => ({
    id: manifest.id,
    generatedAt: manifest.generatedAt,
    total: manifest.total,
    pageSize: 500,
    sha256: manifest.sha256,
  });
  const large = (index: number) => ({
    snapshot: identity(),
    entries: groups[index],
    limit: 5000,
    cursor: String(index),
    nextCursor: index + 1 < groups.length ? String(index + 1) : null,
    sha256: manifest.largePages[index],
  });
  const page = (index: number) => ({
    snapshot: identity(),
    entries: small[index],
    cursor: String(index),
    nextCursor: index + 1 < small.length ? String(index + 1) : null,
    sha256: manifest.pages[index],
  });
  return { terms, manifest, large, page };
}
const options = {
  enabled: true,
  largeContract: LARGE_SNAPSHOT_CONTRACT,
  origin: SOURCE,
  readServiceToken: async () => null,
  sleep: async () => {},
  now: () => 0,
};
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const mockSource = (f: ReturnType<typeof fixture>, change?: (path: URL) => unknown) => {
  const request = vi.fn<typeof fetch>(async (raw) => {
    const url = new URL(String(raw));
    return response(
      change ? change(url) : url.pathname.endsWith('/current') ? f.manifest : f.large(Number(url.searchParams.get('cursor'))),
    );
  });
  return { request, source: new LargeSnapshotSource(request, options) };
};
describe('explicit bounded large-page source adapter', () => {
  it('defaults disabled with zero HTTP; named contract is mandatory when enabled', async () => {
    const request = vi.fn<typeof fetch>();
    const source = new LargeSnapshotSource(request);
    await expect(source.current()).rejects.toThrow('disabled');
    await expect(source.page(fixture(1).manifest, 0)).rejects.toThrow('disabled');
    expect(request).not.toHaveBeenCalled();
    expect(() => new LargeSnapshotSource(request, { enabled: true })).toThrow('contract');
  });
  it('maps5001terms/two groups to11 original500 pages and caches only the current group', async () => {
    const f = fixture(),
      { request, source } = mockSource(f);
    expect(await source.current()).toEqual(f.manifest);
    for (let i = 0; i < 11; i++) {
      const page = await source.page(f.manifest, i);
      expect(page.entries).toHaveLength(i === 10 ? 1 : 500);
      expect(page.snapshot).toEqual(f.manifest);
      expect(page.sha256).toBe(f.manifest.pages[i]);
      expect(page.cursor).toBe(String(i));
    }
    expect(request).toHaveBeenCalledTimes(3);
    expect(source.diagnostics.cachedGroups).toBe(1);
    expect(source.diagnostics.cachedSmallPages).toBe(0);
    expect(source.diagnostics.largeRequests).toBe(2);
  });
  it('a same-group resume can start midgroup, but changed opaque manifest is refused before wire', async () => {
    const f = fixture(),
      { request, source } = mockSource(f);
    expect((await source.page(f.manifest, 7)).entries[0]).toEqual(f.terms[3500]);
    await source.page(f.manifest, 8);
    expect(request).toHaveBeenCalledOnce();
    const changed = { ...f.manifest, opaque: { keep: false } };
    await expect(source.page(changed, 9)).rejects.toThrow('changed');
    expect(request).toHaveBeenCalledOnce();
  });
  it.each(['group-hash', 'small-hash', 'identity', 'count', 'cursor', 'limit', 'catalog'])(
    'refuses invalid%s without small-page fallback',
    async (kind) => {
      const f = fixture();
      if (kind === 'small-hash') f.manifest.pages[5] = 'b'.repeat(64);
      if (kind === 'catalog') f.manifest.largePages = [];
      const { source, request } = mockSource(f, () => {
        const value = f.large(0);
        if (kind === 'group-hash') value.sha256 = 'b'.repeat(64);
        if (kind === 'identity') value.snapshot.total++;
        if (kind === 'count') value.entries = value.entries.slice(1);
        if (kind === 'cursor') value.cursor = '1';
        if (kind === 'limit') value.limit = 500;
        return value;
      });
      await expect(source.page(f.manifest, 0)).rejects.toThrow();
      expect(request.mock.calls.every(([url]) => String(url).includes('limit=5000'))).toBe(true);
      expect(source.diagnostics.cachedGroups).toBe(0);
    },
  );
  it('only a known large byte cap selects bounded individual small pages, never retains ten pages', async () => {
    const f = fixture(),
      budget = vi.fn(async () => {});
    const request = vi.fn<typeof fetch>(async (raw) => {
      const url = new URL(String(raw));
      return url.searchParams.has('limit')
        ? new Response('x'.repeat(MAX_SNAPSHOT_PAGE_BYTES + 1))
        : response(f.page(Number(url.searchParams.get('cursor'))));
    });
    const source = new LargeSnapshotSource(request, { ...options, beforeRequest: budget });
    for (const index of [0, 1, 7, 8, 9]) {
      expect((await source.page(f.manifest, index)).entries).toHaveLength(500);
      expect(source.diagnostics.cachedGroups).toBe(0);
      expect(source.diagnostics.cachedSmallPages).toBe(0);
    }
    expect(source.diagnostics.largeRequests).toBe(1);
    expect(source.diagnostics.smallRequests).toBe(5);
    expect(request).toHaveBeenCalledTimes(6);
    expect(budget).toHaveBeenCalledTimes(6);
  });
  it('fallback wire reservations stop after ten attempts including repeated pages; no repeated large request', async () => {
    const f = fixture();
    const request = vi.fn<typeof fetch>(async (raw) => {
      const url = new URL(String(raw));
      return url.searchParams.has('limit') ? new Response('x'.repeat(MAX_SNAPSHOT_PAGE_BYTES + 1)) : response(f.page(0));
    });
    const source = new LargeSnapshotSource(request, options);
    for (let i = 0; i < 10; i++) await source.page(f.manifest, 0);
    await expect(source.page(f.manifest, 0)).rejects.toThrow('topic_upstream_budget');
    expect(request).toHaveBeenCalledTimes(11);
    expect(source.diagnostics.largeRequests).toBe(1);
  });
  it('fallback retries count against the ten-wire group ceiling and the original external budget', async () => {
    const f = fixture(),
      budget = vi.fn(async () => {});
    let small = 0;
    const request = vi.fn<typeof fetch>(async (raw) => {
      const url = new URL(String(raw));
      if (url.searchParams.has('limit')) return new Response('x'.repeat(MAX_SNAPSHOT_PAGE_BYTES + 1));
      if (small++ === 0) return new Response('', { status: 429, headers: { 'retry-after': '1' } });
      return response(f.page(0));
    });
    const source = new LargeSnapshotSource(request, { ...options, beforeRequest: budget });
    await source.page(f.manifest, 0);
    for (let i = 0; i < 8; i++) await source.page(f.manifest, 0);
    await expect(source.page(f.manifest, 0)).rejects.toThrow('topic_upstream_budget');
    expect(request).toHaveBeenCalledTimes(11);
    expect(budget).toHaveBeenCalledTimes(11);
    expect(source.transportDiagnostics.retries).toBe(1);
  });
  it('moving between groups discards the previous decoded group rather than accumulating the full pool', async () => {
    const f = fixture(),
      { source, request } = mockSource(f);
    for (const index of [0, 10, 2]) {
      await source.page(f.manifest, index);
      expect(source.diagnostics.cachedGroups).toBe(1);
    }
    expect(request).toHaveBeenCalledTimes(3);
    expect(source.diagnostics.cachedSmallPages).toBe(0);
  });
  it('badJSON/HTTP failure does not silently fetch smaller pages', async () => {
    for (const value of [new Response('bad JSON'), new Response('', { status: 503 })]) {
      const request = vi.fn<typeof fetch>(async () => value);
      const source = new LargeSnapshotSource(request, options);
      await expect(source.page(fixture().manifest, 0)).rejects.toThrow();
      expect(request).toHaveBeenCalledOnce();
    }
  });
  it('busy overlap rejects rather than queueing shared promises or duplicate requests', async () => {
    const f = fixture();
    let release!: (value: Response) => void;
    const request = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const source = new LargeSnapshotSource(request, options);
    const first = source.page(f.manifest, 0);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await expect(source.page(f.manifest, 1)).rejects.toThrow('busy');
    await expect(source.current()).rejects.toThrow('busy');
    release(response(f.large(0)));
    await first;
    expect(request).toHaveBeenCalledOnce();
  });
  it('transport permits only exact UUID/cursor/compact1/limit5000 order, never current or arbitrary limits', async () => {
    const request = vi.fn<typeof fetch>(async () => response({})),
      transport = new TagApiTransport(request, options);
    for (const path of [
      `/api/v1/vocabulary/snapshots/current?cursor=0&compact=1&limit=5000`,
      `/api/v1/vocabulary/snapshots/${fixture(1).manifest.id}?cursor=000&compact=1&limit=5000`,
      `/api/v1/vocabulary/snapshots/${fixture(1).manifest.id}?cursor=0&limit=5000`,
      `/api/v1/vocabulary/snapshots/${fixture(1).manifest.id}?cursor=0&compact=1&limit=5001`,
    ])
      await expect(transport.json(path, 2000000, 'Vocabulary export')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
