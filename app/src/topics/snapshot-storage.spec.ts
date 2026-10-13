import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { describe, expect, it, vi } from 'vitest';
import { type ExportManifest, type ExportTerm, MAX_SNAPSHOT_PAGE_BYTES, SOURCE } from './snapshot-client.ts';
import { importSnapshot } from './snapshot-import.ts';
import { assertRunUnchanged, RECEIPT_BYTE_CAP, SnapshotModeMismatch, singleCopyReceipt, validateSingleCopy } from './snapshot-storage.ts';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const term = {
  id: sha('甲'),
  label: '甲',
  articleCount: 3,
  recentArticleCount: 2,
  noise: false,
  noEqual: false,
  firstPublishedAt: '2026-10-12T00:00:00.000Z',
  lastPublishedAt: '2026-10-12T00:00:00.000Z',
  origin: 'article-tags-mixed',
  journalistAssigned: null,
} as ExportTerm;
const entries = [term];
const manifest: ExportManifest = {
  schemaVersion: 1,
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  previousId: null,
  generatedAt: '2026-10-13T00:00:00.000Z',
  source: SOURCE,
  coverage: 'all-current-indexed-article-tags',
  identity: 'sha256-exact-utf8-label',
  attribution: 'fixture',
  provenance: 'fixture',
  total: 1,
  pageSize: 500,
  pages: [sha(JSON.stringify(entries) + '\n')],
  sha256: sha(JSON.stringify(term) + '\n'),
  changeCount: 0,
  changePages: [],
};
const makeRun = () =>
  ({
    snapshot_id: manifest.id,
    payload_mode: 'single-copy-v1',
    status: 'validating',
    manifest: JSON.stringify(manifest),
    manifest_raw: JSON.stringify(manifest),
    next_page: 1,
    staged_terms: 1,
    staged_bytes: singleCopyReceipt(entries).bytes,
    receipt_bytes: singleCopyReceipt(entries).receiptBytes,
    validation_next_page: 0,
    validated_terms: 0,
    validated_bytes: 0,
    checkpoint_raw: null,
    checksum_checkpoint: null,
    last_label: term.label,
    checkpoint_last_label: null,
  }) as unknown as RowDataPacket;
function fixture() {
  const run = makeRun(),
    metadata = singleCopyReceipt(entries);
  const query = vi.fn(async (sql: string): Promise<unknown[][]> => {
    if (sql.includes('SELECT id FROM topic_terms')) return [[]];
    if (sql.includes('page_lengths')) return [[{ n: 1, payload_bytes: Buffer.byteLength(JSON.stringify(term)) }]];
    if (sql.includes('SELECT id,label'))
      return [
        [{ id: term.id, label: term.label, payload_bytes: Buffer.byteLength(JSON.stringify(term)), raw_payload: JSON.stringify(term) }],
      ];
    if (sql.includes('COUNT(*) n,COALESCE')) return [[{ n: 1, bytes: metadata.receiptBytes }]];
    if (sql.includes('COUNT(*)')) return [[{ n: 1 }]];
    return [[{ entries_json: metadata.text, sha256: manifest.pages[0] }]];
  });
  const execute = vi.fn(async (_sql: string, _values: unknown[]) => []);
  const connection = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(async () => [[{ ...run }]]),
    execute,
  };
  const pool = { query, getConnection: vi.fn(async () => connection) } as unknown as Pool;
  return { run, pool, query, execute, connection };
}
describe('single-copy stored validation', () => {
  it('charges one exact term+LF and only bounded hashed receipt metadata', () => {
    const r = singleCopyReceipt(entries);
    expect(r.bytes).toBe(Buffer.byteLength(JSON.stringify(term) + '\n'));
    expect(r.text).not.toContain(term.label);
    expect(Buffer.byteLength(r.text)).toBeLessThanOrEqual(512);
    expect(r.receiptBytes * 20000).toBeLessThan(RECEIPT_BYTE_CAP);
  });
  it('validates CAST raw bytes and stores checkpoint+cursor before preparing, never current', async () => {
    const f = fixture();
    await expect(validateSingleCopy(f.pool, f.run, manifest, new Date(), 1, async () => {})).resolves.toMatchObject({
      ready: true,
      processed: 1,
    });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('ORDER BY BINARY label LIMIT 501'))).toBe(true);
    expect(f.connection.commit).toHaveBeenCalledTimes(2);
    expect(f.execute.mock.calls[0][0]).toContain('validation_next_page');
    expect(JSON.stringify(f.execute.mock.calls)).not.toContain('topic_current');
    expect(f.run.validation_next_page).toBe(1);
  });
  it('resumes a committed serialized checkpoint from stored rows and verifies the previous receipt', async () => {
    const f = fixture();
    await validateSingleCopy(f.pool, f.run, manifest, new Date(), 1, async () => {});
    f.run.status = 'validating';
    const resumed = { ...f.run, checksum_checkpoint: JSON.parse(f.run.checkpoint_raw) } as RowDataPacket;
    await expect(validateSingleCopy(f.pool, resumed, manifest, new Date(), 0, async () => {})).resolves.toMatchObject({
      ready: true,
      processed: 0,
    });
    resumed.status = 'validating';
    resumed.checkpoint_last_label = 'wrong prior label';
    await expect(validateSingleCopy(f.pool, resumed, manifest, new Date(), 0, async () => {})).rejects.toThrow('checkpoint-continuity');
  });
  it('receipt cap is a permanent failure before page writes, without touching current', async () => {
    const active = {
      ...makeRun(),
      status: 'scanning',
      next_page: 0,
      staged_terms: 0,
      staged_bytes: 0,
      last_label: null,
      receipt_bytes: RECEIPT_BYTE_CAP,
    };
    const execute = vi.fn(async () => []);
    const query = vi.fn(async (sql: string) => [sql.includes('VERSION()') ? [{ db_version: '11.8.3-MariaDB' }] : [active]]);
    const page = { snapshot: manifest, entries, cursor: '0', nextCursor: null, sha256: manifest.pages[0] };
    const getConnection = vi.fn(async () => ({
      query,
      execute,
      beginTransaction: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
      release: vi.fn(),
    }));
    const result = await importSnapshot(
      { query, execute, getConnection } as unknown as Pool,
      { page: async () => page } as never,
      new Date(),
      async () => {},
      1,
      { payloadMode: 'single-copy-v1' },
    );
    expect(result).toMatchObject({ status: 'failed', reason: 'receipt-cap', becameCurrent: false });
    expect(JSON.stringify(execute.mock.calls)).not.toContain('topic_current');
  });
  it('zero validation budget makes resumable progress boundary without reading pages', async () => {
    const f = fixture();
    expect(await validateSingleCopy(f.pool, f.run, manifest, new Date(), 0, async () => {})).toMatchObject({ ready: false, processed: 0 });
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each(['driver-object', 'reserialized', 'wrong-label', 'extra-row', 'tampered-receipt'])(
    'refuses corrupted stored page %s before checkpoint',
    async (kind) => {
      const f = fixture(),
        original = f.query.getMockImplementation()!;
      f.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id,label')) {
          const row = {
            id: term.id,
            label: term.label,
            payload_bytes: Buffer.byteLength(JSON.stringify(term)),
            raw_payload: JSON.stringify(term),
          };
          if (kind === 'driver-object') row.raw_payload = term as never;
          if (kind === 'reserialized') row.raw_payload += ' ';
          if (kind === 'wrong-label') row.label = '乙';
          return [kind === 'extra-row' ? [row, row] : [row]];
        }
        if (kind === 'tampered-receipt' && !sql.includes('COUNT')) return [[{ entries_json: '{}', sha256: manifest.pages[0] }]];
        return original(sql);
      });
      await expect(validateSingleCopy(f.pool, f.run, manifest, new Date(), 1, async () => {})).rejects.toThrow();
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it('mode mismatch is blocked without failing or modifying the legacy run', async () => {
    const execute = vi.fn(),
      query = vi.fn(async () => [[{ snapshot_id: manifest.id, payload_mode: 'legacy-dual', status: 'scanning' }]]);
    const current = vi.fn();
    const result = await importSnapshot({ query, execute } as unknown as Pool, { current } as never, new Date(), async () => {}, 1, {
      payloadMode: 'single-copy-v1',
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'mode-mismatch' });
    expect(execute).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
  });
  it('CAS guards mode/status/all cursor counters/manifest/checkpoint together', () => {
    const r = makeRun();
    expect(() => assertRunUnchanged({ ...r, payload_mode: 'legacy-dual' } as RowDataPacket, r, 'validating')).toThrow(SnapshotModeMismatch);
    for (const key of [
      'status',
      'next_page',
      'staged_terms',
      'staged_bytes',
      'receipt_bytes',
      'validation_next_page',
      'validated_terms',
      'validated_bytes',
      'last_label',
      'checkpoint_last_label',
      'checkpoint_raw',
      'manifest_raw',
    ])
      expect(() =>
        assertRunUnchanged({ ...r, [key]: typeof r[key] === 'number' ? r[key] + 1 : 'changed' } as RowDataPacket, r, 'validating'),
      ).toThrow();
  });
  it('final integrity uses three indexed LIMIT1 probes, never a full terms COUNT', async () => {
    const f = fixture();
    await validateSingleCopy(f.pool, f.run, manifest, new Date(), 1, async () => {});
    const sql = f.query.mock.calls.map(([statement]) => statement);
    expect(sql.filter((statement) => statement.includes('SELECT id FROM topic_terms'))).toHaveLength(3);
    expect(
      sql.some(
        (statement) => statement.includes('COUNT(*)') && statement.includes('FROM topic_terms') && !statement.includes('page_lengths'),
      ),
    ).toBe(false);
    expect(
      sql
        .filter((statement) => statement.includes('SELECT id FROM topic_terms'))
        .every((statement) => statement.includes('FORCE INDEX(topic_terms_import_page)') && statement.includes('LIMIT 1')),
    ).toBe(true);
  });
  it('MySQL is explicitly blocked before any single-copy source fetch or staging', async () => {
    const query = vi.fn(async (sql: string) => [sql.includes('VERSION()') ? [{ db_version: '8.0.39 MySQL' }] : []]);
    const current = vi.fn(),
      getConnection = vi.fn();
    const result = await importSnapshot({ query, getConnection } as unknown as Pool, { current } as never, new Date(), async () => {}, 1, {
      payloadMode: 'single-copy-v1',
    });
    expect(result).toMatchObject({ status: 'blocked', reason: 'unsupported-database' });
    expect(current).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });
  it('oversized stored page is rejected by length preflight before any raw payload retrieval', async () => {
    const f = fixture(),
      original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql: string) =>
      sql.includes('page_lengths') ? [[{ n: 1, payload_bytes: MAX_SNAPSHOT_PAGE_BYTES + 1 }]] : original(sql),
    );
    await expect(validateSingleCopy(f.pool, f.run, manifest, new Date(), 1, async () => {})).rejects.toThrow('page-byte-cap');
    expect(f.query.mock.calls.some(([sql]) => sql.includes('SELECT id,label'))).toBe(false);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('post-preflight oversized row returns NULL sentinel and does not reach JSON parsing/checkpoint', async () => {
    const f = fixture(),
      original = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT id,label')
        ? [[{ id: term.id, label: term.label, payload_bytes: MAX_SNAPSHOT_PAGE_BYTES + 1, raw_payload: null }]]
        : original(sql),
    );
    await expect(validateSingleCopy(f.pool, f.run, manifest, new Date(), 1, async () => {})).rejects.toThrow('page-byte-cap');
    expect(f.execute).not.toHaveBeenCalled();
  });
  it('new receipts reject page bytes over the unchanged upstream page cap', () => {
    const huge = { ...term, opaquePadding: 'x'.repeat(MAX_SNAPSHOT_PAGE_BYTES) };
    expect(() => singleCopyReceipt([huge])).toThrow('page-byte-cap');
  });
  it('database-family probe timeout is local and cannot fall through to staging', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('VERSION()')) throw Object.assign(Error('private DB timeout'), { code: 'ER_STATEMENT_TIMEOUT' });
      return [[]];
    });
    const current = vi.fn();
    const result = await importSnapshot({ query } as unknown as Pool, { current } as never, new Date(), async () => {}, 1, {
      payloadMode: 'single-copy-v1',
    });
    expect(result).toMatchObject({ status: 'deferred', reason: 'local-db-timeout' });
    expect(current).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private DB');
  });
  it('lease is checked after checkpoint UPDATE before commit; lost lease rolls back', async () => {
    const f = fixture(),
      guard = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('fixture_lease_lost'));
    await expect(validateSingleCopy(f.pool, f.run, manifest, new Date(), 1, guard)).rejects.toThrow('fixture_lease_lost');
    expect(f.execute).toHaveBeenCalledOnce();
    expect(f.connection.commit).not.toHaveBeenCalled();
    expect(f.connection.rollback).toHaveBeenCalledOnce();
    expect(f.run.validation_next_page).toBe(0);
  });
  it('concurrent advanced cursor prevents even permanent error writeback from poisoning the winner', async () => {
    const active = { ...makeRun(), status: 'scanning', next_page: 0, staged_terms: 0, staged_bytes: 0, receipt_bytes: 0, last_label: null };
    const execute = vi.fn();
    const query = vi.fn(async (sql: string) => [sql.includes('VERSION()') ? [{ db_version: '11.8.3-MariaDB' }] : [active]]);
    const connection = {
      beginTransaction: vi.fn(),
      query: vi.fn(async () => [[{ ...active, next_page: 1 }]]),
      execute,
      rollback: vi.fn(),
      commit: vi.fn(),
      release: vi.fn(),
    };
    const result = await importSnapshot(
      { query, getConnection: async () => connection } as unknown as Pool,
      {
        page: async () => {
          throw Error('Vocabulary export exceeds byte cap');
        },
      } as never,
      new Date(),
      async () => {},
      1,
      { payloadMode: 'single-copy-v1' },
    );
    expect(result).toMatchObject({ status: 'conflict', reason: 'stale-cursor' });
    expect(execute).not.toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });
  it('SQL statement timeout is classified as local DB rather than upstream', async () => {
    const active = { ...makeRun(), status: 'scanning', next_page: 0, staged_terms: 0, staged_bytes: 0, receipt_bytes: 0, last_label: null };
    const execute = vi.fn(),
      query = vi.fn(async (sql: string) => [sql.includes('VERSION()') ? [{ db_version: '11.8.3-MariaDB' }] : [active]]);
    const connection = {
      beginTransaction: vi.fn(),
      query: vi.fn(async () => [[active]]),
      execute,
      rollback: vi.fn(),
      commit: vi.fn(),
      release: vi.fn(),
    };
    const result = await importSnapshot(
      { query, getConnection: async () => connection } as unknown as Pool,
      {
        page: async () => {
          throw Object.assign(Error('SQL timeout'), { code: 'ER_STATEMENT_TIMEOUT' });
        },
      } as never,
      new Date(),
      async () => {},
      1,
      { payloadMode: 'single-copy-v1' },
    );
    expect(result).toMatchObject({ status: 'deferred', reason: 'local-db-timeout' });
    expect(connection.commit).toHaveBeenCalledOnce();
  });
  it('checkpoint transaction failure rolls back without advancing persisted/in-memory cursor', async () => {
    const f = fixture();
    f.connection.commit.mockRejectedValueOnce(Error('fixture_commit_failure'));
    await expect(validateSingleCopy(f.pool, f.run, manifest, new Date(), 1, async () => {})).rejects.toThrow();
    expect(f.connection.rollback).toHaveBeenCalledOnce();
    expect(f.run.validation_next_page).toBe(0);
  });
});
