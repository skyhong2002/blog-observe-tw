import { expect, it, vi } from 'vitest';
import { executeIntentWork } from './intent.ts';

it('successful work plus bookkeeping failure is uncertain, never retried or marked failed', async () => {
  const work = vi.fn(async () => ({ applied: true })),
    finish = vi.fn(async () => {
      throw Error('db down');
    });
  await expect(executeIntentWork(work, finish)).rejects.toThrow('intent_finalization_uncertain');
  expect(work).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledExactlyOnceWith({ applied: true }, 'done');
});
it('partial work errors preserve uncertainty; no automatic re-execution', async () => {
  const work = vi.fn(async () => {
      throw Error('network result ambiguous');
    }),
    finish = vi.fn(async () => {});
  await expect(executeIntentWork(work, finish)).rejects.toThrow('ambiguous');
  expect(work).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledExactlyOnceWith({ error: 'admin_action_uncertain' }, 'uncertain');
});
