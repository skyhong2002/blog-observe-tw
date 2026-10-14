import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { runDisplayGateIntegration } from '../topics/display-gate.integration.ts';
import { runRelationVisibilityIntegration } from './visibility.integration.ts';

describe('home display SQL suites reject any non-disposable target before SQL', () => {
  for (const config of [
    { host: '127.0.0.1', port: 3306, database: 'blog_observe' },
    { host: '127.0.0.1', port: 18169, database: 'blog_observe' },
    { host: 'remote.example', port: 18169, database: 'blog_observe_integration_aaaaaaaaaaaaaaaaaaaaaaaa' },
    { host: '127.0.0.1', port: 18169, database: 'blog_observe_integration_not-random' },
  ]) {
    for (const run of [runDisplayGateIntegration, runRelationVisibilityIntegration]) {
      it(`${run.name} refuses ${config.host}:${config.port}/${config.database}`, async () => {
        const query = vi.fn(),
          execute = vi.fn(),
          getConnection = vi.fn();
        const pool = { pool: { config: { connectionConfig: config } }, query, execute, getConnection } as unknown as Pool;
        await expect(run(pool)).rejects.toThrow();
        expect(query).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
        expect(getConnection).not.toHaveBeenCalled();
      });
    }
  }
});
