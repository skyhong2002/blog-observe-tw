import { createHash } from 'node:crypto';
import {
  type ExportManifest,
  type ExportPage,
  type ExportTerm,
  MAX_SNAPSHOT_MANIFEST_BYTES,
  MAX_SNAPSHOT_PAGE_BYTES,
  type SnapshotSource,
  validateCompactPage,
  validateManifest,
  validatePage,
} from './snapshot-client.ts';
import { TagApiTransport, type TagTransportOptions } from './transport.ts';
export const LARGE_SNAPSHOT_CONTRACT = 'tag-a89908a-large5000-compact-v1' as const;
export type LargeSnapshotOptions = TagTransportOptions & { enabled?: boolean; largeContract?: typeof LARGE_SNAPSHOT_CONTRACT };
const hash = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(value) + '\n')
    .digest('hex');
const invalid = (): never => {
  throw Error('Invalid upstream vocabulary large page');
};
function largeCatalog(manifest: ExportManifest): string[] {
  const raw = manifest as unknown as { largePages?: unknown };
  if (
    !Array.isArray(raw.largePages) ||
    raw.largePages.length !== Math.ceil(manifest.total / 5000) ||
    raw.largePages.some((value) => typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
  )
    return invalid();
  return raw.largePages;
}
/** Explicit SOURCE adapter only: does not schedule, import, change quotas or publish a pool.
 * Retains one validated large group, never ten fallback small-page payloads.
 */
export class LargeSnapshotSource implements SnapshotSource {
  private readonly transport: TagApiTransport;
  private readonly enabled: boolean;
  private busy = false;
  private pinnedJSON: string | undefined;
  private pinned: ExportManifest | undefined;
  private cached: { index: number; entries: ExportTerm[] } | undefined;
  private readonly fallbackGroups = new Set<number>();
  private readonly fallbackWireReservations = new Map<number, number>();
  private fallbackWireGroup: number | undefined;
  readonly diagnostics = { largeRequests: 0, fallbackGroups: 0, smallRequests: 0, cachedGroups: 0, cachedSmallPages: 0 };
  constructor(request: typeof fetch = fetch, options: LargeSnapshotOptions = {}) {
    if (options.largeContract !== undefined && options.largeContract !== LARGE_SNAPSHOT_CONTRACT)
      throw Error('Invalid vocabulary large contract');
    if (options.enabled === true && options.largeContract !== LARGE_SNAPSHOT_CONTRACT) throw Error('Invalid vocabulary large contract');
    this.enabled = options.enabled === true;
    this.transport = new TagApiTransport(request, {
      ...options,
      beforeRequest: async () => {
        if (this.fallbackWireGroup !== undefined) {
          const group = this.fallbackWireGroup,
            count = this.fallbackWireReservations.get(group) ?? 0;
          if (count >= 10) throw Error('topic_upstream_budget');
          // Conservative reservations include retries/fallback; external persistent daily budget remains required.
          this.fallbackWireReservations.set(group, count + 1);
        }
        await options.beforeRequest?.();
      },
    });
  }
  get transportDiagnostics() {
    return this.transport.diagnostics;
  }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (!this.enabled) throw Error('Vocabulary large source disabled');
    if (this.busy) throw Error('Vocabulary large source busy');
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }
  private pin(manifest: ExportManifest) {
    validateManifest(manifest);
    largeCatalog(manifest);
    const text = JSON.stringify(manifest);
    if (Buffer.byteLength(text) > MAX_SNAPSHOT_MANIFEST_BYTES) return invalid();
    if (this.pinnedJSON !== undefined && this.pinnedJSON !== text) throw Error('Vocabulary snapshot changed while paging');
    this.pinnedJSON = text;
    this.pinned ??= JSON.parse(text) as ExportManifest;
    return this.pinned;
  }
  async current() {
    return this.exclusive(async () => {
      const raw = await this.transport.json('/api/v1/vocabulary/snapshots/current', MAX_SNAPSHOT_MANIFEST_BYTES, 'Vocabulary export');
      this.pin(validateManifest(raw));
      return JSON.parse(this.pinnedJSON!) as ExportManifest;
    });
  }
  private output(index: number, entries: ExportTerm[]) {
    const manifest = JSON.parse(this.pinnedJSON!) as ExportManifest;
    return validatePage(
      {
        snapshot: manifest,
        entries,
        cursor: String(index),
        nextCursor: index + 1 < manifest.pages.length ? String(index + 1) : null,
        sha256: manifest.pages[index],
      },
      manifest,
      index,
    );
  }
  async page(manifest: ExportManifest, index: number): Promise<ExportPage> {
    return this.exclusive(async () => {
      if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.pages.length) return invalid();
      const pinned = this.pin(manifest),
        group = Math.floor(index / 10);
      if (this.cached?.index !== group) {
        this.cached = undefined;
        this.diagnostics.cachedGroups = 0;
      }
      if (this.fallbackGroups.has(group)) return this.small(pinned, index, group);
      if (!this.cached) {
        this.diagnostics.largeRequests++;
        let raw: unknown;
        try {
          raw = await this.transport.json(
            `/api/v1/vocabulary/snapshots/${pinned.id}?cursor=${group}&compact=1&limit=5000`,
            MAX_SNAPSHOT_PAGE_BYTES,
            'Vocabulary export',
          );
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'Vocabulary export exceeds byte cap') throw error;
          this.fallbackGroups.add(group);
          this.diagnostics.fallbackGroups = this.fallbackGroups.size;
          return this.small(pinned, index, group);
        }
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
        const response = raw as {
          snapshot?: unknown;
          entries?: unknown;
          limit?: unknown;
          cursor?: unknown;
          nextCursor?: unknown;
          sha256?: unknown;
        };
        if (!response.snapshot || typeof response.snapshot !== 'object' || Array.isArray(response.snapshot)) return invalid();
        const identity = response.snapshot as Record<string, unknown>,
          keys = ['id', 'generatedAt', 'total', 'pageSize', 'sha256'] as const;
        if (Object.keys(identity).length !== keys.length || keys.some((key) => identity[key] !== pinned[key]))
          throw Error('Vocabulary snapshot changed while paging');
        const catalog = largeCatalog(pinned);
        if (
          response.limit !== 5000 ||
          response.cursor !== String(group) ||
          response.nextCursor !== (group + 1 < catalog.length ? String(group + 1) : null) ||
          !Array.isArray(response.entries) ||
          response.entries.length !== Math.min(5000, pinned.total - group * 5000) ||
          response.sha256 !== catalog[group] ||
          hash(response.entries) !== catalog[group]
        )
          return invalid();
        const entries = response.entries as ExportTerm[];
        // Validate every original 500-row checksum before retaining even one group.
        for (let offset = 0; offset < entries.length; offset += 500)
          this.output(group * 10 + offset / 500, entries.slice(offset, offset + 500));
        this.cached = { index: group, entries };
        this.diagnostics.cachedGroups = 1;
      }
      return this.output(index, this.cached.entries.slice((index % 10) * 500, ((index % 10) + 1) * 500));
    });
  }
  private async small(manifest: ExportManifest, index: number, group: number) {
    this.diagnostics.smallRequests++;
    this.fallbackWireGroup = group;
    try {
      const raw = await this.transport.json(
        `/api/v1/vocabulary/snapshots/${manifest.id}?cursor=${index}&compact=1`,
        MAX_SNAPSHOT_PAGE_BYTES,
        'Vocabulary export',
      );
      const page = validateCompactPage(raw, manifest, index);
      // Return a detached pinned identity. No small page is kept by this adapter.
      return this.output(index, page.entries);
    } finally {
      this.fallbackWireGroup = undefined;
    }
  }
}
