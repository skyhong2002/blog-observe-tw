import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { politeFetch } from '../crawl/feed.ts';
import { readLocalFavicon } from '../v1/favicon-routes.ts';
import { ImageCache } from './cache.ts';
import { encodeRaster, MAX_IMAGE_BYTES } from './encode.ts';
export const POST_WIDTHS = [160, 320, 640, 960] as const;
export const ICON_WIDTHS = [16, 32, 64, 96] as const;
const VERSION = 'webp-v1-q76';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export type ImageResult = { body: Buffer; etag: string } | { error: 404 | 502 };
export type ImageDependencies = {
  cache?: ImageCache;
  fetchImage?: typeof politeFetch;
  encode?: typeof encodeRaster;
  readIcon?: typeof readLocalFavicon;
};
export class ImageService {
  pool: Pool;
  cache: ImageCache;
  fetchImage: typeof politeFetch;
  encode: typeof encodeRaster;
  readIcon: typeof readLocalFavicon;
  flights = new Map<string, Promise<Map<number, Buffer> | null | 'busy'>>();
  negative = new Map<string, number>();
  constructor(pool: Pool, deps: ImageDependencies = {}) {
    this.pool = pool;
    this.cache = deps.cache ?? new ImageCache();
    this.fetchImage = deps.fetchImage ?? politeFetch;
    this.encode = deps.encode ?? encodeRaster;
    this.readIcon = deps.readIcon ?? readLocalFavicon;
  }
  async post(id: number, width: number): Promise<ImageResult> {
    if (!Number.isSafeInteger(id) || id < 1 || !(POST_WIDTHS as readonly number[]).includes(width)) return { error: 404 };
    try {
      // Recheck public visibility even when disk/negative caches hit. Never take a client-supplied URL.
      const [rows] = await this.pool.query<RowDataPacket[]>(
        `SELECT p.image_url FROM posts p JOIN blogs b ON b.id=p.blog_id
        WHERE p.id=? AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP()) LIMIT 1`,
        [id],
      );
      const url = rows[0]?.image_url;
      if (typeof url !== 'string' || !url) return { error: 404 };
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return { error: 404 };
      }
      if (parsed.username || parsed.password || !['http:', 'https:'].includes(parsed.protocol)) return { error: 404 };
      return await this.variant(hash(`${VERSION}:post:${url}`), width, POST_WIDTHS, async () => {
        const response = await this.fetchImage(
          url,
          { accept: 'image/jpeg,image/png,image/webp,image/gif,image/avif' },
          { timeoutMs: 8000 },
        );
        if (!response.ok || !/^image\/(?:jpeg|png|webp|gif|avif)(?:;|$)/i.test(response.headers.get('content-type') ?? ''))
          throw Error('image_source');
        const reader = response.body?.getReader();
        if (!reader) throw Error('image_size');
        const chunks: Buffer[] = [];
        let length = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            length += chunk.value.byteLength;
            if (length > MAX_IMAGE_BYTES) throw Error('image_size');
            chunks.push(Buffer.from(chunk.value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        if (!length) throw Error('image_size');
        return Buffer.concat(chunks);
      });
    } catch {
      return { error: 502 };
    }
  }
  async icon(slug: string, width: number): Promise<ImageResult> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(slug) || !(ICON_WIDTHS as readonly number[]).includes(width)) return { error: 404 };
    try {
      const bytes = await this.readIcon(slug);
      if (!bytes) return { error: 404 };
      return await this.variant(hash(`${VERSION}:icon:${hash(bytes)}`), width, ICON_WIDTHS, async () => bytes);
    } catch {
      return { error: 502 };
    }
  }
  async variant(key: string, width: number, widths: readonly number[], source: () => Promise<Buffer>): Promise<ImageResult> {
    const cached = await this.cache.read(key, width);
    if (cached && cached.length >= 12 && cached.toString('ascii', 0, 4) === 'RIFF' && cached.toString('ascii', 8, 12) === 'WEBP')
      return { body: cached, etag: `"${hash(cached)}"` };
    if ((this.negative.get(key) ?? 0) > Date.now()) return { error: 502 };
    let flight = this.flights.get(key);
    if (!flight) {
      // No unbounded decode/fetch wait queue. Cross-process writer lock also covers CLI prewarming.
      if (this.flights.size >= 8) return { error: 502 };
      flight = (async () => {
        const writer = await this.cache.writer();
        if (!writer) return 'busy' as const;
        try {
          // Another process may have completed this key before our lock acquired.
          const existing = new Map<number, Buffer>();
          for (const size of widths) {
            const bytes = await this.cache.read(key, size);
            if (bytes) existing.set(size, bytes);
          }
          if (existing.size === widths.length) return existing;
          const bytes = await source();
          const output = await this.encode(bytes, widths);
          if (!(await this.cache.write(key, output, writer.remaining))) return null;
          return output;
        } finally {
          await writer.close();
        }
      })()
        .catch(() => null)
        .finally(() => this.flights.delete(key));
      this.flights.set(key, flight);
    }
    const output = await flight;
    if (output === 'busy') return { error: 502 };
    const body = output?.get(width);
    if (!body) {
      while (this.negative.size >= 256) this.negative.delete(this.negative.keys().next().value!);
      this.negative.set(key, Date.now() + 30_000);
      return { error: 502 };
    }
    return { body, etag: `"${hash(body)}"` };
  }
}
