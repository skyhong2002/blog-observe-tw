import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSlot, type SlotRelease } from './slot.ts';
import { parseState, stateRoot, type EdgeState, type Slot } from './state.ts';

/** Pin one validated active release for this run, never accept a caller-supplied command. */
export async function activeFaviconJob(
  state: () => Promise<EdgeState> = async () => parseState(await readFile(join(stateRoot(), 'active.json'), 'utf8')),
  descriptor: (slot: Slot) => Promise<SlotRelease> = readSlot,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await state();
    const release = await descriptor(before.active);
    const after = await state();
    if (JSON.stringify(before) !== JSON.stringify(after)) continue;
    if (release.slot !== before.active || release.commit !== before.commit) throw Error('active_release_mismatch');
    return {
      slot: before.active,
      commit: release.commit,
      generation: before.generation,
      cwd: release.release,
      args: ['tools/fetch-favicons.ts', '--monthly', '--include-candidates'],
    };
  }
  throw Error('active_release_unstable');
}
