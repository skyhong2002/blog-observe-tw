import { describe, expect, it, vi } from 'vitest';
import {
  COMPACT_SNAPSHOT_CONTRACT,
  type ExportManifest,
  HttpSnapshotSource,
  hash,
  MAX_SNAPSHOT_PAGE_BYTES,
  SOURCE,
  validateCompactPage,
  validatePage,
} from './snapshot-client.ts';

const term = {
  id: hash('資訊安全'),
  label: '資訊安全',
  articleCount: 3,
  firstPublishedAt: '2026-01-01T00:00:00.000Z',
  lastPublishedAt: '2026-01-01T00:00:00.000Z',
  origin: 'article-tags-mixed',
  journalistAssigned: null,
};
const entries = [term];
const manifest: ExportManifest = {
  schemaVersion: 1,
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  previousId: null,
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: SOURCE,
  attribution: '新文易數',
  coverage: 'all-current-indexed-article-tags',
  provenance: 'mixed',
  identity: 'sha256-exact-utf8-label',
  total: 1,
  pageSize: 500,
  pages: [hash(JSON.stringify(entries) + '\n')],
  sha256: hash(JSON.stringify(term) + '\n'),
  changeCount: 0,
  changePages: [],
};
const compact = () => ({
  snapshot: { id: manifest.id, generatedAt: manifest.generatedAt, total: 1, pageSize: 500, sha256: manifest.sha256 },
  entries,
  cursor: '0',
  nextCursor: null,
  sha256: manifest.pages[0],
});
describe('explicit compact page identity bound to a separately pinned complete manifest', () => {
  it('keeps full opaque metadata and reuses original term/page checksum validation', () => {
    const full = { ...manifest, statistics: { noise: 5 }, largePages: ['a'.repeat(64)] };
    const page = validateCompactPage(compact(), full, 0);
    expect(page.snapshot).toBe(full);
    expect(page.entries).toEqual(entries);
    expect(() => validatePage(compact(), full, 0)).toThrow();
  });
  it.each(['id', 'generatedAt', 'total', 'pageSize', 'sha256'])('rejects changed compact %s', (field) => {
    const raw = compact();
    (raw.snapshot as Record<string, unknown>)[field] = 'different';
    expect(() => validateCompactPage(raw, manifest, 0)).toThrow('snapshot changed');
  });
  it('rejects unversioned extensions, wrong cursor/hash/count/term and truncated full manifests', () => {
    for (const raw of [
      { ...compact(), snapshot: { ...compact().snapshot, opaque: true } },
      { ...compact(), cursor: '1' },
      { ...compact(), sha256: '0'.repeat(64) },
      { ...compact(), entries: [] },
      { ...compact(), entries: [{ ...term, articleCount: 0 }] },
    ])
      expect(() => validateCompactPage(raw, manifest, 0)).toThrow();
    expect(() => validateCompactPage(compact(), { ...manifest, pages: [] }, 0)).toThrow();
  });
  it('default HTTP mode remains full, compact only with explicit named contract', async () => {
    const request = vi.fn(async (_url: string | URL | Request) => Response.json({ ...compact(), snapshot: manifest }));
    await new HttpSnapshotSource(request).page(manifest, 0);
    expect(String(request.mock.calls[0][0])).not.toContain('compact');
    const compactRequest = vi.fn(async (_url: string | URL | Request) => Response.json(compact()));
    await new HttpSnapshotSource(compactRequest, undefined, { compactContract: COMPACT_SNAPSHOT_CONTRACT }).page(manifest, 0);
    expect(String(compactRequest.mock.calls[0][0])).toBe(
      `http://127.0.0.1:18130/api/v1/vocabulary/snapshots/${manifest.id}?cursor=0&compact=1`,
    );
    expect(() => new HttpSnapshotSource(compactRequest, undefined, { compactContract: 'unknown' as never })).toThrow();
  });
  it('does not relax the decompressed page byte cap or retry immutable byte failure', async () => {
    const request = vi.fn(async () => new Response('x'.repeat(MAX_SNAPSHOT_PAGE_BYTES + 1)));
    await expect(
      new HttpSnapshotSource(request, undefined, { compactContract: COMPACT_SNAPSHOT_CONTRACT }).page(manifest, 0),
    ).rejects.toThrow('exceeds byte cap');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
