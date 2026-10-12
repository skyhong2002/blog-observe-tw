import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import type { Pool } from 'mysql2/promise';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedFile, ImageCache, MAX_CACHE_BYTES, MIN_FREE_BYTES } from './cache.ts';
import { encodeRaster, validWebp } from './encode.ts';
import { registerImageRoutes } from './routes.ts';
import { ImageService, POST_WIDTHS } from './service.ts';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
const webp = Buffer.from('RIFF0000WEBPtest');
webp.writeUInt32LE(webp.length - 8, 4);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'blog-images-test-'));
  dirs.push(root);
  let visible = true;
  const query = vi.fn(async () => [visible ? [{ image_url: 'https://images.example/post.png' }] : []]);
  const pool = { query } as unknown as Pool;
  const cache = new ImageCache(root, async () => MIN_FREE_BYTES + 1);
  const fetchImage = vi.fn(
    async (_url: string, _headers?: Record<string, string>) =>
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
  );
  const encode = vi.fn(async (_bytes: Buffer, widths: readonly number[]) => new Map(widths.map((w) => [w, webp])));
  const service = new ImageService(pool, { cache, fetchImage, encode, readIcon: async () => Buffer.from('localpng') });
  return {
    root,
    pool,
    query,
    cache,
    fetchImage,
    encode,
    service,
    hide: () => {
      visible = false;
    },
  };
}
describe('bounded image derivatives', () => {
  it('fetches once for concurrent sizes, persists all widths, rechecks visibility on cache hits', async () => {
    const f = await fixture();
    const results = await Promise.all(POST_WIDTHS.map((w) => f.service.post(1, w)));
    expect(results.every((r) => 'body' in r)).toBe(true);
    expect(f.fetchImage).toHaveBeenCalledTimes(1);
    expect(f.encode).toHaveBeenCalledTimes(1);
    expect((await readdir(f.root)).filter((n) => n.endsWith('.webp'))).toHaveLength(4);
    const second = new ImageService(f.pool, { cache: f.cache, fetchImage: f.fetchImage, encode: f.encode });
    expect(await second.post(1, 160)).toHaveProperty('body');
    expect(f.fetchImage).toHaveBeenCalledTimes(1);
    f.hide();
    expect(await second.post(1, 160)).toEqual({ error: 404 });
    expect(f.query).toHaveBeenCalledTimes(6);
  });
  it('refuses arbitrary widths/IDs and missing sources before fetch; never reads request credentials', async () => {
    const f = await fixture();
    expect(await f.service.post(1, 123)).toEqual({ error: 404 });
    expect(await f.service.post(-1, 160)).toEqual({ error: 404 });
    expect(f.query).not.toHaveBeenCalled();
    f.query.mockResolvedValue([[{ image_url: 'https://user:password@example.com/x' }]]);
    expect(await f.service.post(1, 160)).toEqual({ error: 404 });
    expect(f.fetchImage).not.toHaveBeenCalled();
    f.query.mockResolvedValue([[{ image_url: 'not a URL' }]]);
    expect(await f.service.post(1, 160)).toEqual({ error: 404 });
  });
  it('rejects nonraster MIME, oversize bodies, robots errors and caches failures without leaking messages', async () => {
    for (const mode of ['svg', 'oversize', 'robots']) {
      const f = await fixture();
      if (mode === 'robots') f.fetchImage.mockRejectedValue(Error('robots disallow secret-url-token'));
      else
        f.fetchImage.mockImplementation(
          async () =>
            new Response(mode === 'svg' ? '<svg/>' : new Uint8Array(5 * 1024 * 1024 + 1), {
              headers: { 'content-type': mode === 'svg' ? 'image/svg+xml' : 'image/png' },
            }),
        );
      expect(await f.service.post(1, 160)).toEqual({ error: 502 });
      expect(await f.service.post(1, 320)).toEqual({ error: 502 });
      expect(f.fetchImage).toHaveBeenCalledTimes(1);
      expect(f.encode).not.toHaveBeenCalled();
    }
  });
  it('does not fetch or write new cache at low disk space or full budget; leaves existing files', async () => {
    const f = await fixture();
    f.cache.freeBytes = async () => MIN_FREE_BYTES - 1;
    expect(await f.service.post(1, 160)).toEqual({ error: 502 });
    expect(f.fetchImage).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual([]);
    f.cache.freeBytes = async () => MIN_FREE_BYTES + 1;
    const file = await import('node:fs/promises').then((fs) => fs.open(join(f.root, 'existing'), 'w'));
    await file.truncate(MAX_CACHE_BYTES);
    await file.close();
    expect(await f.cache.writer()).toBeNull();
    expect(await readdir(f.root)).toEqual(expect.arrayContaining(['existing', '.writer.lock', '.usage.json']));
  });
  it('enforces cross-process writer exclusion and bounded non-symlink reads', async () => {
    const f = await fixture(),
      second = new ImageCache(f.root, async () => MIN_FREE_BYTES + 1);
    const lock = await f.cache.writer();
    expect(lock).not.toBeNull();
    expect(await second.writer()).toBeNull();
    await lock!.close();
    const next = await second.writer();
    expect(next).not.toBeNull();
    await next!.close();
    await writeFile(join(f.root, 'file'), webp);
    await symlink(join(f.root, 'file'), join(f.root, 'link'));
    expect(await boundedFile(join(f.root, 'link'), 100)).toBeNull();
    expect(await boundedFile(join(f.root, 'file'), 2)).toBeNull();
  });
  it('does not negative-cache a busy writer, and uses a durable conservative usage ledger', async () => {
    const f = await fixture();
    const held = await f.cache.writer();
    expect(await f.service.post(1, 160)).toEqual({ error: 502 });
    expect(f.service.negative.size).toBe(0);
    expect(f.fetchImage).not.toHaveBeenCalled();
    await held!.close();
    expect(await f.service.post(1, 160)).toHaveProperty('body');
    const initial = await f.cache.usage();
    expect(initial).toBe(8192 + webp.length * 4);
    const lock = await f.cache.writer();
    await f.cache.recordUsage(initial + 1000); // Crash-equivalent reservation without publication.
    await lock!.close();
    const next = await new ImageCache(f.root, async () => MIN_FREE_BYTES + 1).writer();
    expect(next?.remaining).toBe(MAX_CACHE_BYTES - initial - 1000);
    await next!.close();
    await writeFile(join(f.root, '.usage.pending'), 'interrupted');
    await expect(f.cache.writer()).rejects.toThrow('image_cache_pending');
    expect(await readdir(f.root)).toContain('.usage.pending');
  });
  it('releases kernel lock after owner death without unlinking or stale takeover', async () => {
    const f = await fixture();
    const script = `import {imageWriterLock} from ${JSON.stringify(new URL('./lock.ts', import.meta.url).href)}; const release=await imageWriterLock(${JSON.stringify(join(f.root, '.writer.lock'))}); if(!release)process.exit(1);process.stdout.write('ready');setInterval(()=>{},1000);`;
    const parent = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'ignore'], env: {} });
    try {
      await once(parent.stdout, 'data');
      expect(await f.cache.writer()).toBeNull();
      parent.kill('SIGKILL');
      await once(parent, 'close');
      let lock: Awaited<ReturnType<ImageCache['writer']>> = null;
      for (let i = 0; i < 20 && !lock; i++) {
        await new Promise((r) => setTimeout(r, 25));
        lock = await f.cache.writer();
      }
      expect(lock).not.toBeNull();
      await lock?.close();
      expect(await readdir(f.root)).toContain('.writer.lock');
    } finally {
      parent.kill('SIGKILL');
    }
  }, 5000);
  it('rejects a truncated RIFF cache even with a valid signature', async () => {
    const f = await fixture(),
      key = 'a'.repeat(64);
    const truncated = webp.subarray(0, 14);
    expect(validWebp(webp)).toBe(true);
    expect(validWebp(truncated)).toBe(false);
    await writeFile(f.cache.path(key, 160), truncated);
    expect(await f.cache.read(key, 160)).toBeNull();
  });
  it('local icons never fetch, respect content revision and reject traversal/missing', async () => {
    const f = await fixture();
    expect(await f.service.icon('writer', 32)).toHaveProperty('body');
    expect(f.fetchImage).not.toHaveBeenCalled();
    expect(await f.service.icon('../secret', 32)).toEqual({ error: 404 });
    f.service.readIcon = async () => null;
    expect(await f.service.icon('writer', 32)).toEqual({ error: 404 });
  });
  it('serves WebP GET/HEAD and conditional responses; invalid/query URLs cannot select a fetch target', async () => {
    const f = await fixture(),
      app = Fastify();
    registerImageRoutes(app, f.pool, f.service);
    const get = await app.inject('/images/posts/1/160.webp?url=http://127.0.0.1');
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/webp');
    expect((await app.inject({ method: 'HEAD', url: '/images/posts/1/160.webp' })).body).toBe('');
    expect((await app.inject({ url: '/images/posts/1/160.webp', headers: { 'if-none-match': String(get.headers.etag) } })).statusCode).toBe(
      304,
    );
    expect((await app.inject('/images/posts/1/161.webp')).statusCode).toBe(404);
    expect(f.fetchImage.mock.calls[0]?.[0]).toBe('https://images.example/post.png');
    await app.close();
  });
  it('isolates raster decoding, prevents upscaling, rejects disguised SVG and pixel bombs', async () => {
    const sharp = createRequire(new URL('../../../web/package.json', import.meta.url))('sharp');
    const png = await sharp({ create: { width: 40, height: 20, channels: 4, background: '#fff' } })
      .png()
      .toBuffer();
    const output = await encodeRaster(png, [160, 320]);
    expect((await sharp(output.get(160)).metadata()).width).toBe(40);
    const avif = await sharp(png).avif().toBuffer();
    expect((await sharp(avif).metadata()).format).toBe('heif');
    expect((await encodeRaster(avif, [160])).has(160)).toBe(true);
    const genericBrand = Buffer.from(avif);
    genericBrand.write('mif1', 8, 'ascii');
    // This sharp build labels a generic mif1 major brand as hevc even with avif
    // compatibility. Fail closed rather than accepting arbitrary HEIC input.
    expect((await sharp(genericBrand).metadata()).compression).toBe('hevc');
    await expect(encodeRaster(genericBrand, [160])).rejects.toThrow('image_decode_failed');
    await expect(encodeRaster(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'), [160])).rejects.toThrow(
      'image_decode_failed',
    );
    const bomb = Buffer.from(png);
    bomb.writeUInt32BE(100000, 16);
    bomb.writeUInt32BE(100000, 20);
    await expect(encodeRaster(bomb, [160])).rejects.toThrow('image_decode_failed');
  }, 15000);
});
