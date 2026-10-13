import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { anchorReceipt, verifyReceiptAnchor } from './build-receipt-anchor.ts';
import { BUILD_RECEIPT } from './prebuilt-release.ts';

test('external exclusive anchor rejects replacement receipt after candidate review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blog-anchor-'));
  try {
    const release = join(root, 'release'),
      state = join(root, 'state'),
      sha = 'a'.repeat(40);
    await mkdir(release);
    await writeFile(join(release, BUILD_RECEIPT), 'original');
    const digest = await anchorReceipt(state, release, sha);
    assert.equal(await verifyReceiptAnchor(state, release, sha), digest);
    await assert.rejects(anchorReceipt(state, release, sha), { code: 'EEXIST' });
    await writeFile(join(release, BUILD_RECEIPT), 'replacement');
    await assert.rejects(verifyReceiptAnchor(state, release, sha), /anchor_mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
