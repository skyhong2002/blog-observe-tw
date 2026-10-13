import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BUILD_RECEIPT, recordPrebuilt, verifyPrebuilt } from './prebuilt-release.ts';

const sha = 'a'.repeat(40);
async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'prebuilt-test-'));
  try {
    for (const side of ['web/.next', 'web/.next/standalone/web/.next']) {
      await mkdir(join(root, side, 'server/app/api'), { recursive: true });
      await writeFile(join(root, side, 'BUILD_ID'), 'fixture-build\n');
      await writeFile(join(root, side, 'routes-manifest.json'), '{}');
      await writeFile(join(root, side, 'server/app/api.html'), 'fixture html');
      await writeFile(join(root, side, 'server/app/api/status.html'), 'fixture status');
    }
    await mkdir(join(root, 'web/.next/static'), { recursive: true });
    await writeFile(join(root, 'web/.next/static/chunk.js'), 'fixture chunk');
    await mkdir(join(root, 'web/.next/standalone/web/.next/static'), { recursive: true });
    await writeFile(join(root, 'web/.next/standalone/web/.next/static/chunk.js'), 'fixture chunk');
    await mkdir(join(root, 'web/.next/standalone/web/public'), { recursive: true });
    await writeFile(join(root, 'web/.next/standalone/web/public/icon.svg'), 'fixture icon');
    await writeFile(join(root, 'web/.next/standalone/web/server.js'), 'fixture server');
    for (const tree of ['node_modules', 'web/.next/standalone/node_modules']) {
      await mkdir(join(root, tree, 'fixture-package'), { recursive: true });
      await writeFile(join(root, tree, 'fixture-package/index.js'), 'fixture dependency');
    }
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test('records actual paired bytes outside .next and verifies without modifying artifacts', async () =>
  fixture(async (root) => {
    const before = await readFile(join(root, 'web/.next/BUILD_ID'));
    const receipt = await recordPrebuilt(root, sha);
    assert.equal(receipt.sourceSHA, sha);
    assert.equal(receipt.buildId, 'fixture-build');
    assert.ok(Number.isFinite(Date.parse(receipt.observedAt)));
    assert.equal((await verifyPrebuilt(root, sha)).observedAt, receipt.observedAt);
    assert.deepEqual(await readFile(join(root, 'web/.next/BUILD_ID')), before);
    await assert.rejects(recordPrebuilt(root, sha), { code: 'EEXIST' });
  }));
test('rejects wrong source, pair mismatch and missing artifacts', async () =>
  fixture(async (root) => {
    await recordPrebuilt(root, sha);
    await assert.rejects(verifyPrebuilt(root, 'b'.repeat(40)), /invalid_receipt/);
    await writeFile(join(root, 'web/.next/standalone/web/.next/BUILD_ID'), 'other');
    await assert.rejects(verifyPrebuilt(root, sha), /pair_mismatch/);
    await rm(join(root, 'web/.next/server/app/api.html'));
    await assert.rejects(verifyPrebuilt(root, sha));
  }));
test('detects changed primary static and standalone server after review', async () =>
  fixture(async (root) => {
    await recordPrebuilt(root, sha);
    await writeFile(join(root, 'web/.next/static/chunk.js'), 'changed');
    await assert.rejects(verifyPrebuilt(root, sha), /pair_mismatch/);
    await writeFile(join(root, 'web/.next/static/chunk.js'), 'fixture chunk');
    await writeFile(join(root, 'web/.next/standalone/web/server.js'), 'changed');
    await assert.rejects(verifyPrebuilt(root, sha), /receipt_mismatch/);
  }));
test('rejects symlink artifacts and forged hashes', async () =>
  fixture(async (root) => {
    await recordPrebuilt(root, sha);
    const receipt = JSON.parse(await readFile(join(root, BUILD_RECEIPT), 'utf8'));
    receipt.artifacts = {};
    await writeFile(join(root, BUILD_RECEIPT), JSON.stringify(receipt));
    await assert.rejects(verifyPrebuilt(root, sha), /receipt_mismatch/);
    await rm(join(root, 'web/.next/static/chunk.js'));
    await symlink('/dev/null', join(root, 'web/.next/static/chunk.js'));
    await assert.rejects(verifyPrebuilt(root, sha), /regular_artifact/);
  }));

test('rejects served standalone static mismatch and public changes after review', async () =>
  fixture(async (root) => {
    await recordPrebuilt(root, sha);
    await writeFile(join(root, 'web/.next/standalone/web/.next/static/chunk.js'), 'changed served chunk');
    await assert.rejects(verifyPrebuilt(root, sha), /pair_mismatch/);
    await writeFile(join(root, 'web/.next/standalone/web/.next/static/chunk.js'), 'fixture chunk');
    await writeFile(join(root, 'web/.next/standalone/web/public/icon.svg'), 'changed served icon');
    await assert.rejects(verifyPrebuilt(root, sha), /receipt_mismatch/);
  }));

test('detects traced and gateway dependency tampering and runtime manifest changes', async () =>
  fixture(async (root) => {
    await recordPrebuilt(root, sha);
    for (const path of ['node_modules/fixture-package/index.js', 'web/.next/standalone/node_modules/fixture-package/index.js']) {
      await writeFile(join(root, path), 'changed dependency');
      await assert.rejects(verifyPrebuilt(root, sha), /receipt_mismatch/);
      await writeFile(join(root, path), 'fixture dependency');
    }
    await writeFile(join(root, 'web/.next/standalone/web/.next/prerender-manifest.json'), 'changed runtime manifest');
    await assert.rejects(verifyPrebuilt(root, sha), /receipt_mismatch/);
  }));
test('hashes internal .bin links but rejects external dependency links and external tree roots', async () =>
  fixture(async (root) => {
    await mkdir(join(root, 'node_modules/.bin'), { recursive: true });
    await symlink('../fixture-package/index.js', join(root, 'node_modules/.bin/fixture'));
    await recordPrebuilt(root, sha);
    await verifyPrebuilt(root, sha);
    await rm(join(root, 'node_modules/.bin/fixture'));
    await symlink('/dev/null', join(root, 'node_modules/.bin/fixture'));
    await assert.rejects(verifyPrebuilt(root, sha), /dependency_link_escape/);
    await rm(join(root, 'node_modules'), { recursive: true });
    await symlink('/tmp', join(root, 'node_modules'));
    await assert.rejects(verifyPrebuilt(root, sha), /regular_artifact/);
  }));
