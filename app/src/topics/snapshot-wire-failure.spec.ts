import type { Pool } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { runSnapshotImportIntegration } from './snapshot.integration.ts';
import { type ExportManifest, type SnapshotSource, SOURCE } from './snapshot-client.ts';
import { importSnapshot, snapshotWireFailureCode } from './snapshot-import.ts';

const now = new Date('2026-10-13T00:00:00.000Z');
const manifest: ExportManifest = {
  schemaVersion: 1,
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  previousId: null,
  generatedAt: now.toISOString(),
  source: SOURCE,
  attribution: 'fixture',
  coverage: 'all-current-indexed-article-tags',
  provenance: 'fixture',
  identity: 'sha256-exact-utf8-label',
  total: 1,
  pageSize: 500,
  pages: ['a'.repeat(64)],
  sha256: 'b'.repeat(64),
  changeCount: 0,
  changePages: [],
};
describe('immutable vocabulary wire failures', () => {
  it.each([
    { host: '127.0.0.1', port: 18169, database: 'persistent_clone' },
    { host: 'db.example', port: 18169, database: `blog_observe_integration_${'a'.repeat(24)}` },
    { host: '127.0.0.1', port: 3306, database: `blog_observe_integration_${'a'.repeat(24)}` },
  ])('rejects a non-disposable fixture target before any SQL: %j', async (connectionConfig) => {
    const query = vi.fn(),
      execute = vi.fn();
    const pool = { pool: { config: { connectionConfig } }, query, execute } as unknown as Pool;
    await expect(runSnapshotImportIntegration(pool)).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    ['Vocabulary export exceeds byte cap', 'wire-byte-cap'],
    ['Vocabulary export invalid JSON', 'wire-invalid-json'],
  ])('fails a staged page on %s without a retry or current-pointer update', async (message, reason) => {
    const row = {
      snapshot_id: manifest.id,
      manifest: JSON.stringify(manifest),
      status: 'scanning',
      next_page: 0,
      staged_terms: 0,
      staged_bytes: 0,
      last_label: null,
    };
    const query = vi.fn(async () => [[row]]),
      execute = vi.fn(async (_sql: string, _values?: unknown[]) => []);
    const getConnection = vi.fn(async () => ({
      query,
      execute,
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
    }));
    const pool = { query, execute, getConnection } as unknown as Pool;
    const current = vi.fn(),
      page = vi.fn(async () => {
        throw Error(message);
      });
    const source = { current, page } as unknown as SnapshotSource;
    const result = await importSnapshot(pool, source, now, async () => {}, 1);
    expect(result).toEqual({ status: 'failed', version: manifest.id, reason, becameCurrent: false });
    expect(current).not.toHaveBeenCalled();
    expect(page).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][1]).toEqual(['failed', null, reason, now, manifest.id]);
    expect(execute.mock.calls[1][0]).toContain("status='failed'");
    expect(JSON.stringify(execute.mock.calls)).not.toContain('topic_current');
  });
  it.each(['Vocabulary export HTTP 503', 'upstream disconnected', 'Vocabulary export invalid JSON TOKEN=private'])(
    'retains bounded retry for other errors: %s',
    async (message) => {
      expect(snapshotWireFailureCode(Error(message))).toBeNull();
      const query = vi.fn(async () => [[]]),
        execute = vi.fn();
      const pool = { query, execute } as unknown as Pool;
      const current = vi.fn(async () => {
        throw Error(message);
      });
      const result = await importSnapshot(pool, { current } as unknown as SnapshotSource, now, async () => {});
      expect(result).toEqual({
        status: 'deferred',
        version: null,
        reason: 'upstream-unavailable',
        nextAttemptAt: new Date(now.getTime() + 300000),
        becameCurrent: false,
      });
      expect(execute).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(message);
    },
  );
  it('fails an invalid manifest payload before creating a staging run', async () => {
    const query = vi.fn(async () => [[]]),
      execute = vi.fn();
    const result = await importSnapshot(
      { query, execute } as unknown as Pool,
      {
        current: async () => {
          throw Error('Vocabulary export invalid JSON');
        },
      } as unknown as SnapshotSource,
      now,
      async () => {},
    );
    expect(result).toEqual({ status: 'failed', version: null, reason: 'wire-invalid-json', becameCurrent: false });
    expect(execute).not.toHaveBeenCalled();
    expect(snapshotWireFailureCode(null)).toBeNull();
  });
});
