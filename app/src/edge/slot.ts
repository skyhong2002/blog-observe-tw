import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Slot, slotOf, stateRoot } from './state.ts';

export const releasesRoot = () => join(homedir(), '.local/share/blog-observe/releases');
export type SlotRelease = { slot: Slot; commit: string; release: string };
export async function validateRelease(value: unknown, slot: Slot): Promise<SlotRelease> {
  const item = value as SlotRelease;
  if (!item || item.slot !== slot || !/^[0-9a-f]{40}$/.test(item.commit) || typeof item.release !== 'string')
    throw Error('invalid_release');
  const root = await realpath(releasesRoot());
  const expected = join(root, item.commit);
  if (item.release !== expected || (await realpath(item.release)) !== expected) throw Error('immutable_release_directory_required');
  return { slot, commit: item.commit, release: expected };
}
export async function readSlot(slot: Slot): Promise<SlotRelease> {
  return validateRelease(JSON.parse(await readFile(join(stateRoot(), 'slots', `${slotOf(slot)}.json`), 'utf8')), slot);
}
