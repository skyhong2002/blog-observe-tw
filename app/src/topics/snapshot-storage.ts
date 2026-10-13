import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { exportSnapshotCheckpoint, importSnapshotCheckpoint, SnapshotSha256 } from './snapshot-checkpoint.ts';
import { type ExportManifest, type ExportTerm, MAX_SNAPSHOT_PAGE_BYTES, validatePage } from './snapshot-client.ts';
export const SINGLE_COPY_MODE = 'single-copy-v1';
export const LEGACY_PAYLOAD_MODE = 'legacy-dual';
export const RECEIPT_BYTE_CAP = 8 * 1024 ** 2;
export class SnapshotStorageError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
export class SnapshotModeMismatch extends Error {}
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
export function snapshotMode(run: RowDataPacket | undefined) {
  return run?.payload_mode ?? LEGACY_PAYLOAD_MODE;
}
export function singleCopyReceipt(entries: ExportTerm[]) {
  const bytes = entries.reduce((n, term) => n + Buffer.byteLength(JSON.stringify(term) + '\n'), 0);
  if (entries.length > 500 || bytes + 2 > MAX_SNAPSHOT_PAGE_BYTES) throw new SnapshotStorageError('page-byte-cap');
  const metadata = {
    version: 1,
    count: entries.length,
    bytes,
    firstLabelSha256: entries.length ? sha(entries[0].label) : null,
    lastLabelSha256: entries.length ? sha(entries.at(-1)!.label) : null,
  };
  const text = JSON.stringify(metadata);
  if (Buffer.byteLength(text) > 512) throw new SnapshotStorageError('receipt-cap');
  return { text, bytes, receiptBytes: Buffer.byteLength(text) };
}
function checkpointRaw(run: RowDataPacket) {
  return (
    run.checkpoint_raw ??
    (run.checksum_checkpoint === null || run.checksum_checkpoint === undefined ? null : JSON.stringify(run.checksum_checkpoint))
  );
}
export function assertRunUnchanged(fresh: RowDataPacket | undefined, expected: RowDataPacket, status: string) {
  if (snapshotMode(fresh) !== snapshotMode(expected)) throw new SnapshotModeMismatch('mode-mismatch');
  if (
    !fresh ||
    fresh.status !== status ||
    ['next_page', 'staged_terms', 'staged_bytes', 'receipt_bytes', 'validation_next_page', 'validated_terms', 'validated_bytes'].some(
      (key) => Number(fresh[key] ?? 0) !== Number(expected[key] ?? 0),
    ) ||
    (fresh.last_label ?? null) !== (expected.last_label ?? null) ||
    (fresh.checkpoint_last_label ?? null) !== (expected.checkpoint_last_label ?? null) ||
    checkpointRaw(fresh) !== checkpointRaw(expected) ||
    fresh.manifest_raw !== expected.manifest_raw
  )
    throw new SnapshotStorageError('stale-cursor');
}
export const lockedRun = async (c: PoolConnection, id: string) => {
  const [[row]] = await c.query<RowDataPacket[]>(
    'SELECT *,CAST(manifest AS CHAR CHARACTER SET utf8mb4) manifest_raw,CAST(checksum_checkpoint AS CHAR CHARACTER SET utf8mb4) checkpoint_raw FROM topic_snapshot_runs WHERE snapshot_id=? FOR UPDATE',
    [id],
  );
  return row;
};
async function storedPage(pool: Pick<Pool, 'query'>, manifest: ExportManifest, index: number) {
  const [[receipt]] = await pool.query<RowDataPacket[]>(
    'SELECT entries_json,sha256 FROM topic_snapshot_pages WHERE snapshot_id=? AND page_index=?',
    [manifest.id, index],
  );
  const expected = Math.min(500, manifest.total - index * 500);
  const [[lengths]] = await pool.query<RowDataPacket[]>(
    'SET STATEMENT max_statement_time=0.25 FOR SELECT COUNT(*) n,COALESCE(SUM(payload_bytes),0) payload_bytes FROM (SELECT OCTET_LENGTH(payload) payload_bytes FROM topic_terms FORCE INDEX(topic_terms_import_page) WHERE snapshot_id=? AND import_page_index=? LIMIT 501) page_lengths',
    [manifest.id, index],
  );
  if (!lengths || Number(lengths.n) !== expected) throw new SnapshotStorageError('missing-receipt');
  if (
    !Number.isSafeInteger(Number(lengths.payload_bytes)) ||
    Number(lengths.payload_bytes) < 0 ||
    Number(lengths.payload_bytes) + expected + 2 > MAX_SNAPSHOT_PAGE_BYTES
  )
    throw new SnapshotStorageError('page-byte-cap');
  const [rows] = await pool.query<RowDataPacket[]>(
    `SET STATEMENT max_statement_time=0.25 FOR SELECT id,label,OCTET_LENGTH(payload) payload_bytes,CASE WHEN OCTET_LENGTH(payload)<=${MAX_SNAPSHOT_PAGE_BYTES} THEN CAST(SUBSTRING(CAST(payload AS BINARY),1,${MAX_SNAPSHOT_PAGE_BYTES + 1}) AS CHAR CHARACTER SET utf8mb4) ELSE NULL END raw_payload FROM topic_terms WHERE snapshot_id=? AND import_page_index=? AND (SELECT COALESCE(SUM(payload_bytes),0) FROM (SELECT OCTET_LENGTH(payload) payload_bytes FROM topic_terms FORCE INDEX(topic_terms_import_page) WHERE snapshot_id=? AND import_page_index=? LIMIT 501) fetch_lengths)<=${MAX_SNAPSHOT_PAGE_BYTES - expected - 2} ORDER BY BINARY label LIMIT 501`,
    [manifest.id, index, manifest.id, index],
  );
  if (!receipt || typeof receipt.entries_json !== 'string' || rows.length !== expected) throw new SnapshotStorageError('missing-receipt');
  const entries: ExportTerm[] = [];
  let retrievedBytes = 0;
  for (const row of rows) {
    if (
      row.raw_payload === null ||
      !Number.isSafeInteger(Number(row.payload_bytes)) ||
      Number(row.payload_bytes) > MAX_SNAPSHOT_PAGE_BYTES ||
      Number(row.payload_bytes) < 0
    )
      throw new SnapshotStorageError('page-byte-cap');
    if (typeof row.raw_payload !== 'string') throw new SnapshotStorageError('payload-roundtrip');
    const rawBytes = Buffer.byteLength(row.raw_payload);
    retrievedBytes += rawBytes + 1;
    if (rawBytes !== Number(row.payload_bytes) || retrievedBytes + 2 > MAX_SNAPSHOT_PAGE_BYTES)
      throw new SnapshotStorageError('page-byte-cap');
    let term: ExportTerm;
    try {
      term = JSON.parse(row.raw_payload);
    } catch {
      throw new SnapshotStorageError('payload-roundtrip');
    }
    if (JSON.stringify(term) !== row.raw_payload || term.id !== row.id || term.label !== row.label)
      throw new SnapshotStorageError('payload-roundtrip');
    entries.push(term);
  }
  try {
    validatePage(
      {
        snapshot: manifest,
        entries,
        cursor: String(index),
        nextCursor: index + 1 < manifest.pages.length ? String(index + 1) : null,
        sha256: receipt.sha256,
      },
      manifest,
      index,
    );
  } catch {
    throw new SnapshotStorageError('page-checksum');
  }
  const rebuilt = singleCopyReceipt(entries);
  if (receipt.entries_json !== rebuilt.text || receipt.sha256 !== manifest.pages[index])
    throw new SnapshotStorageError('receipt-roundtrip');
  return { entries, ...rebuilt };
}
/** Separate validation of persisted exact payloads. No current-pointer writes. */
export async function validateSingleCopy(
  pool: Pool,
  run: RowDataPacket,
  manifest: ExportManifest,
  now: Date,
  limit: number,
  guard: () => Promise<void>,
  afterPageCommit?: () => Promise<void>,
) {
  if (snapshotMode(run) !== SINGLE_COPY_MODE) throw new SnapshotModeMismatch('mode-mismatch');
  if (typeof run.manifest_raw !== 'string') throw new SnapshotStorageError('manifest-roundtrip');
  try {
    if (!isDeepStrictEqual(JSON.parse(run.manifest_raw), manifest)) throw Error();
  } catch {
    throw new SnapshotStorageError('manifest-roundtrip');
  }
  const pinned = { snapshotId: manifest.id, manifestSha256: sha(run.manifest_raw) };
  if (run.status === 'scanning') {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const fresh = await lockedRun(c, manifest.id);
      assertRunUnchanged(fresh, run, 'scanning');
      if (Number(run.next_page) !== manifest.pages.length || Number(run.staged_terms) !== manifest.total)
        throw new SnapshotStorageError('stale-cursor');
      await guard();
      await c.execute("UPDATE topic_snapshot_runs SET status='validating',next_attempt_at=NULL,updated_at=? WHERE snapshot_id=?", [
        now,
        manifest.id,
      ]);
      await guard();
      await c.commit();
      run.status = 'validating';
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  if (run.status !== 'validating') throw new SnapshotStorageError('stale-cursor');
  let stream = new SnapshotSha256();
  let previous: Buffer | null = null;
  if (Number(run.validation_next_page ?? 0) > 0) {
    await guard();
    const index = Number(run.validation_next_page) - 1,
      prior = await storedPage(pool, manifest, index);
    const last = prior.entries.at(-1)?.label ?? null;
    if (last !== (run.checkpoint_last_label ?? null)) throw new SnapshotStorageError('checkpoint-continuity');
    previous = last === null ? null : Buffer.from(last);
    try {
      stream = importSnapshotCheckpoint(JSON.parse(checkpointRaw(run)!), pinned, {
        nextPage: Number(run.validation_next_page),
        nextOrdinal: Number(run.validated_terms),
        termCount: Number(run.validated_terms),
        verifiedBytes: Number(run.validated_bytes),
      });
    } catch {
      throw new SnapshotStorageError('checkpoint-invalid');
    }
  } else if (
    checkpointRaw(run) !== null ||
    Number(run.validated_terms ?? 0) !== 0 ||
    Number(run.validated_bytes ?? 0) !== 0 ||
    run.checkpoint_last_label != null
  )
    throw new SnapshotStorageError('checkpoint-invalid');
  let processed = 0;
  while (Number(run.validation_next_page ?? 0) < manifest.pages.length && processed < limit) {
    await guard();
    const index = Number(run.validation_next_page ?? 0);
    const page = await storedPage(pool, manifest, index);
    for (const term of page.entries) {
      const label = Buffer.from(term.label);
      if (previous && Buffer.compare(previous, label) >= 0) throw new SnapshotStorageError('order-or-duplicate');
      previous = label;
      try {
        stream.update(Buffer.from(JSON.stringify(term) + '\n'));
      } catch {
        throw new SnapshotStorageError('cap-bytes');
      }
    }
    const count = Number(run.validated_terms ?? 0) + page.entries.length,
      bytes = Number(run.validated_bytes ?? 0) + page.bytes;
    const checkpoint = exportSnapshotCheckpoint(stream, pinned, {
      nextPage: index + 1,
      nextOrdinal: count,
      termCount: count,
      verifiedBytes: bytes,
    });
    const raw = JSON.stringify(checkpoint),
      last = page.entries.at(-1)?.label ?? run.checkpoint_last_label ?? null;
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const fresh = await lockedRun(c, manifest.id);
      assertRunUnchanged(fresh, run, 'validating');
      await guard();
      await c.execute(
        'UPDATE topic_snapshot_runs SET validation_next_page=?,validated_terms=?,validated_bytes=?,checksum_checkpoint=?,checkpoint_last_label=?,updated_at=? WHERE snapshot_id=?',
        [index + 1, count, bytes, raw, last, now, manifest.id],
      );
      await guard();
      await c.commit();
      await afterPageCommit?.();
      Object.assign(run, {
        validation_next_page: index + 1,
        validated_terms: count,
        validated_bytes: bytes,
        checksum_checkpoint: checkpoint,
        checkpoint_raw: raw,
        checkpoint_last_label: last,
      });
      processed++;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  }
  if (Number(run.validation_next_page ?? 0) < manifest.pages.length) return { ready: false, processed };
  // Exact per-page counts were already verified. Probe only indexed out-of-catalog rows.
  for (const range of ['import_page_index IS NULL', 'import_page_index<0', 'import_page_index>=?']) {
    await guard();
    const [outside] = await pool.query<RowDataPacket[]>(
      `SET STATEMENT max_statement_time=0.25 FOR SELECT id FROM topic_terms FORCE INDEX(topic_terms_import_page) WHERE snapshot_id=? AND ${range} LIMIT 1`,
      range.includes('?') ? [manifest.id, manifest.pages.length] : [manifest.id],
    );
    if (outside.length) throw new SnapshotStorageError('page-index-gap');
  }
  const [[receipts]] = await pool.query<RowDataPacket[]>(
    'SET STATEMENT max_statement_time=0.25 FOR SELECT COUNT(*) n,COALESCE(SUM(OCTET_LENGTH(entries_json)),0) bytes FROM topic_snapshot_pages WHERE snapshot_id=?',
    [manifest.id],
  );
  if (
    Number(run.validated_terms ?? 0) !== manifest.total ||
    Number(run.validated_bytes ?? 0) !== Number(run.staged_bytes) ||
    Number(receipts.n) !== manifest.pages.length ||
    Number(receipts.bytes) !== Number(run.receipt_bytes ?? 0) ||
    stream.digestHex() !== manifest.sha256
  )
    throw new SnapshotStorageError('full-checksum');
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const fresh = await lockedRun(c, manifest.id);
    assertRunUnchanged(fresh, run, 'validating');
    await guard();
    await c.execute("UPDATE topic_snapshot_runs SET status='preparing',updated_at=? WHERE snapshot_id=?", [now, manifest.id]);
    await guard();
    await c.commit();
    run.status = 'preparing';
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
  return { ready: true, processed };
}
