import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { runRankingFreshnessIntegration } from './ranking-freshness.integration.ts';

describe('ranking fixture database boundary', () => {
  it.each([
    { host: '127.0.0.1', port: 18169, database: 'persistent_clone' },
    { host: 'db.example', port: 18169, database: `blog_observe_integration_${'a'.repeat(24)}` },
    { host: '127.0.0.1', port: 3306, database: `blog_observe_integration_${'a'.repeat(24)}` },
  ])('rejects non-disposable/non-loopback/wrong-port database before any reads or writes %j', async (connectionConfig) => {
    const query = vi.fn(),
      execute = vi.fn();
    const pool = { pool: { config: { connectionConfig } }, query, execute } as unknown as Pool;
    await expect(runRankingFreshnessIntegration(pool)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
