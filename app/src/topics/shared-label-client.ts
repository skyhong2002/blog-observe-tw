// Optional integration seam only. No page/worker calls, persistence or result cache.
// Caller must reuse this instance and supply its shared beforeRequest budget; cooldown is instance-local.
import { parseSharedLabelRelations, parseSharedLabelVisual, SHARED_LABEL_INPUT_BYTES } from './shared-label-contract.ts';
import { TagApiTransport, TagHttpError, TagRateLimitError, type TagTransportOptions } from './transport.ts';
export type SharedLabelLoad<T> = { status: 'ready'; data: T } | { status: 'missing' } | { status: 'unavailable' };
const validTag = (tag: unknown): tag is string =>
  typeof tag === 'string' &&
  tag.length > 0 &&
  [...tag].length <= 60 &&
  tag === tag.trim() &&
  !/[\p{Cc}\p{Cs}]/u.test(tag) &&
  !['.', '..'].includes(tag);
export class SharedLabelClient {
  private readonly transport: TagApiTransport;
  private readonly now: () => number;
  private deferredUntil = 0;
  constructor(fetcher: typeof fetch, options: TagTransportOptions = {}) {
    this.now = options.now ?? Date.now;
    this.transport = new TagApiTransport(fetcher, {
      ...options,
      beforeRequest: async () => {
        if (this.now() < this.deferredUntil) throw Error('Shared label rate deferred');
        await options.beforeRequest?.();
      },
      onRateLimit: async (retryAt) => {
        this.deferredUntil = Math.max(this.deferredUntil, retryAt.getTime());
        await options.onRateLimit?.(retryAt);
      },
    });
  }
  private async load<T>(
    tag: string,
    kind: 'relations' | 'visual',
    parse: (raw: unknown, expectedTag: string) => T,
  ): Promise<SharedLabelLoad<T>> {
    // Missing here means unsupported input, not a damaged upstream response.
    if (!validTag(tag)) return { status: 'missing' };
    if (this.now() < this.deferredUntil) return { status: 'unavailable' };
    let raw: unknown;
    try {
      raw = await this.transport.json(`/api/v1/tags/${encodeURIComponent(tag)}/${kind}`, SHARED_LABEL_INPUT_BYTES, 'Shared label');
    } catch (error) {
      if (error instanceof TagHttpError && error.status === 404) return { status: 'missing' };
      if (error instanceof TagRateLimitError) this.deferredUntil = Math.max(this.deferredUntil, error.retryAt.getTime());
      return { status: 'unavailable' };
    }
    try {
      return { status: 'ready', data: parse(raw, tag) };
    } catch {
      return { status: 'unavailable' };
    }
  }
  relations(tag: string) {
    return this.load(tag, 'relations', parseSharedLabelRelations);
  }
  visual(tag: string) {
    return this.load(tag, 'visual', parseSharedLabelVisual);
  }
}
