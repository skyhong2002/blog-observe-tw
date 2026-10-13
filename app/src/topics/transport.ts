import { setTimeout as delay } from 'node:timers/promises';
import { readTagServiceToken } from './service-token.ts';

export const PUBLIC_TAG_ORIGIN = 'https://tag.observe.tw';
export const LOCAL_TAG_ORIGIN = 'http://127.0.0.1:18130';
export type TagTransportOptions = {
  origin?: string;
  readServiceToken?: () => Promise<string | null>;
  signal?: AbortSignal;
  deadline?: number;
  delayMs?: number;
  /** Called before every wire attempt, including retries and connection fallback. */
  beforeRequest?: () => Promise<void>;
  fallback?: boolean;
  onRateLimit?: (retryAt: Date) => Promise<void>;
  // Deterministic clock/wait seams; production always uses real monotonic spacing.
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};
export function tagApiOrigin(value = process.env.BLOG_TAG_API_ORIGIN ?? LOCAL_TAG_ORIGIN): string {
  if (value !== PUBLIC_TAG_ORIGIN && value !== LOCAL_TAG_ORIGIN) throw Error('Invalid BLOG_TAG_API_ORIGIN');
  return value;
}
/** Keep the full representable Retry-After; extreme numeric values defer to Date's maximum, never a shorter 7-day retry. */
export function retryAfterMs(header: string | null, attempt: number, now: number): number {
  const maximum = Math.max(0, 8_640_000_000_000_000 - now);
  const bounded = (ms: number) => Math.min(maximum, Math.max(1000, ms));
  if (header && /^\d+$/.test(header.trim())) return bounded(Number(header.trim()) * 1000);
  if (header) {
    const date = Date.parse(header);
    if (Number.isFinite(date)) return bounded(date - now);
  }
  return Math.min(maximum, 30_000, 1000 * 2 ** attempt);
}
export class TagRateLimitError extends Error {
  readonly retryAt: Date;
  constructor(label: string, retryAt: Date) {
    super(`${label} HTTP 429; retry deferred`);
    this.retryAt = retryAt;
  }
}
const connectionFailure = (error: unknown) => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(e?.cause?.code ?? e?.code ?? '');
};
export class TagHttpError extends Error {
  readonly status: number;
  constructor(status: number, label: string) {
    super(`${label} HTTP ${status}`);
    this.status = status;
  }
}
const sharedLabelPath = (path: string) => {
  const match = /^\/api\/v1\/tags\/([^/?#]+)\/(relations|visual)$/.exec(path);
  if (!match) return false;
  try {
    const tag = decodeURIComponent(match[1]);
    return (
      !!tag &&
      tag === tag.trim() &&
      [...tag].length <= 60 &&
      !/[\p{Cc}\p{Cs}]/u.test(tag) &&
      encodeURIComponent(tag) === match[1] &&
      new URL(path, PUBLIC_TAG_ORIGIN).pathname === path
    );
  } catch {
    return false;
  }
};
const allowedPath = (path: string) =>
  sharedLabelPath(path) ||
  /^\/api\/v1\/articles\?[^#]*$/.test(path) ||
  /^\/api\/v1\/vocabulary\/snapshots\/(?:current|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\?cursor=\d{1,6})?$/.test(
    path,
  );

/** Single in-flight response per client, including streamed body and backoff. Only the fixed public origin receives the dedicated read-only service token; proxy headers are never forwarded. */
export class TagApiTransport {
  private readonly request: typeof fetch;
  private readonly options: TagTransportOptions;
  private readonly clock: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly origin: string;
  private activeOrigin: string;
  private tail: Promise<unknown> = Promise.resolve();
  private serviceToken: Promise<string | null> | undefined;
  private lastRequest: number | null = null;
  readonly diagnostics = { transport: '', requests: 0, fallbacks: 0, retries: 0 };
  constructor(request: typeof fetch = fetch, options: TagTransportOptions = {}) {
    this.request = request;
    this.options = options;
    this.clock = options.now ?? Date.now;
    this.sleep =
      options.sleep ??
      (async (ms, signal) => {
        await delay(ms, undefined, { signal });
      });
    this.origin = tagApiOrigin(options.origin);
    this.activeOrigin = this.origin;
    this.diagnostics.transport = this.origin === LOCAL_TAG_ORIGIN ? 'loopback' : 'public';
  }
  private assertRunning() {
    this.options.signal?.throwIfAborted();
    if (this.clock() >= (this.options.deadline ?? Infinity)) throw Error('Tag request deadline');
  }
  private async wait(ms: number) {
    this.assertRunning();
    if (this.clock() + ms >= (this.options.deadline ?? Infinity)) throw Error('Tag retry deferred by deadline');
    if (ms > 0) await this.sleep(ms, this.options.signal);
    this.assertRunning();
  }
  async json(path: string, maxBytes: number, label: string): Promise<unknown> {
    if (!allowedPath(path) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4_000_000)
      throw Error('Invalid tag API request');
    const result = this.tail.then(() => this.perform(path, maxBytes, label));
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async perform(path: string, maxBytes: number, label: string): Promise<unknown> {
    let retries = 0;
    let fallbackUsed = this.activeOrigin !== this.origin;
    while (true) {
      this.assertRunning();
      const spacing = Math.max(this.activeOrigin === LOCAL_TAG_ORIGIN ? 500 : 1100, this.options.delayMs ?? 0);
      if (this.lastRequest !== null) await this.wait(Math.max(0, this.lastRequest + spacing - this.clock()));
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'User-Agent': 'BlogObserve/1.0 (+https://blog.observe.tw/about/; contact https://skyhong.tw/)',
      };
      if (this.activeOrigin === PUBLIC_TAG_ORIGIN) {
        this.serviceToken ??= (this.options.readServiceToken ?? readTagServiceToken)().catch(() => null);
        const token = await this.serviceToken;
        if (token) headers['x-service-token'] = token;
      }
      await this.options.beforeRequest?.();
      this.assertRunning();
      this.lastRequest = this.clock();
      this.diagnostics.requests++;
      let response: Response;
      const timeout = Math.max(1, Math.min(30_000, (this.options.deadline ?? Infinity) - this.clock()));
      const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(this.options.signal ? [this.options.signal] : [])]);
      try {
        response = await this.request(new URL(path, this.activeOrigin), {
          redirect: 'error',
          cache: 'no-store',
          signal,
          headers,
        });
      } catch (error) {
        this.assertRunning();
        if (this.activeOrigin === LOCAL_TAG_ORIGIN && !fallbackUsed && this.options.fallback !== false && connectionFailure(error)) {
          fallbackUsed = true;
          this.activeOrigin = PUBLIC_TAG_ORIGIN;
          this.diagnostics.transport = 'public-fallback';
          this.diagnostics.fallbacks++;
          continue;
        }
        throw Error('Tag request failed');
      }
      if (response.status === 429) {
        const pause = retryAfterMs(response.headers.get('retry-after'), retries, this.clock());
        await response.body?.cancel().catch(() => undefined);
        const retryAt = new Date(this.clock() + pause);
        await this.options.onRateLimit?.(retryAt);
        if (retries >= 2 || pause > 60_000 || this.clock() + pause >= (this.options.deadline ?? Infinity))
          throw new TagRateLimitError(label, retryAt);
        retries++;
        this.diagnostics.retries++;
        await this.wait(pause);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new TagHttpError(response.status, label);
      }
      if (!response.body) throw Error(`${label} empty response`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      // Abort a custom/mocked stream too; fetch streams are additionally linked to signal.
      const abort = () => {
        void reader.cancel().catch(() => undefined);
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        while (true) {
          signal.throwIfAborted();
          this.assertRunning();
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > maxBytes) throw Error(`${label} exceeds byte cap`);
          chunks.push(part.value);
        }
        signal.throwIfAborted();
        this.assertRunning();
        try {
          return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        } catch {
          throw Error(`${label} invalid JSON`);
        }
      } finally {
        signal.removeEventListener('abort', abort);
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    }
  }
}
