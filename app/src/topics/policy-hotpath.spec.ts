import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { ensureTopicPolicy } from './policy-store.ts';

describe('full vocabulary policy is never rebuilt on the worker hot path', () => {
  it('requires explicit staged preparation when a full pool lacks matching policy', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ manifest: JSON.stringify({ coverage: 'all-current-indexed-article-tags' }) }]]);
    const getConnection = vi.fn();
    await expect(ensureTopicPolicy({ query, getConnection } as unknown as Pool, 'snapshot')).rejects.toThrow(
      'full_vocabulary_policy_requires_staged_preparation',
    );
    expect(getConnection).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('ready policy returns without touching source terms or manifest', async () => {
    const query = vi.fn().mockResolvedValueOnce([[{ snapshot_id: 'ready' }]]),
      getConnection = vi.fn();
    await ensureTopicPolicy({ query, getConnection } as unknown as Pool, 'ready');
    expect(query).toHaveBeenCalledTimes(1);
    expect(getConnection).not.toHaveBeenCalled();
  });
});
