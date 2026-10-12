import type { Pool } from 'mysql2/promise';
import { beforeEach, expect, it, vi } from 'vitest';

const budget = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => true));
vi.mock('../jobs/budget.ts', () => ({ reserveBudget: budget, reserveBudgetOnConnection: vi.fn() }));

import { budgetedCandidateFetcher } from '../crawl/candidate-review.ts';

beforeEach(() => budget.mockReset().mockResolvedValue(true));
it('charges every actual robots/redirect request and forwards pinned dispatcher unchanged', async () => {
  const original = vi.fn(async () => new Response('ok'));
  const assert = vi.fn(async () => {}),
    stop = vi.fn();
  const fetcher = budgetedCandidateFetcher({} as Pool, { fetcher: original }, assert, Date.now() + 60000, stop);
  const init = { headers: { accept: 'text/plain' } };
  await fetcher('https://writer.test/robots.txt', init);
  await fetcher('https://writer.test/redirected', init);
  expect(original).toHaveBeenCalledWith('https://writer.test/redirected', init);
  expect(budget).toHaveBeenCalledTimes(2);
  expect(budget.mock.calls[0][1]).toMatchObject([{ scope: 'candidates:http', limit: 300 }, { limit: 20 }]);
  budget.mockResolvedValue(false);
  await expect(fetcher('https://writer.test/more', init)).rejects.toThrow('candidate_http_budget');
  expect(stop).toHaveBeenCalledOnce();
  expect(original).toHaveBeenCalledTimes(2);
});
it('deadline prevents even budget writes or outbound requests', async () => {
  const original = vi.fn(),
    stop = vi.fn();
  const fetcher = budgetedCandidateFetcher({} as Pool, { fetcher: original }, async () => {}, Date.now() - 1, stop);
  await expect(fetcher('https://writer.test/')).rejects.toThrow('candidate_batch_stopped');
  expect(budget).not.toHaveBeenCalled();
  expect(original).not.toHaveBeenCalled();
});
it('rechecks lease/permission after reserving and before I/O', async () => {
  let checks = 0;
  const original = vi.fn();
  const assert = async () => {
    if (++checks === 2) throw Error('admin_access_revoked');
  };
  const fetcher = budgetedCandidateFetcher({} as Pool, { fetcher: original }, assert, Date.now() + 60000, () => {});
  await expect(fetcher('https://writer.test/')).rejects.toThrow('revoked');
  expect(budget).toHaveBeenCalledOnce();
  expect(original).not.toHaveBeenCalled();
});
