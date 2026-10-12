import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  declaredIcons,
  faviconSiteKey,
  icoToImage,
  isPlatformGenericIcon,
  loadFaviconState,
  MONTH_MS,
  refreshFavicon,
  toPng,
} from './favicons.ts';
import { politeFetch } from './feed.ts';

vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock('./feed.ts', async (original) => ({ ...(await original<typeof import('./feed.ts')>()), politeFetch: vi.fn() }));
const dirs: string[] = [];
const target = { slug: 'writer', id: 1, title: 'Writer', kind: 'blog' as const, url: 'https://writer.example/blog/' };
const sharp = createRequire(new URL('../../../web/package.json', import.meta.url))('sharp') as (
  input: Buffer,
  options: { raw: { width: number; height: number; channels: 4 } },
) => { png(): { toBuffer(): Promise<Buffer> } };
async function png() {
  return sharp(Buffer.alloc(32 * 48 * 4, 255), { raw: { width: 32, height: 48, channels: 4 } })
    .png()
    .toBuffer();
}
async function root() {
  const dir = await mkdtemp(join(tmpdir(), 'blog-favicons-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('favicon conversion and discovery', () => {
  it('keeps declared favicon priority ahead of touch/mask, with manifest and page-image fallbacks', () => {
    const links = declaredIcons(
      '<link rel="apple-touch-icon" href="touch.png"><link rel="mask-icon" href="mask.svg"><link rel="icon" sizes="192x192" href="icon.png"><link rel="manifest" href="app.json"><meta property="og:image" content="cover.png">',
      target.url,
    );
    expect(links.icons).toEqual([
      'https://writer.example/blog/icon.png',
      'https://writer.example/blog/touch.png',
      'https://writer.example/blog/mask.svg',
    ]);
    expect(links.manifests).toEqual(['https://writer.example/blog/app.json']);
    expect(links.images).toEqual(['https://writer.example/blog/cover.png']);
  });
  it('rejects shared platform site-wide icons but preserves explicitly scoped icons', () => {
    expect(isPlatformGenericIcon('https://medium.com/@writer', 'https://medium.com/favicon.ico')).toBe(true);
    expect(isPlatformGenericIcon('https://vocus.cc/salon/writer', 'https://vocus.cc/salon/writer/icon.png')).toBe(false);
    expect(isPlatformGenericIcon('https://writer.wordpress.com', 'https://s0.wp.com/i/favicon.ico')).toBe(true);
    expect(isPlatformGenericIcon('https://writer.wordpress.com', 'https://wordpress.com/favicon.ico')).toBe(true);
  });
  it('rejects truncated ICO headers and oversized bitmaps before allocating pixels', () => {
    expect(icoToImage(Buffer.from([0, 0, 1]))).toBeNull();
    const icon = Buffer.alloc(62);
    icon.writeUInt16LE(1, 2);
    icon.writeUInt16LE(1, 4);
    icon.writeUInt32LE(40, 14);
    icon.writeUInt32LE(22, 18);
    icon.writeUInt32LE(40, 22);
    icon.writeInt32LE(65535, 26);
    icon.writeInt32LE(65535 * 2, 30);
    icon.writeUInt16LE(32, 36);
    expect(icoToImage(icon)).toBeNull();
  });
  it('normalizes bitmap and ICO PNG entries to a 192px transparent canvas', async () => {
    const body = await png();
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header[6] = 32;
    header[7] = 48;
    header.writeUInt32LE(body.length, 14);
    header.writeUInt32LE(22, 18);
    const output = await toPng(Buffer.concat([header, body]));
    expect(output?.sourceWidth).toBe(32);
    expect(output?.sourceHeight).toBe(48);
    expect(output?.png.readUInt32BE(16)).toBe(192);
    expect(output?.png.readUInt32BE(20)).toBe(192);
    expect(output?.transparent).toBe(true);
    expect(await toPng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"/>'))).toBeNull();
  });
  it('isolates platform authors when reusing an origin and rejects external SVG resources', async () => {
    expect(faviconSiteKey('https://independent.example/posts/one')).toBe(faviconSiteKey('https://independent.example/posts/two'));
    expect(faviconSiteKey('https://medium.com/@one/post')).not.toBe(faviconSiteKey('https://medium.com/@two/post'));
    expect(
      await toPng(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><image href="file:///etc/passwd"/></svg>')),
    ).toBeNull();
  });
  it('reuses one successful site result for candidates without making a second request', async () => {
    const directory = await root();
    const state = await loadFaviconState(directory);
    const batchCache = new Map<string, string>();
    vi.mocked(politeFetch)
      .mockResolvedValueOnce(new Response('<link rel="icon" href="/mark.png">', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(await png(), { headers: { 'content-type': 'image/png' } }));
    await refreshFavicon(target, { root: directory, state, batchCache });
    const result = await refreshFavicon(
      { ...target, slug: 'candidate-17', kind: 'candidate', url: 'https://writer.example/post' },
      { root: directory, state, batchCache },
    );
    expect(result.status).toBe('success');
    expect(politeFetch).toHaveBeenCalledTimes(2);
    expect(state.catalog['candidate-17'].kind).toBe('candidate');
    expect(state.local['candidate-17'].targetUrl).toBe('https://writer.example/post');
  });
  it('rejects compressed/UTF-16 SVG, CSS escapes, entities and base overrides before decoder auto-detection', async () => {
    const safe = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path fill="red" d="M0 0h64v64H0z"/></svg>';
    const foreign = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><foreignObject width="64" height="64"/></svg>';
    expect(await toPng(Buffer.from(safe))).not.toBeNull();
    const rejected = [
      gzipSync(Buffer.from(foreign)),
      gzipSync(Buffer.from(safe)),
      Buffer.from(safe, 'utf16le'),
      Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(safe, 'utf16le')]),
      Buffer.from(safe.replace('fill="red"', String.raw`fill="u\72l(https://evil.test/icon)"`)),
      Buffer.from(safe.replace('fill="red"', 'fill="&#117;rl(https://evil.test/icon)"')),
      Buffer.from(safe.replace('<svg ', '<svg xml:base="https://evil.test/" ')),
      Buffer.from(safe.replace('<path ', '<style>*{fill:red}</style><path ')),
      Buffer.from(safe.replace('fill="red"', 'style="fill:red"')),
      Buffer.from('BM\0not-an-allowed-bitmap'),
    ];
    for (const body of rejected) expect(await toPng(body)).toBeNull();
  });
  it('rejects WordPress webclip and Blogger shared branding while retaining uploaded avatars', () => {
    expect(isPlatformGenericIcon('https://writer.wordpress.com', 'https://s0.wp.com/i/webclip.png')).toBe(true);
    expect(isPlatformGenericIcon('https://writer.blogspot.com', 'https://www.blogger.com/img/logo.png')).toBe(true);
    expect(isPlatformGenericIcon('https://writer.blogspot.com', 'https://resources.blogblog.com/img/favicon.ico')).toBe(true);
    expect(isPlatformGenericIcon('https://writer.wordpress.com', 'https://s0.wp.com/static/app.png')).toBe(true);
    expect(isPlatformGenericIcon('https://writer.wordpress.com', 'https://i0.wp.com/uploads/writer/photo.png')).toBe(false);
    expect(isPlatformGenericIcon('https://writer.blogspot.com', 'https://blogger.googleusercontent.com/img/b/R29vZ2xl/photo.png')).toBe(
      false,
    );
  });
  it('removes only the old identity icon when a target URL changes or disappears', async () => {
    const directory = await root();
    const body = await png();
    vi.mocked(politeFetch)
      .mockResolvedValueOnce(new Response('<link rel="icon" href="/mark.png">', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'image/png' } }));
    await refreshFavicon(target, { root: directory });
    vi.mocked(politeFetch).mockRejectedValue(new Error('unavailable'));
    expect((await refreshFavicon(target, { root: directory, all: true })).status).toBe('failure');
    expect(await stat(join(directory, 'web/public/favicons/writer.png')).then(() => true)).toBe(true);
    expect((await refreshFavicon({ ...target, url: 'https://different.example/' }, { root: directory })).status).toBe('failure');
    expect((await loadFaviconState(directory)).local.writer).toBeUndefined();
    expect(
      await stat(join(directory, 'web/public/favicons/writer.png'))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
    vi.mocked(politeFetch)
      .mockReset()
      .mockResolvedValueOnce(new Response('<link rel="icon" href="/mark.png">', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'image/png' } }));
    await refreshFavicon(target, { root: directory });
    expect((await refreshFavicon({ ...target, url: null }, { root: directory })).status).toBe('default');
    expect((await loadFaviconState(directory)).local.writer).toBeUndefined();
    expect(
      await stat(join(directory, 'web/public/favicons/writer.png'))
        .then(() => true)
        .catch(() => false),
    ).toBe(false);
  });
  it('bounds real SVG filter rendering with the isolated decoder deadline', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="4000"><defs><filter id="noise"><feTurbulence type="fractalNoise" baseFrequency="0.4" numOctaves="20"/><feGaussianBlur stdDeviation="120"/></filter></defs><rect width="4000" height="4000" filter="url(#noise)"/></svg>';
    const started = performance.now();
    const output = await toPng(Buffer.from(svg));
    expect(performance.now() - started).toBeLessThan(5000);
    if (output) expect(output.png.readUInt32BE(16)).toBe(192);
  }, 6000);
  it('kills the isolated decoder at the wall-clock deadline instead of leaving native work running', async () => {
    const body = await png();
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: vi.fn() }),
      kill: vi.fn((_signal: string) => {
        child.emit('close', null, 'SIGKILL');
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValueOnce(child as unknown as ReturnType<typeof spawn>);
    vi.useFakeTimers();
    try {
      const result = toPng(body);
      await vi.advanceTimersByTimeAsync(4000);
      expect(await result).toBeNull();
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects ICO directory/bitmap size disagreement and truncated bitmap pixels', () => {
    const icon = Buffer.alloc(22 + 40 + 32 * 32 * 4);
    icon.writeUInt16LE(1, 2);
    icon.writeUInt16LE(1, 4);
    icon[6] = 32;
    icon[7] = 32;
    icon.writeUInt32LE(icon.length - 22, 14);
    icon.writeUInt32LE(22, 18);
    icon.writeUInt32LE(40, 22);
    icon.writeInt32LE(16, 26);
    icon.writeInt32LE(64, 30);
    icon.writeUInt16LE(32, 36);
    expect(icoToImage(icon)).toBeNull();
    icon.writeInt32LE(32, 26);
    icon.writeUInt32LE(40, 14);
    expect(icoToImage(icon.subarray(0, 62))).toBeNull();
  });
  it('does not guess a URL for an unverified seed', async () => {
    const directory = await root();
    expect((await refreshFavicon({ ...target, url: null }, { root: directory })).status).toBe('default');
    expect(politeFetch).not.toHaveBeenCalled();
    expect((await loadFaviconState(directory)).catalog.writer.verified).toBe(false);
  });
  it('uses conditional refresh and checkpoints verified source provenance after conversion', async () => {
    const directory = await root();
    const body = await png();
    vi.mocked(politeFetch)
      .mockResolvedValueOnce(
        new Response('<link rel="icon" href="/mark.png">', { headers: { 'content-type': 'text/html', etag: 'home-1' } }),
      )
      .mockResolvedValueOnce(new Response(body, { headers: { 'content-type': 'image/png', etag: 'icon-1' } }));
    expect((await refreshFavicon(target, { root: directory, now: new Date('2026-01-01') })).status).toBe('success');
    const state = await loadFaviconState(directory);
    expect(state.catalog.writer.verified).toBe(true);
    expect(state.local.writer.revision).toHaveLength(16);
    expect((await readFile(join(directory, 'web/public/favicons/writer.png'))).readUInt32BE(16)).toBe(192);
    vi.mocked(politeFetch)
      .mockResolvedValueOnce(new Response(null, { status: 304 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect((await refreshFavicon(target, { root: directory, now: new Date('2026-02-02'), refreshAfterMs: MONTH_MS })).status).toBe(
      'success',
    );
    expect(vi.mocked(politeFetch).mock.calls.at(-1)?.[1]).toMatchObject({ 'if-none-match': 'icon-1' });
    expect((await refreshFavicon(target, { root: directory, now: new Date('2026-02-03') })).status).toBe('skipped');
  });
  it('never verifies HTML disguised as an icon or unsafe declared URLs', async () => {
    const directory = await root();
    vi.mocked(politeFetch)
      .mockResolvedValueOnce(new Response('<link rel="icon" href="http://127.0.0.1/admin">', { headers: { 'content-type': 'text/html' } }))
      .mockResolvedValueOnce(new Response('<html>not an image</html>', { headers: { 'content-type': 'text/html' } }));
    expect((await refreshFavicon(target, { root: directory })).status).toBe('failure');
    expect((await loadFaviconState(directory)).catalog.writer.verified).toBe(false);
    expect(vi.mocked(politeFetch).mock.calls.map(([url]) => url)).not.toContain('http://127.0.0.1/admin');
  });
});
