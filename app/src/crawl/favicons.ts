// Adapted from tag.observe.tw afe0a65 tools/fetch-favicons.ts.
// Copyright (c) 2026 Sky Hong. MIT; see LICENSE and NOTICE.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as cheerio from 'cheerio';
import { type FeedCrawlerOptions, isAllowedCrawlUrl, MAX_RESPONSE_BYTES, politeFetch } from './feed.ts';

interface Sharp {
  metadata(): Promise<{ width?: number; height?: number; pages?: number; format?: string }>;
  timeout(options: { seconds: number }): Sharp;
  stats(): Promise<{ isOpaque: boolean }>;
  resize(w: number, h: number, o: { fit: 'contain'; background: { r: number; g: number; b: number; alpha: number } }): Sharp;
  png(): Sharp;
  toBuffer(): Promise<Buffer>;
}
const sharp = createRequire(new URL('../../../web/package.json', import.meta.url))('sharp') as (
  input: Buffer,
  options?: { raw?: { width: number; height: number; channels: 4 }; limitInputPixels?: number; animated?: boolean },
) => Sharp;
const SIZE = 192;
export const MAX_PIXELS = 16_777_216;
export const MONTH_MS = 30 * 86_400_000;
export type FaviconTarget = { slug: string; url: string | null; title: string; kind: 'blog' | 'candidate'; id: number };
type Icon = { png: Buffer; sourceWidth: number; sourceHeight: number; transparent: boolean };
type Cache = { etag?: string; lastModified?: string; links?: PageLinks; icons?: string[] };
type PageLinks = { icons: string[]; manifests: string[]; images: string[] };
export type CatalogEntry = FaviconTarget & {
  icon: string | null;
  verified: boolean;
  checkedAt: string;
  status: 'success' | 'failure' | 'default';
  reason?: string;
  sources: string[];
  cache: Record<string, Cache>;
};
export type LocalIcon = {
  revision: string;
  source: string;
  fetchedAt: string;
  sourceWidth: number;
  sourceHeight: number;
  transparent: boolean;
  targetUrl: string;
  kind: 'blog' | 'candidate';
};
export type FaviconState = { catalog: Record<string, CatalogEntry>; local: Record<string, LocalIcon> };
export type RefreshOptions = FeedCrawlerOptions & {
  root?: string;
  state?: FaviconState;
  all?: boolean;
  refreshAfterMs?: number;
  now?: Date;
  batchCache?: Map<string, string>;
  maxTargetMs?: number;
};
const ROOT = process.env.BLOG_FAVICON_ROOT || new URL('../../../', import.meta.url).pathname;

// ICO: pick the largest entry; PNG entries go to sharp as-is, BMP entries
// (32/24/8/4/1-bit, bottom-up, with a 1-bit transparency mask) become RGBA.
export function icoToImage(buf: Buffer): Buffer | { raw: Buffer; width: number; height: number } | null {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const n = buf.readUInt16LE(4);
  if (!n || n > 256 || 6 + n * 16 > buf.length) return null;
  const entries = Array.from({ length: n }, (_, i) => {
    const o = 6 + i * 16;
    return { w: buf[o] || 256, h: buf[o + 1] || 256, size: buf.readUInt32LE(o + 8), offset: buf.readUInt32LE(o + 12) };
  }).sort((a, b) => b.w - a.w);
  for (const e of entries) {
    if (e.offset < 6 + n * 16 || e.offset + e.size > buf.length || e.size < 8) continue;
    const data = buf.subarray(e.offset, e.offset + e.size);
    if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      if (data.length >= 24 && data.readUInt32BE(16) === e.w && data.readUInt32BE(20) === e.h) return data;
      continue;
    }
    if (data.length < 40) continue;
    const header = data.readUInt32LE(0);
    if (header < 40 || header > data.length) continue;
    const width = data.readInt32LE(4);
    const height = data.readInt32LE(8) / 2;
    const bpp = data.readUInt16LE(14);
    if (
      ![1, 4, 8, 24, 32].includes(bpp) ||
      width <= 0 ||
      height <= 0 ||
      !Number.isInteger(height) ||
      width !== e.w ||
      height !== e.h ||
      width * height > MAX_PIXELS ||
      width > 4096 ||
      height > 4096
    )
      continue;
    const colors = bpp <= 8 ? data.readUInt32LE(32) || 1 << bpp : 0;
    if (colors > 256 || header + colors * 4 > data.length) continue;
    const palette = data.subarray(header, header + colors * 4);
    const pixels = data.subarray(header + colors * 4);
    const stride = Math.ceil((width * bpp) / 32) * 4;
    if (stride * height > pixels.length) continue;
    const mask = pixels.subarray(stride * height);
    const maskStride = Math.ceil(width / 32) * 4;
    const raw = Buffer.alloc(width * height * 4);
    let anyAlpha = false;
    for (let y = 0; y < height; y++) {
      const row = (height - 1 - y) * stride;
      for (let x = 0; x < width; x++) {
        const d = (y * width + x) * 4;
        let b: number,
          g: number,
          r: number,
          a = 255;
        if (bpp === 32 || bpp === 24) {
          const s = row + x * (bpp / 8);
          [b, g, r] = [pixels[s], pixels[s + 1], pixels[s + 2]];
          if (bpp === 32) {
            a = pixels[s + 3];
            if (a) anyAlpha = true;
          }
        } else {
          const bit = x * bpp;
          const idx = (pixels[row + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
          [b, g, r] = [palette[idx * 4], palette[idx * 4 + 1], palette[idx * 4 + 2]];
        }
        raw.set([r, g, b, a], d);
      }
    }
    // The AND mask marks transparent pixels; 32-bit icons usually carry alpha instead.
    if (bpp !== 32 || !anyAlpha)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const m = mask[(height - 1 - y) * maskStride + (x >> 3)];
          if (m !== undefined && (m >> (7 - (x & 7))) & 1) raw[(y * width + x) * 4 + 3] = 0;
          else if (bpp === 32) raw[(y * width + x) * 4 + 3] = 255;
        }
    return { raw, width, height };
  }
  return null;
}

/** Format detection is a gate before libvips: never let its gzip/SVG autodetection bypass validation. */
function allowedImageFormat(body: Buffer): 'png' | 'jpeg' | 'gif' | 'webp' | 'ico' | 'svg' | null {
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpeg';
  if (['GIF87a', 'GIF89a'].includes(body.subarray(0, 6).toString('ascii'))) return 'gif';
  if (body.length >= 12 && body.subarray(0, 4).toString('ascii') === 'RIFF' && body.subarray(8, 12).toString('ascii') === 'WEBP')
    return 'webp';
  if (body.length >= 6 && body.readUInt16LE(0) === 0 && body.readUInt16LE(2) === 1) return 'ico';
  // SVG must be uncompressed UTF-8 with a literal root element. Reject UTF-16/NUL and unknown binaries.
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return null;
  }
  if (xml.includes('\0') || !/^\s*(?:<\?xml\s[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(xml)) return null;
  // Restrict vectors to self-contained geometry. Conservatively reject CSS, entities, encodings,
  // embedded images, foreign content, namespace base overrides and escape-based obfuscation.
  if (
    /\\|&|<!DOCTYPE|<!ENTITY|<\?(?!xml\s)|\bxml:base\s*=|\bstyle\s*=|<(?:[a-z][\w.-]*:)?(?:image|foreignObject|script|style|animate|animateTransform|set)\b|@import/i.test(
      xml,
    )
  )
    return null;
  const encoding = xml.match(/<\?xml[^?]*\bencoding\s*=\s*["']([^"']+)["']/i)?.[1];
  if (encoding && !/^utf-8$/i.test(encoding)) return null;
  for (const match of xml.matchAll(/\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    if (!/^#[a-z_][\w.:-]*$/i.test((match[1] ?? match[2] ?? match[3] ?? '').trim())) return null;
  }
  for (const match of xml.matchAll(/url\(([^)]*)\)/gi)) {
    if (!/^#[a-z_][\w.:-]*$/i.test(match[1].trim().replace(/^["']|["']$/g, ''))) return null;
  }
  return 'svg';
}

const DECODER_WALL_MS = 4000;
const decoderScript = `const { decodeFavicon } = await import(process.argv[1]);
const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const result = await decodeFavicon(Buffer.concat(chunks));
process.stdout.write(JSON.stringify(result ? { ...result, png: result.png.toString('base64') } : null));`;

/** Native decoders are isolated: SIGKILL ends metadata/render work even if libvips does not observe its timeout. */
export async function toPng(body: Buffer): Promise<Icon | null> {
  if (body.length > MAX_RESPONSE_BYTES || !allowedImageFormat(body)) return null;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--max-old-space-size=128', '--input-type=module', '--eval', decoderScript, import.meta.url], {
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '';
    let killed = false;
    let settled = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, DECODER_WALL_MS);
    const finish = (result: Icon | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.once('error', () => finish(null));
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.length > 256 * 1024) {
        killed = true;
        child.kill('SIGKILL');
      }
    });
    child.once('close', (code) => {
      if (killed || code !== 0) return finish(null);
      try {
        const data = JSON.parse(output) as (Omit<Icon, 'png'> & { png: string }) | null;
        finish(data ? { ...data, png: Buffer.from(data.png, 'base64') } : null);
      } catch {
        finish(null);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body);
  });
}

/** Internal child-process entrypoint; callers must use toPng for its wall-clock boundary. */
export async function decodeFavicon(body: Buffer): Promise<Icon | null> {
  try {
    if (body.length > MAX_RESPONSE_BYTES) return null;
    const format = allowedImageFormat(body);
    if (!format) return null;
    const ico = format === 'ico' ? icoToImage(body) : null;
    if (format === 'ico' && !ico) return null;
    const input =
      ico && !Buffer.isBuffer(ico)
        ? sharp(ico.raw, { raw: { width: ico.width, height: ico.height, channels: 4 }, limitInputPixels: MAX_PIXELS })
        : sharp(ico ?? body, { limitInputPixels: MAX_PIXELS, animated: false });
    input.timeout({ seconds: 3 });
    const meta = await input.metadata();
    const expected = format === 'ico' ? (Buffer.isBuffer(ico) ? 'png' : 'raw') : format;
    // In particular, a decoder-detected SVG is accepted only after the raw SVG gate above.
    if (meta.format !== expected || (meta.format === 'svg' && format !== 'svg')) return null;
    if (
      !meta.width ||
      !meta.height ||
      meta.width < 16 ||
      meta.height < 16 ||
      meta.width * meta.height > MAX_PIXELS ||
      (meta.pages ?? 1) > 1
    )
      return null;
    const png = await input
      .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    // Only inspect the bounded 192px result, never render the untrusted source twice.
    const stats = await sharp(png, { limitInputPixels: SIZE * SIZE })
      .timeout({ seconds: 3 })
      .stats();
    return { png, sourceWidth: meta.width, sourceHeight: meta.height, transparent: !stats.isOpaque };
  } catch {
    return null;
  }
}

const platformRoots = [
  'medium.com',
  'vocus.cc',
  'matters.town',
  'pixnet.net',
  'wordpress.com',
  'blogspot.com',
  'substack.com',
  'blog.udn.com',
  'blog.xuite.net',
];
/** Independent sites share an origin; shared platforms retain author/site path identity. */
export function faviconSiteKey(value: string): string {
  const url = new URL(value);
  const platform = platformRoots.find((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (!platform) return url.origin;
  const segments = url.pathname.split('/').filter(Boolean);
  const count = ['vocus.cc', 'blog.xuite.net'].includes(platform) ? 2 : 1;
  const rootHost = url.hostname === platform || url.hostname === `www.${platform}`;
  return `${url.origin}${rootHost ? `/${segments.slice(0, count).join('/')}` : ''}`;
}

/** A shared platform's root mark must never impersonate an individual blog. */
export function isPlatformGenericIcon(target: string, icon: string): boolean {
  const site = new URL(target);
  const image = new URL(icon);
  const platform = platformRoots.find((host) => site.hostname === host || site.hostname.endsWith(`.${host}`));
  if (!platform) return false;
  const siteIsRoot = site.hostname === platform || site.hostname === `www.${platform}`;
  const assetRoots: Record<string, string[]> = {
    'wordpress.com': ['wp.com'],
    'blogspot.com': ['blogger.com', 'blogblog.com', 'blogger.googleusercontent.com'],
    'pixnet.net': ['pixfs.net'],
    'medium.com': ['mediumusercontent.com'],
  };
  const imageOnPlatform = [platform, ...(assetRoots[platform] ?? [])].some(
    (host) => image.hostname === host || image.hostname.endsWith(`.${host}`),
  );
  if (!imageOnPlatform) return false;
  if (!siteIsRoot && image.hostname === site.hostname) return false;
  if (siteIsRoot) {
    const scope = site.pathname.replace(/\/$/, '');
    if (scope && scope !== '/' && image.hostname === site.hostname && image.pathname.startsWith(`${scope}/`)) return false;
  }
  // Shared CDN defaults are platform branding, even when called webclip rather than favicon.
  if (/(?:favicon|(?:^|[/_.-])(?:icons?|logos?|webclip|brand|default|static)(?:[/_.-]|$))/i.test(image.pathname)) return true;
  // Author-uploaded avatar/media paths can legitimately live on the shared asset host.
  if (/\/(?:uploads?|avatars?)\/[^/]+|\/img\/b\/R[^/]+/i.test(image.pathname)) return false;
  return true;
}

const absolute = (value: string | undefined, base: string): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value, base).href;
    return isAllowedCrawlUrl(url) ? url : null;
  } catch {
    return null;
  }
};
const unique = (urls: string[]) => [...new Set(urls)].slice(0, 24);

export function declaredIcons(html: string, base: string): PageLinks {
  const $ = cheerio.load(html.slice(0, MAX_RESPONSE_BYTES));
  const icons: Array<{ url: string; priority: number; size: number }> = [];
  const manifests: string[] = [];
  const images: string[] = [];
  $('link[href]').each((_index, element) => {
    const node = $(element);
    const url = absolute(node.attr('href'), base);
    if (!url) return;
    const rel = (node.attr('rel') ?? '').toLowerCase().split(/\s+/);
    if (rel.includes('manifest')) manifests.push(url);
    const kind = rel.includes('icon') ? 0 : rel.some((r) => r.startsWith('apple-touch-icon')) ? 1 : rel.includes('mask-icon') ? 2 : -1;
    if (kind < 0) return;
    const size = Number((node.attr('sizes') ?? '').match(/\d+/)?.[0] ?? (kind === 1 ? 180 : 32));
    icons.push({ url, priority: kind, size: size >= SIZE ? 1000 - Math.abs(size - SIZE) : size });
  });
  $('meta[property="og:image"], meta[name="og:image"], meta[itemprop="logo"]').each((_index, element) => {
    const url = absolute($(element).attr('content'), base);
    if (url) images.push(url);
  });
  $('img[itemprop="logo"], img[rel="logo"]').each((_index, element) => {
    const url = absolute($(element).attr('src'), base);
    if (url) images.push(url);
  });
  return {
    icons: unique(icons.sort((a, b) => a.priority - b.priority || b.size - a.size).map((item) => item.url)),
    manifests: unique(manifests).slice(0, 2),
    images: unique(images).slice(0, 3),
  };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}
export async function loadFaviconState(root = ROOT): Promise<FaviconState> {
  return {
    catalog: await readJson(join(root, 'app/data/favicon-catalog.json'), {}),
    local: await readJson(join(root, 'app/data/favicon-local.json'), {}),
  };
}
async function atomicWrite(path: string, data: string | Buffer) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, data);
  await rename(temporary, path);
}
export async function saveFaviconState(state: FaviconState, root = ROOT) {
  // Checkpoint after every target. Only one process may own the batch lock.
  await atomicWrite(join(root, 'app/data/favicon-catalog.json'), `${JSON.stringify(state.catalog, null, 2)}\n`);
  await atomicWrite(join(root, 'app/data/favicon-local.json'), `${JSON.stringify(state.local, null, 2)}\n`);
}

/** Download one site's mark; caller serializes calls. Monthly worker use: refreshAfterMs: MONTH_MS. */
export async function refreshFavicon(target: FaviconTarget, options: RefreshOptions = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(target.slug)) throw new Error('invalid favicon slug');
  const root = options.root ?? ROOT;
  const state = options.state ?? (await loadFaviconState(root));
  const now = options.now ?? new Date();
  let previous: LocalIcon | undefined = state.local[target.slug];
  const output = join(root, 'web/public/favicons', `${target.slug}.png`);
  // A URL change changes the site's identity. A failed refresh must not retain the old site's mark.
  if (!previous || previous.targetUrl !== target.url) {
    delete state.local[target.slug];
    previous = undefined;
    await unlink(output).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  const exists = await stat(output)
    .then((file) => file.isFile())
    .catch(() => false);
  if (
    exists &&
    previous?.targetUrl === target.url &&
    !options.all &&
    (!options.refreshAfterMs || now.getTime() - Date.parse(previous.fetchedAt) < options.refreshAfterMs)
  ) {
    return { status: 'skipped' as const, slug: target.slug };
  }
  const identity = target.url && isAllowedCrawlUrl(target.url) ? faviconSiteKey(target.url) : null;
  const reused = identity ? options.batchCache?.get(identity) : undefined;
  if (reused && state.catalog[reused]) {
    const record = state.catalog[reused];
    state.catalog[target.slug] = { ...record, ...target, checkedAt: now.toISOString() };
    const local = state.local[reused];
    if (record.status === 'success' && local && target.url) {
      await mkdir(dirname(output), { recursive: true });
      const temporary = `${output}.${process.pid}.tmp`;
      await copyFile(join(root, 'web/public/favicons', `${reused}.png`), temporary);
      await rename(temporary, output);
      state.local[target.slug] = { ...local, targetUrl: target.url, kind: target.kind };
    }
    await saveFaviconState(state, root);
    return { status: record.status, slug: target.slug, reason: `same-site:${reused}` };
  }
  const startedAt = Date.now();
  const old = state.catalog[target.slug];
  const entry: CatalogEntry = {
    ...target,
    icon: null,
    verified: false,
    checkedAt: now.toISOString(),
    status: 'failure',
    sources: [],
    cache: old?.url === target.url ? (old.cache ?? {}) : {},
  };
  state.catalog[target.slug] = entry;
  const finish = async (status: CatalogEntry['status'], reason?: string) => {
    entry.status = status;
    entry.reason = reason;
    if (identity) options.batchCache?.set(identity, target.slug);
    await saveFaviconState(state, root);
    return { status, slug: target.slug, reason };
  };
  if (!target.url) return finish('default', 'no-source-url');
  if (!isAllowedCrawlUrl(target.url)) return finish('default', 'unsafe-source-url');
  const get = async (url: string, accept: string, conditional = true) => {
    if (Date.now() - startedAt > (options.maxTargetMs ?? 30_000)) throw new Error('favicon target time budget exceeded');
    const cache = entry.cache[url] ?? {};
    const headers: Record<string, string> = { accept };
    if (conditional && cache.etag) headers['if-none-match'] = cache.etag;
    if (conditional && cache.lastModified) headers['if-modified-since'] = cache.lastModified;
    const response = await politeFetch(url, headers, {
      ...options,
      timeoutMs: Math.min(options.timeoutMs ?? 8000, Math.max(250, (options.maxTargetMs ?? 30_000) - (Date.now() - startedAt))),
    });
    if (response.ok)
      entry.cache[url] = {
        ...cache,
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
      };
    return response;
  };
  let links: PageLinks = { icons: [], manifests: [], images: [] };
  try {
    const home = await get(target.url, 'text/html,application/xhtml+xml');
    if (home.status === 304) links = entry.cache[target.url]?.links ?? links;
    else if (home.ok && /(?:text\/html|application\/xhtml\+xml)/i.test(home.headers.get('content-type') ?? '')) {
      links = declaredIcons(await home.text(), home.url || target.url);
      entry.cache[target.url].links = links;
    }
  } catch (error) {
    entry.reason = (error as Error).message.slice(0, 180);
  }
  const manifests: string[] = [];
  for (const url of links.manifests) {
    try {
      const response = await get(url, 'application/manifest+json,application/json');
      if (response.status === 304) manifests.push(...(entry.cache[url]?.icons ?? []));
      else if (response.ok && /(?:application\/[^;]*json)/i.test(response.headers.get('content-type') ?? '')) {
        const manifest = (await response.json()) as { icons?: Array<{ src?: string; sizes?: string }> };
        const urls = (Array.isArray(manifest.icons) ? manifest.icons : [])
          .slice(0, 30)
          .sort(
            (a, b) => Math.abs(Number(a.sizes?.match(/\d+/)?.[0] ?? 192) - 192) - Math.abs(Number(b.sizes?.match(/\d+/)?.[0] ?? 192) - 192),
          )
          .flatMap((icon) => absolute(icon.src, response.url || url) ?? []);
        entry.cache[url].icons = unique(urls);
        manifests.push(...urls);
      }
    } catch {
      /* Continue with declared site icons and safe root fallback. */
    }
  }
  const rootFallback = new URL('/favicon.ico', target.url).href;
  const candidates = unique([...links.icons, ...manifests, ...links.images, rootFallback]).filter(
    (url) => !isPlatformGenericIcon(target.url as string, url),
  );
  entry.sources = candidates;
  for (const source of candidates) {
    try {
      const response = await get(source, 'image/*', exists && previous?.source === source && previous.targetUrl === target.url);
      if (response.status === 304 && exists && previous?.source === source && previous.targetUrl === target.url) {
        state.local[target.slug] = { ...previous, fetchedAt: now.toISOString() };
        entry.icon = source;
        entry.verified = true;
        return finish('success');
      }
      if (!response.ok || !/^image\//i.test(response.headers.get('content-type') ?? '')) continue;
      if (response.url && isPlatformGenericIcon(target.url, response.url)) continue;
      const icon = await toPng(Buffer.from(await response.arrayBuffer()));
      if (!icon) continue;
      await atomicWrite(output, icon.png);
      state.local[target.slug] = {
        source,
        fetchedAt: now.toISOString(),
        revision: createHash('sha256').update(icon.png).digest('hex').slice(0, 16),
        sourceWidth: icon.sourceWidth,
        sourceHeight: icon.sourceHeight,
        transparent: icon.transparent,
        targetUrl: target.url,
        kind: target.kind,
      };
      entry.icon = source;
      entry.verified = true;
      return finish('success');
    } catch (error) {
      entry.reason = (error as Error).message.slice(0, 180);
    }
  }
  return finish(
    candidates.length ? 'failure' : 'default',
    entry.reason ?? (candidates.length ? 'no-decodable-site-icon' : 'shared-platform-default-rejected'),
  );
}
