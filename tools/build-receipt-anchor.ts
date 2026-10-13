import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILD_RECEIPT } from './prebuilt-release.ts';

export async function receiptDigest(release: string) {
  const path = join(release, BUILD_RECEIPT);
  const info = await lstat(path);
  if (!info.isFile() || info.size > 16384 || (await realpath(path)) !== path) throw Error('receipt_anchor_invalid');
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}
export async function anchorReceipt(stateRoot: string, release: string, sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('receipt_anchor_invalid');
  const digest = await receiptDigest(release);
  await mkdir(join(stateRoot, 'build-receipts'), { recursive: true, mode: 0o700 });
  await writeFile(join(stateRoot, 'build-receipts', `${sha}.json`), JSON.stringify({ sha, digest }) + '\n', { flag: 'wx', mode: 0o600 });
  return digest;
}
export async function verifyReceiptAnchor(stateRoot: string, release: string, sha: string) {
  if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('receipt_anchor_invalid');
  const path = join(stateRoot, 'build-receipts', `${sha}.json`);
  const info = await lstat(path);
  if (!info.isFile() || info.size > 1024 || (await realpath(path)) !== path) throw Error('receipt_anchor_invalid');
  const saved = JSON.parse(await readFile(path, 'utf8'));
  if (saved.sha !== sha || saved.digest !== (await receiptDigest(release))) throw Error('receipt_anchor_mismatch');
  return saved.digest as string;
}
