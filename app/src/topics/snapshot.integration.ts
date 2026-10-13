import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { digest } from './matcher.ts';
import { type ExportManifest, type ExportTerm, MAX_SNAPSHOT_BYTES, type SnapshotSource, SOURCE } from './snapshot-client.ts';
import { importSnapshot } from './snapshot-import.ts';

const timestamp = '2026-10-12T00:00:00.000Z';
function fixture(size = 1001) {
  const terms: ExportTerm[] = Array.from({ length: size }, (_, i) => ({
    id: digest(`部落格${String(i).padStart(5, '0')}`),
    label: `部落格${String(i).padStart(5, '0')}`,
    articleCount: 3,
    recentArticleCount: 2,
    noise: false,
    noEqual: false,
    firstPublishedAt: timestamp,
    lastPublishedAt: timestamp,
    origin: 'article-tags-mixed',
    journalistAssigned: null,
  }));
  const pages: ExportTerm[][] = [];
  for (let i = 0; i < terms.length; i += 500) pages.push(terms.slice(i, i + 500));
  const manifest: ExportManifest = {
    schemaVersion: 1,
    id: randomUUID(),
    previousId: null,
    generatedAt: timestamp,
    source: SOURCE,
    attribution: '新文易數',
    coverage: 'all-current-indexed-article-tags',
    provenance: 'mixed',
    identity: 'sha256-exact-utf8-label',
    total: terms.length,
    pageSize: 500,
    pages: pages.map((p) => digest(JSON.stringify(p) + '\n')),
    sha256: digest(terms.map((t) => JSON.stringify(t) + '\n').join('')),
    changeCount: 0,
    changePages: [],
  };
  const page = (index: number) => ({
    snapshot: manifest,
    entries: pages[index],
    cursor: String(index),
    nextCursor: index + 1 < pages.length ? String(index + 1) : null,
    sha256: manifest.pages[index],
  });
  return { terms, pages, manifest, page };
}
/** Actual DB receipts/transactions; the caller owns a disposable schema on the isolated server. */
export async function runSnapshotImportIntegration(pool: Pool) {
  assertEphemeralDatabase(pool);
  const [[original]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
  const lastGood = original?.snapshot_id ?? randomUUID();
  const ids: string[] = [];
  if (!original) await pool.execute('INSERT INTO topic_current(source,snapshot_id) VALUES (?,?)', [SOURCE, lastGood]);
  const stillCurrent = async () => {
    const [[current]] = await pool.query<RowDataPacket[]>('SELECT snapshot_id FROM topic_current WHERE source=?', [SOURCE]);
    assert.equal(current.snapshot_id, lastGood, 'staged or failed full imports never replace last-good');
  };
  try {
    const f = fixture();
    ids.push(f.manifest.id);
    let currentCalls = 0,
      startCalls = 0;
    const fetched: number[] = [];
    let failOnce = true;
    const source: SnapshotSource = {
      current: async () => {
        currentCalls++;
        return f.manifest;
      },
      page: async (_manifest, index) => {
        fetched.push(index);
        if (index === 1 && failOnce) {
          failOnce = false;
          throw Error('simulated interruption');
        }
        return f.page(index);
      },
    };
    const start = async () => {
      startCalls++;
      return true;
    };
    const now = new Date(timestamp);
    const first = await importSnapshot(pool, source, now, async () => {}, 1, { beforeStart: start });
    assert.equal(first.status, 'incomplete');
    await stillCurrent();
    const broken = await importSnapshot(pool, source, now, async () => {}, 1, { beforeStart: start });
    assert.equal(broken.status, 'deferred');
    const later = new Date(now.getTime() + 6 * 60_000);
    const second = await importSnapshot(pool, source, later, async () => {}, 1, { beforeStart: start });
    assert.equal(second.status, 'incomplete');
    const third = await importSnapshot(pool, source, later, async () => {}, 1, { beforeStart: start });
    assert.equal(third.status, 'ready', JSON.stringify(third));
    assert.equal(currentCalls, 1, 'resume uses pinned manifest, never fetches new current');
    assert.equal(startCalls, 1, 'resumes do not spend new-run budget');
    assert.deepEqual(fetched, [0, 1, 1, 2]);
    await stillCurrent();
    const [[count]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_terms WHERE snapshot_id=?', [f.manifest.id]);
    assert.equal(Number(count.n), 1001);
    const [[receipt]] = await pool.query<RowDataPacket[]>(
      'SELECT entries_json FROM topic_snapshot_pages WHERE snapshot_id=? AND page_index=0',
      [f.manifest.id],
    );
    assert.equal(receipt.entries_json, JSON.stringify(f.pages[0]), 'LONGTEXT preserves exact hash serialization');
    const [[stored]] = await pool.query<RowDataPacket[]>('SELECT payload FROM topic_terms WHERE snapshot_id=? AND id=?', [
      f.manifest.id,
      f.terms[0].id,
    ]);
    const payload = typeof stored.payload === 'string' ? JSON.parse(stored.payload) : stored.payload;
    assert.equal(payload.noise, false);
    assert.equal(payload.noEqual, false);
    assert.equal(payload.recentArticleCount, 2);
    for (const mode of ['duplicate', 'bad-hash', 'changed', 'expired', 'budget', 'cap', 'receipt', 'wire-cap', 'wire-json'] as const) {
      const bad = fixture(501);
      ids.push(bad.manifest.id);
      if (mode === 'duplicate') {
        bad.pages[1][0] = bad.pages[0][499];
        bad.manifest.pages[1] = digest(JSON.stringify(bad.pages[1]) + '\n');
      }
      if (mode === 'bad-hash') bad.manifest.sha256 = '0'.repeat(64);
      const source: SnapshotSource = {
        current: async () => bad.manifest,
        page: async (_manifest, index) => {
          if (index === 1 && mode === 'expired') throw Error('Vocabulary export HTTP 410');
          if (index === 1 && mode === 'budget') throw Error('topic_upstream_budget');
          if (index === 1 && mode === 'wire-cap') throw Error('Vocabulary export exceeds byte cap');
          if (index === 1 && mode === 'wire-json') throw Error('Vocabulary export invalid JSON');
          if (index === 1 && mode === 'changed')
            return { ...bad.page(index), snapshot: { ...bad.manifest, generatedAt: '2026-10-13T00:00:00.000Z' } };
          return bad.page(index);
        },
      };
      assert.equal((await importSnapshot(pool, source, later, async () => {}, 1)).status, 'incomplete');
      if (mode === 'cap')
        await pool.execute('UPDATE topic_snapshot_runs SET staged_bytes=? WHERE snapshot_id=?', [MAX_SNAPSHOT_BYTES, bad.manifest.id]);
      if (mode === 'receipt')
        await pool.execute("UPDATE topic_snapshot_pages SET entries_json=CONCAT(entries_json,' ') WHERE snapshot_id=? AND page_index=0", [
          bad.manifest.id,
        ]);
      const result = await importSnapshot(pool, source, later, async () => {}, 1);
      assert.equal(result.status, mode === 'budget' ? 'deferred' : 'failed', JSON.stringify(result));
      const [[run]] = await pool.query<RowDataPacket[]>(
        'SELECT status,next_page,next_attempt_at,error_code FROM topic_snapshot_runs WHERE snapshot_id=?',
        [bad.manifest.id],
      );
      assert.equal(Number(run.next_page), ['bad-hash', 'receipt'].includes(mode) ? 2 : 1, 'bad page does not partially commit');
      if (mode === 'wire-cap' || mode === 'wire-json') {
        assert.equal(run.status, 'failed');
        assert.equal(run.next_attempt_at, null, 'permanent payload failure must not queue another download');
        assert.equal(run.error_code, mode === 'wire-cap' ? 'wire-byte-cap' : 'wire-invalid-json');
      }
      if (mode === 'budget') await pool.execute("UPDATE topic_snapshot_runs SET status='failed' WHERE snapshot_id=?", [bad.manifest.id]);
      await stillCurrent();
    }
    return {
      terms: 1001,
      pages: 3,
      crossPageResume: true,
      pinnedManifest: true,
      starts: startCalls,
      exactReceipt: true,
      duplicateRejected: true,
      checksumRejected: true,
      expiredRetained: true,
      budgetDeferred: true,
      lastGoodPreserved: true,
      readyNotPublished: true,
      wireFailuresPermanent: true,
    };
  } finally {
    if (!original) await pool.execute('DELETE FROM topic_current WHERE source=?', [SOURCE]);
    for (const table of [
      'topic_policy_selections',
      'topic_term_aliases_v3',
      'topic_canonical_terms_v3',
      'topic_terms',
      'topic_snapshot_pages',
      'topic_snapshot_runs',
    ])
      if (ids.length) await pool.query(`DELETE FROM ${table} WHERE snapshot_id IN (?)`, [ids]);
    if (ids.length) await pool.query('DELETE FROM topic_snapshots WHERE id IN (?)', [ids]);
  }
}
