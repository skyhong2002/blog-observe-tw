import { spawnSync } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

/** Fail before generating build/export/backup artifacts on the shared host. */
export async function assertLargeWriteSpace() {
  const check = spawnSync('df', ['-h', '/home'], { stdio: 'inherit' });
  if (check.status !== 0) throw Error('disk_space_check_failed');
  const fs = await statfs('/home', { bigint: true });
  const available = fs.bavail * fs.bsize;
  const minimum = 10n * 1024n * 1024n * 1024n;
  if (available < minimum) throw Error(`disk_space_below_10GiB: ${available} bytes available; no large files written`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await assertLargeWriteSpace();
