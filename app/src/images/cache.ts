import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { type FileHandle, link, lstat, mkdir, open, readdir, rename, statfs, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { MAX_IMAGE_BYTES, validWebp } from './encode.ts';
import { imageWriterLock } from './lock.ts';
export const MAX_CACHE_BYTES = 256 * 1024 * 1024;
export const MIN_FREE_BYTES = 10 * 1024 * 1024 * 1024;
export const defaultCacheRoot = () => process.env.BLOG_IMAGE_CACHE_ROOT || join(homedir(), '.cache/blog-observe/images-v1');
export async function boundedFile(path: string, maxBytes: number): Promise<Buffer | null> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const bytes = Buffer.alloc(stat.size + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytesRead === stat.size ? bytes.subarray(0, bytesRead) : null;
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}
export class ImageCache {
  root: string;
  freeBytes: () => Promise<number>;
  constructor(root = defaultCacheRoot(), freeBytes?: () => Promise<number>) {
    this.root = root;
    this.freeBytes =
      freeBytes ??
      (async () => {
        const s = await statfs(root);
        return s.bavail * s.bsize;
      });
  }
  path(key: string, width: number) {
    if (!/^[a-f0-9]{64}$/.test(key) || !Number.isInteger(width)) throw Error('image_key');
    return join(this.root, `${key}-${width}.webp`);
  }
  async read(key: string, width: number) {
    const bytes = await boundedFile(this.path(key, width), MAX_IMAGE_BYTES);
    return bytes && validWebp(bytes) ? bytes : null;
  }
  async usage(): Promise<number> {
    const path = join(this.root, '.usage.json');
    // A ledger interrupted before publication requires inspection; never delete it automatically.
    if (
      await lstat(join(this.root, '.usage.pending')).then(
        () => true,
        () => false,
      )
    )
      throw Error('image_cache_pending');
    const existing = await boundedFile(path, 1024);
    if (existing) {
      const parsed = JSON.parse(existing.toString('utf8'));
      if (parsed.version !== 1 || !Number.isSafeInteger(parsed.bytes) || parsed.bytes < 0) throw Error('image_cache_usage');
      return parsed.bytes;
    }
    if (
      await lstat(path).then(
        () => true,
        () => false,
      )
    )
      throw Error('image_cache_usage');
    const entries = await readdir(this.root, { withFileTypes: true });
    if (entries.length > 65536) throw Error('image_cache_entries');
    let total = 8192; // Retain conservative space for fixed ledger/lock metadata.
    for (const entry of entries) {
      if (entry.name === '.writer.lock') continue;
      if (!entry.isFile()) throw Error('image_cache_entry');
      const file = await open(join(this.root, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        total += (await file.stat()).size;
      } finally {
        await file.close();
      }
    }
    await this.recordUsage(total);
    return total;
  }
  async recordUsage(bytes: number) {
    const pending = join(this.root, '.usage.pending');
    const handle = await open(pending, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: 1, bytes }));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(pending, join(this.root, '.usage.json'));
    const directory = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async writer(): Promise<null | { remaining: number; close: () => Promise<void> }> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await this.freeBytes()) < MIN_FREE_BYTES) return null;
    const lockPath = join(this.root, '.writer.lock');
    // Keep the same inode forever; flock releases automatically if its holder dies.
    const lockFile = await open(lockPath, constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await lockFile.close();
    const close = await imageWriterLock(lockPath);
    if (!close) return null;
    try {
      const total = await this.usage();
      if (total >= MAX_CACHE_BYTES) {
        await close();
        return null;
      }
      return { remaining: MAX_CACHE_BYTES - total, close };
    } catch (error) {
      await close();
      throw error;
    }
  }
  async write(key: string, output: Map<number, Buffer>, remaining: number): Promise<boolean> {
    const total = [...output.values()].reduce((n, b) => n + b.length, 0);
    if (total > remaining || (await this.freeBytes()) < MIN_FREE_BYTES) return false;
    // Reserve durably before writing: a crash leaks budget, never exceeds it.
    const used = await this.usage();
    if (used + total > MAX_CACHE_BYTES) return false;
    await this.recordUsage(used + total);
    for (const [width, bytes] of output) {
      // Exclusive creation: never overwrite or delete an existing cache file.
      const temp = join(this.root, `.pending-${randomUUID()}`);
      const file = await open(temp, 'wx', 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
        await file.close();
        await link(temp, this.path(key, width)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
        });
      } finally {
        await file.close().catch(() => {});
        await unlink(temp);
      }
    }
    return true;
  }
}
