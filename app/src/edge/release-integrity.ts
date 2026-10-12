import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** Verify git-archive bytes without adding .git or running production in a checkout. */
export async function verifyArchive(release: string, tree: string): Promise<number> {
  const root = await realpath(release);
  let count = 0;
  for (const entry of tree.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/s.exec(entry);
    if (!match) throw Error('archive_regular_tracked_files_required');
    const [, , expected, name] = match;
    if (name.startsWith('/') || name.split('/').some((part) => part === '..' || part === '.')) throw Error('invalid_archive_path');
    const path = join(root, name);
    const actual = await realpath(path);
    const rel = relative(root, actual);
    if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith(sep)) throw Error('archive_path_escape');
    const info = await lstat(path);
    if (!info.isFile()) throw Error('archive_regular_tracked_files_required');
    const hash = createHash('sha1').update(`blob ${info.size}\0`);
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw Error('archive_bytes_do_not_match_commit');
    count++;
  }
  if (count === 0) throw Error('archive_tree_empty');
  return count;
}
