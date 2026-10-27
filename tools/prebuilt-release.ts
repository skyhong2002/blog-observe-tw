import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { join, relative as relativePath, sep } from 'node:path';

export const BUILD_RECEIPT = '.blog-build-receipt.json';
const critical = ['BUILD_ID', 'routes-manifest.json', 'server/app/api.html', 'server/app/api/status.html'];
const trees = ['server', 'static'];
type Hashes = Record<string, string>;
export type BuildReceipt = {
  version: 1;
  sourceSHA: string;
  buildId: string;
  observedAt: string;
  artifacts: Hashes;
};
async function fileHash(path: string) {
  const info = await lstat(path);
  if ((await realpath(path)) !== path || !info.isFile()) throw Error('prebuilt_regular_artifact_required');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
async function treeHash(path: string, internalLinks = false, runtimeCache?: string) {
  const hash = createHash('sha256');
  let count = 0;
  let files = 0;
  async function walk(directory: string, prefix = '') {
    if ((await realpath(directory)) !== directory || !(await lstat(directory)).isDirectory())
      throw Error('prebuilt_regular_artifact_required');
    for (const name of (await readdir(directory)).sort()) {
      if (++count > 50000) throw Error('prebuilt_artifact_limit');
      const relative = `${prefix}${name}`;
      const full = join(directory, name);
      const info = await lstat(full);
      // Next 16 writes derived route responses after startup. Keep compiled server/app,
      // manifests, dependencies and assets covered, but not this operator-owned runtime cache.
      if (relative === runtimeCache) {
        if (!info.isDirectory() || (await realpath(full)) !== full) throw Error('prebuilt_runtime_cache_directory_required');
        continue;
      }
      if (info.isDirectory()) await walk(full, `${relative}/`);
      else {
        files++;
        if (info.isSymbolicLink() && internalLinks) {
          const target = await realpath(full);
          const inside = relativePath(path, target);
          if (inside === '..' || inside.startsWith(`..${sep}`) || inside.startsWith(sep)) throw Error('prebuilt_dependency_link_escape');
          hash.update(`${JSON.stringify([relative, 'link', await readlink(full)])}\n`);
        } else hash.update(`${JSON.stringify([relative, 'file', await fileHash(full)])}\n`);
      }
    }
  }
  await walk(path);
  if (!files) throw Error('prebuilt_artifact_empty');
  return hash.digest('hex');
}
/** Observe existing bytes only. This receipt is not proof of who executed a build. */
export async function observePrebuilt(release: string, sourceSHA: string): Promise<BuildReceipt> {
  if (!/^[0-9a-f]{40}$/.test(sourceSHA)) throw Error('prebuilt_invalid_source');
  const primary = join(release, 'web/.next');
  const packaged = join(primary, 'standalone/web/.next');
  const artifacts: Hashes = {};
  for (const name of critical) {
    artifacts[`primary/${name}`] = await fileHash(join(primary, name));
    artifacts[`standalone/${name}`] = await fileHash(join(packaged, name));
    if (artifacts[`primary/${name}`] !== artifacts[`standalone/${name}`]) throw Error('prebuilt_artifact_pair_mismatch');
  }
  const buildId = (await readFile(join(primary, 'BUILD_ID'), 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(buildId)) throw Error('prebuilt_invalid_build_id');
  for (const tree of trees) artifacts[`primary/${tree}:tree`] = await treeHash(join(primary, tree));
  artifacts['standalone/static:tree'] = await treeHash(join(packaged, 'static'));
  if (artifacts['primary/static:tree'] !== artifacts['standalone/static:tree']) throw Error('prebuilt_artifact_pair_mismatch');
  artifacts['standalone/public:tree'] = await treeHash(join(primary, 'standalone/web/public'));
  artifacts['standalone/server:tree'] = await treeHash(join(packaged, 'server'), false, 'route-cache');
  artifacts['standalone/server.js'] = await fileHash(join(primary, 'standalone/web/server.js'));
  // Include all runtime manifests and traced dependencies, but no primary build cache.
  artifacts['standalone:tree'] = await treeHash(join(primary, 'standalone'), true, 'web/.next/server/route-cache');
  artifacts['release/node_modules:tree'] = await treeHash(join(release, 'node_modules'), true);
  return { version: 1, sourceSHA, buildId, observedAt: new Date().toISOString(), artifacts };
}
export async function recordPrebuilt(release: string, sourceSHA: string) {
  const receipt = await observePrebuilt(release, sourceSHA);
  await writeFile(join(release, BUILD_RECEIPT), `${JSON.stringify(receipt)}\n`, { flag: 'wx', mode: 0o600 });
  return receipt;
}
export async function verifyPrebuilt(release: string, sourceSHA: string): Promise<BuildReceipt> {
  const path = join(release, BUILD_RECEIPT);
  const info = await lstat(path);
  if ((await realpath(path)) !== path || !info.isFile()) throw Error('prebuilt_regular_receipt_required');
  if (info.size > 16384) throw Error('prebuilt_invalid_receipt');
  const bytes = await readFile(path);
  if (bytes.length > 16384) throw Error('prebuilt_invalid_receipt');
  const saved = JSON.parse(bytes.toString('utf8')) as BuildReceipt;
  if (
    saved.version !== 1 ||
    saved.sourceSHA !== sourceSHA ||
    !Number.isFinite(Date.parse(saved.observedAt)) ||
    Date.parse(saved.observedAt) > Date.now()
  )
    throw Error('prebuilt_invalid_receipt');
  const actual = await observePrebuilt(release, sourceSHA);
  if (saved.buildId !== actual.buildId || JSON.stringify(saved.artifacts) !== JSON.stringify(actual.artifacts))
    throw Error('prebuilt_receipt_mismatch');
  return saved;
}
