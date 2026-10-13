import { isAbsolute, relative, resolve } from 'node:path';

/** Pure validation only: never import worker.ts, create a pool, or schedule jobs. */
export function workerRuntimeContract({ release, workingDirectory, nodePath, resolvedDependencies }) {
  if (![release, workingDirectory, nodePath].every((value) => typeof value === 'string' && isAbsolute(value)))
    throw Error('worker_runtime_absolute_paths_required');
  const root = resolve(release);
  if (root === '/') throw Error('worker_runtime_release_root_invalid');
  if (resolve(workingDirectory) !== root) throw Error('worker_runtime_wrong_release');
  const expected = resolve(root, 'web/.next/standalone/web/node_modules');
  // A colon-separated fallback path would let a missing package resolve in an older release.
  if (nodePath !== expected) throw Error('worker_runtime_node_path_mismatch');
  if (!Array.isArray(resolvedDependencies) || resolvedDependencies.length < 1 || resolvedDependencies.length > 64)
    throw Error('worker_runtime_dependencies_required');
  const packages = new Set();
  for (const item of resolvedDependencies) {
    if (!item || typeof item.name !== 'string' || !/^(?:@[a-z0-9_-]+\/)?[a-z0-9_.-]+$/.test(item.name))
      throw Error('worker_runtime_bad_dependency');
    if (packages.has(item.name)) throw Error('worker_runtime_duplicate_dependency');
    packages.add(item.name);
    // The caller must provide actual realpath results, not an unresolved symlink.
    if (typeof item.realPath !== 'string' || !isAbsolute(item.realPath)) throw Error('worker_runtime_realpath_required');
    const inside = relative(root, resolve(item.realPath));
    if (!inside || inside === '..' || inside.startsWith('../') || isAbsolute(inside)) throw Error('worker_runtime_external_dependency');
  }
  if (!packages.has('sharp')) throw Error('worker_runtime_sharp_required');
  return {
    status: 'path-contract-valid',
    release: root,
    nodePath: expected,
    checkedDependencies: resolvedDependencies.length,
    nativeCompatibility: 'not-tested',
    entrypointExecuted: false,
    interpretation: 'Path containment only; does not prove ELF/ABI/CPU compatibility or worker health.',
  };
}
