import assert from 'node:assert/strict';
import test from 'node:test';
import { workerRuntimeContract } from './worker-runtime-contract.mjs';

const release = '/private/releases/test-sha';
const input = {
  release,
  workingDirectory: release,
  nodePath: `${release}/web/.next/standalone/web/node_modules`,
  resolvedDependencies: [{ name: 'sharp', realPath: `${release}/web/.next/standalone/web/node_modules/sharp/lib/index.js` }],
};
test('same-release path checks do not assert native compatibility or start the entrypoint', () => {
  assert.equal(workerRuntimeContract(input).status, 'path-contract-valid');
  assert.equal(workerRuntimeContract(input).nativeCompatibility, 'not-tested');
  assert.equal(workerRuntimeContract(input).entrypointExecuted, false);
});
test('rejects old releases, global fallbacks, symlink targets outside the release, and sibling prefix lookalikes', () => {
  for (const patch of [
    { release: '/', workingDirectory: '/', nodePath: '/web/.next/standalone/web/node_modules' },
    { workingDirectory: '/private/releases/old' },
    { nodePath: `${input.nodePath}:/global/node_modules` },
    { resolvedDependencies: [{ name: 'sharp', realPath: '/private/releases/old/node_modules/sharp/index.js' }] },
    { resolvedDependencies: [{ name: 'sharp', realPath: '/private/releases/test-sha-other/node_modules/sharp/index.js' }] },
  ])
    assert.throws(() => workerRuntimeContract({ ...input, ...patch }));
});
test('missing or duplicated sharp records and relative paths fail closed', () => {
  for (const patch of [
    { resolvedDependencies: [] },
    { resolvedDependencies: [{ name: 'other', realPath: `${release}/node_modules/other.js` }] },
    { resolvedDependencies: [...input.resolvedDependencies, ...input.resolvedDependencies] },
    { resolvedDependencies: [{ name: 'sharp', realPath: 'relative/sharp.js' }] },
  ])
    assert.throws(() => workerRuntimeContract({ ...input, ...patch }));
});
