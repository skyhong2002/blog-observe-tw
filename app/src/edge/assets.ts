import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { constants, copyFile, mkdir, readdir, realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, relative, sep } from 'node:path';

const types: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};
function within(root: string, path: string) {
  const r = relative(root, path);
  return r !== '..' && !r.startsWith(`..${sep}`) && !r.startsWith(sep);
}
async function digest(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
/** Append-only union of Next hashed assets. A name collision may never overwrite bytes. */
export async function archiveAssets(source: string, destination: string): Promise<number> {
  const sourceRoot = await realpath(source);
  await mkdir(destination, { recursive: true, mode: 0o700 });
  const targetRoot = await realpath(destination);
  let count = 0;
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('static_symlinks_forbidden');
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!entry.isFile()) throw Error('static_regular_files_required');
      const target = join(targetRoot, relative(sourceRoot, path));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      if (!within(targetRoot, await realpath(dirname(target)))) throw Error('static_escape');
      try {
        await copyFile(path, target, constants.COPYFILE_EXCL);
        count++;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!within(targetRoot, await realpath(target)) || (await digest(path)) !== (await digest(target)))
          throw Error('static_name_collision');
      }
    }
  }
  await walk(sourceRoot);
  return count;
}
/** Only archived /_next/static files; no API/auth fallback and no directory listing. */
export async function serveAsset(root: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (!['GET', 'HEAD'].includes(req.method ?? '') || !req.url?.startsWith('/_next/static/')) return false;
  let path: string;
  try {
    const suffix = decodeURIComponent(req.url.split('?')[0].slice('/_next/static/'.length));
    if (
      !suffix ||
      suffix.includes('\\') ||
      suffix.includes('\0') ||
      suffix.split('/').some((part) => !part || part === '.' || part === '..')
    )
      return false;
    const directory = await realpath(root);
    path = await realpath(join(directory, suffix));
    if (!within(directory, path)) return false;
    const info = await stat(path);
    if (!info.isFile()) return false;
    res.writeHead(200, {
      'content-type': types[extname(path)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
  } catch {
    return false;
  }
  if (req.method === 'HEAD') res.end();
  else {
    const stream = createReadStream(path);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
  return true;
}
