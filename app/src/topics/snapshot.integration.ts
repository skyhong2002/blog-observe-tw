import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { assertEphemeralDatabase } from '../../../tests/integration/guard.mjs';
import { digest } from './matcher.ts';
import {
  type ExportManifest,
  type ExportTerm,
  MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_PAGE_BYTES,
  type SnapshotSource,
  SOURCE,
} from './snapshot-client.ts';
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
    // New opt-in mode: exact MariaDB CAST bytes, one payload copy and resumable stored checksum.
    const single = fixture();
    // Real four-byte labels, not only opaque payload strings, in UTF-8 byte order.
    single.terms[999].label = '部落格🌳';
    single.terms[999].id = digest(single.terms[999].label);
    single.terms[1000].label = '部落格😀';
    single.terms[1000].id = digest(single.terms[1000].label);
    single.terms.sort((a, b) => Buffer.compare(Buffer.from(a.label), Buffer.from(b.label)));
    single.pages.splice(
      0,
      single.pages.length,
      ...Array.from({ length: 3 }, (_, page) => single.terms.slice(page * 500, (page + 1) * 500)),
    );
    ids.push(single.manifest.id);
    const rawOracle = '中文🌳\u2028"\\\n';
    Object.assign(single.terms[0], { fixtureOracle: rawOracle });
    single.manifest.pages = single.pages.map((page) => digest(JSON.stringify(page) + '\n'));
    single.manifest.sha256 = digest(single.terms.map((term) => JSON.stringify(term) + '\n').join(''));
    const singleSource = {
      current: async () => single.manifest,
      page: async (_manifest: ExportManifest, index: number) => single.page(index),
    };
    const mode = { payloadMode: 'single-copy-v1' as const };
    assert.equal((await importSnapshot(pool, singleSource, later, async () => {}, 1, mode)).status, 'incomplete');
    const mismatch = await importSnapshot(pool, singleSource, later, async () => {}, 1);
    assert.equal(mismatch.status, 'blocked');
    const [[rawPayload]] = await pool.query<RowDataPacket[]>(
      'SELECT CAST(payload AS CHAR CHARACTER SET utf8mb4) raw_payload FROM topic_terms WHERE snapshot_id=? AND id=?',
      [single.manifest.id, single.terms[0].id],
    );
    assert.equal(typeof rawPayload.raw_payload, 'string');
    assert.equal(rawPayload.raw_payload, JSON.stringify(single.terms[0]));
    assert.deepEqual(Buffer.from(rawPayload.raw_payload), Buffer.from(JSON.stringify(single.terms[0])));
    let singleResult: Awaited<ReturnType<typeof importSnapshot>>;
    const validationCursors: number[] = [];
    for (let batch = 0; batch < 12; batch++) {
      singleResult = await importSnapshot(pool, singleSource, later, async () => {}, 1, mode);
      const [[progress]] = await pool.query<RowDataPacket[]>('SELECT validation_next_page FROM topic_snapshot_runs WHERE snapshot_id=?', [
        single.manifest.id,
      ]);
      validationCursors.push(Number(progress.validation_next_page));
      if (singleResult.status === 'ready') break;
      assert.equal(singleResult.status, 'incomplete');
    }
    assert.equal(singleResult!.status, 'ready');
    assert.ok(validationCursors.includes(1) && validationCursors.includes(2) && validationCursors.includes(3));
    const [[singleRun]] = await pool.query<RowDataPacket[]>(
      'SELECT staged_bytes,receipt_bytes,payload_mode,validation_next_page FROM topic_snapshot_runs WHERE snapshot_id=?',
      [single.manifest.id],
    );
    assert.equal(singleRun.payload_mode, 'single-copy-v1');
    assert.equal(
      Number(singleRun.staged_bytes),
      single.terms.reduce((n, term) => n + Buffer.byteLength(JSON.stringify(term) + '\n'), 0),
    );
    const [singleReceipts] = await pool.query<RowDataPacket[]>(
      'SELECT entries_json FROM topic_snapshot_pages WHERE snapshot_id=? ORDER BY page_index',
      [single.manifest.id],
    );
    assert.equal(
      Number(singleRun.receipt_bytes),
      singleReceipts.reduce((n, receipt) => n + Buffer.byteLength(receipt.entries_json), 0),
    );
    assert.ok(
      singleReceipts.every(
        (receipt) =>
          Buffer.byteLength(receipt.entries_json) <= 512 &&
          !receipt.entries_json.includes('fixtureOracle') &&
          !receipt.entries_json.includes('部落格'),
      ),
    );
    const sourceOf = (f: ReturnType<typeof fixture>) => ({
      current: async () => f.manifest,
      page: async (_manifest: ExportManifest, index: number) => f.page(index),
    });
    const reverseMismatch = await importSnapshot(pool, sourceOf(f), later, async () => {}, 1, mode);
    assert.equal(reverseMismatch.status, 'blocked', 'legacy-ready cannot be reinterpreted as single-copy');
    const negativeCases: string[] = [];
    for (const failure of ['payload', 'oversize-page', 'extra501', 'page-index', 'checkpoint', 'manifest']) {
      const bad = fixture(failure === 'checkpoint' || failure === 'manifest' ? 1001 : 500);
      ids.push(bad.manifest.id);
      const src = sourceOf(bad);
      assert.equal((await importSnapshot(pool, src, later, async () => {}, bad.pages.length, mode)).status, 'incomplete');
      if (failure === 'checkpoint' || failure === 'manifest') {
        assert.equal((await importSnapshot(pool, src, later, async () => {}, 1, mode)).status, 'incomplete');
        if (failure === 'checkpoint')
          await pool.execute(
            "UPDATE topic_snapshot_runs SET checksum_checkpoint=JSON_SET(checksum_checkpoint,'$.stateDigest',?) WHERE snapshot_id=?",
            ['0'.repeat(64), bad.manifest.id],
          );
        else
          await pool.execute("UPDATE topic_snapshot_runs SET manifest=JSON_SET(manifest,'$.opaqueFixture','changed') WHERE snapshot_id=?", [
            bad.manifest.id,
          ]);
      } else if (failure === 'oversize-page')
        await pool.execute("UPDATE topic_terms SET payload=JSON_SET(payload,'$.oversizeFixture',?) WHERE snapshot_id=? AND id=?", [
          'x'.repeat(MAX_SNAPSHOT_PAGE_BYTES + 1),
          bad.manifest.id,
          bad.terms[0].id,
        ]);
      else if (failure === 'payload')
        await pool.execute("UPDATE topic_terms SET payload=JSON_SET(payload,'$.articleCount',123) WHERE snapshot_id=? AND id=?", [
          bad.manifest.id,
          bad.terms[0].id,
        ]);
      else if (failure === 'page-index')
        await pool.execute('UPDATE topic_terms SET import_page_index=-1 WHERE snapshot_id=? AND id=?', [bad.manifest.id, bad.terms[0].id]);
      else {
        const extra = { ...bad.terms[0], label: '額外測試', id: digest('額外測試') };
        await pool.execute('INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload,import_page_index) VALUES(?,?,?,?,?,0)', [
          bad.manifest.id,
          extra.id,
          extra.label,
          extra.label,
          JSON.stringify(extra),
        ]);
      }
      assert.equal((await importSnapshot(pool, src, later, async () => {}, 1, mode)).status, 'failed', failure);
      negativeCases.push(failure);
      await stillCurrent();
    }
    // The committed cursor wins over a caller whose local state was not updated yet.
    const committed = fixture();
    ids.push(committed.manifest.id);
    const committedSource = sourceOf(committed);
    const interrupted = await importSnapshot(pool, committedSource, later, async () => {}, 1, {
      ...mode,
      afterPageCommit: async () => {
        throw Error('fixture_post_commit_interrupt');
      },
    });
    assert.equal(interrupted.status, 'conflict');
    const [[afterCommit]] = await pool.query<RowDataPacket[]>('SELECT status,next_page FROM topic_snapshot_runs WHERE snapshot_id=?', [
      committed.manifest.id,
    ]);
    assert.equal(afterCommit.status, 'scanning');
    assert.equal(Number(afterCommit.next_page), 1);
    assert.equal((await importSnapshot(pool, committedSource, later, async () => {}, 50, mode)).status, 'ready');
    await stillCurrent();
    // Two workers: A pins the old cursor, B advances, then A must conflict without poisoning B.
    const race = fixture();
    ids.push(race.manifest.id);
    const raceSource = sourceOf(race);
    assert.equal((await importSnapshot(pool, raceSource, later, async () => {}, 1, mode)).status, 'incomplete');
    let atPage!: () => void, release!: () => void;
    const reading = new Promise<void>((resolve) => {
      atPage = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stale = importSnapshot(
      pool,
      {
        ...raceSource,
        page: async (_manifest, index) => {
          atPage();
          await barrier;
          return race.page(index);
        },
      },
      later,
      async () => {},
      1,
      mode,
    );
    void stale.catch(() => undefined);
    await Promise.race([
      reading,
      stale.then(() => {
        throw Error('fixture_stale_finished_before_barrier');
      }),
    ]);
    try {
      assert.equal((await importSnapshot(pool, raceSource, later, async () => {}, 1, mode)).status, 'incomplete');
    } finally {
      release();
      await stale.catch(() => undefined);
    }
    assert.equal((await stale).status, 'conflict');
    const [[afterRace]] = await pool.query<RowDataPacket[]>('SELECT status,next_page FROM topic_snapshot_runs WHERE snapshot_id=?', [
      race.manifest.id,
    ]);
    assert.equal(afterRace.status, 'scanning');
    assert.equal(Number(afterRace.next_page), 2);
    assert.equal((await importSnapshot(pool, raceSource, later, async () => {}, 50, mode)).status, 'ready');
    await stillCurrent();
    await stillCurrent();
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
      singleCopyExactCast: true,
      singleCopyValidationCursors: validationCursors,
      singleCopyLogicalBytesOnce: true,
      currentUnchanged: true,
      fourByteLabels: true,
      negativeCases,
      postCommitResume: true,
      staleWorkerNoPoison: true,
      reverseModeBlocked: true,
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
