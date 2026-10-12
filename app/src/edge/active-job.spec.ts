import { describe, expect, it, vi } from 'vitest';
import { activeFaviconJob } from './active-job.ts';
import type { EdgeState } from './state.ts';

const blue: EdgeState = { active: 'blue', commit: 'a'.repeat(40), generation: 2 };
const green: EdgeState = { active: 'green', commit: 'b'.repeat(40), generation: 3 };
const descriptor = vi.fn(async (slot: 'blue' | 'green') => ({
  slot,
  commit: slot === 'blue' ? blue.commit : green.commit,
  release: `/releases/${slot}`,
}));
describe('scheduled favicon job follows the active slot', () => {
  it.each([blue, green])('pins $active and the fixed favicon command', async (state) => {
    const plan = await activeFaviconJob(async () => state, descriptor);
    expect(plan).toMatchObject({ slot: state.active, commit: state.commit, cwd: `/releases/${state.active}` });
    expect(plan.args).toEqual(['tools/fetch-favicons.ts', '--monthly', '--include-candidates']);
  });
  it('retries a switch between state and descriptor reads', async () => {
    const state = vi.fn().mockResolvedValueOnce(blue).mockResolvedValue(green);
    expect((await activeFaviconJob(state, descriptor)).slot).toBe('green');
    expect(state).toHaveBeenCalledTimes(4);
  });
  it('fails closed on a descriptor commit mismatch', async () => {
    await expect(
      activeFaviconJob(
        async () => blue,
        async () => ({ slot: 'blue', commit: green.commit, release: '/old' }),
      ),
    ).rejects.toThrow('active_release_mismatch');
  });
  it('does not fall back to an old release if state is unreadable or unstable', async () => {
    await expect(
      activeFaviconJob(async () => {
        throw Error('missing');
      }, descriptor),
    ).rejects.toThrow('missing');
    let calls = 0;
    await expect(activeFaviconJob(async () => (++calls % 2 ? blue : green), descriptor)).rejects.toThrow('active_release_unstable');
    expect(calls).toBe(6);
  });
});
