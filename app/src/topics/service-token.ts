import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Read only an owner-owned mode-600 regular file, from the same descriptor checked by fstat. Never expose a key or filesystem error. */
export async function readTagServiceToken(path = join(homedir(), '.config/observe-tag/blog-token')): Promise<string | null> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.() || stat.size < 32 || stat.size > 4096)
      return null;
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) return null;
    const token = buffer.subarray(0, bytesRead).toString('utf8').trim();
    return token.length >= 32 && token.length <= 4096 && /^[\x21-\x7e]+$/.test(token) ? token : null;
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => undefined);
  }
}
