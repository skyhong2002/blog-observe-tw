import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { storedNormalizedLabel } from './policy.ts';
import { prepareStagedTopicPolicy } from './policy-store.ts';
import { type ExportManifest, MAX_SNAPSHOT_BYTES, type SnapshotSource, validateManifest, validatePage } from './snapshot-client.ts';
import {
  assertRunUnchanged,
  LEGACY_PAYLOAD_MODE,
  lockedRun,
  RECEIPT_BYTE_CAP,
  SINGLE_COPY_MODE,
  SnapshotModeMismatch,
  SnapshotStorageError,
  singleCopyReceipt,
  snapshotMode,
  validateSingleCopy,
} from './snapshot-storage.ts';
import { TagRateLimitError } from './transport.ts';

const parsed = <T>(raw: unknown): T => (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
class InvalidSnapshot extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
type Controls = {
  signal?: AbortSignal;
  deadline?: number;
  beforeStart?: () => Promise<boolean>;
  beforeRequest?: () => Promise<void>;
  payloadMode?: 'legacy-dual' | 'single-copy-v1';
  /** Test seam: commit may succeed before the caller updates its in-memory cursor. */
  afterPageCommit?: () => Promise<void>;
};
/** Fixed transport contract failures will not improve by fetching the same immutable page again.
 * Match only the transport's known messages; never save an upstream/error message as a reason. */
export function snapshotWireFailureCode(error: unknown): 'wire-byte-cap' | 'wire-invalid-json' | null {
  if (!(error instanceof Error)) return null;
  if (error.message === 'Vocabulary export exceeds byte cap') return 'wire-byte-cap';
  if (error.message === 'Vocabulary export invalid JSON') return 'wire-invalid-json';
  return null;
}
const localDbTimeout = (error: unknown) =>
  ['ER_STATEMENT_TIMEOUT', 'ER_QUERY_INTERRUPTED', 'PROTOCOL_SEQUENCE_TIMEOUT'].includes((error as { code?: string })?.code ?? '') ||
  [1969, 1317].includes((error as { errno?: number })?.errno ?? 0);
/** Page receipts preserve JSON.stringify(entries), the upstream checksum representation, not wire whitespace.
 * No current pointer changes here: a ready full pool needs a separately reviewed matching warmup/cutover. */
export async function importSnapshot(
  pool: Pool,
  source: SnapshotSource,
  now: Date,
  assertLease: () => Promise<void>,
  maxPages = 10,
  control: Controls = {},
) {
  const assertRunning = () => {
    control.signal?.throwIfAborted();
    if (Date.now() >= (control.deadline ?? Infinity)) throw Error('snapshot deadline; current retained');
  };
  const requestedMode = control.payloadMode ?? LEGACY_PAYLOAD_MODE;
  if (![LEGACY_PAYLOAD_MODE, SINGLE_COPY_MODE].includes(requestedMode))
    return { status: 'blocked', reason: 'mode-mismatch', becameCurrent: false };
  assertRunning();
  const [[active]] = await pool.query<RowDataPacket[]>(
    "SELECT *,CAST(manifest AS CHAR CHARACTER SET utf8mb4) manifest_raw,CAST(checksum_checkpoint AS CHAR CHARACTER SET utf8mb4) checkpoint_raw FROM topic_snapshot_runs WHERE status IN ('scanning','validating','preparing') ORDER BY created_at LIMIT 1",
  );
  if (active && snapshotMode(active) !== requestedMode)
    return { status: 'blocked', version: active.snapshot_id, reason: 'mode-mismatch', becameCurrent: false };
  if (active?.next_attempt_at && new Date(active.next_attempt_at).getTime() > now.getTime())
    return { status: 'deferred', version: active.snapshot_id, nextAttemptAt: active.next_attempt_at };
  if (requestedMode === SINGLE_COPY_MODE) {
    let database: RowDataPacket | undefined;
    try {
      [[database]] = await pool.query<RowDataPacket[]>('SELECT VERSION() AS db_version');
    } catch (error) {
      return {
        status: 'deferred',
        version: active?.snapshot_id ?? null,
        reason: localDbTimeout(error) ? 'local-db-timeout' : 'local-db-unavailable',
        nextAttemptAt: new Date(now.getTime() + 300_000),
        becameCurrent: false,
      };
    }
    if (typeof database?.db_version !== 'string' || !/MariaDB/i.test(database.db_version))
      return { status: 'blocked', version: active?.snapshot_id ?? null, reason: 'unsupported-database', becameCurrent: false };
  }
  let run = active;
  let manifest: ExportManifest | undefined;
  let processed = 0;
  try {
    if (run) manifest = validateManifest(parsed(run.manifest));
    else {
      await assertLease();
      await control.beforeRequest?.();
      manifest = validateManifest(await source.current());
      assertRunning();
      const [[existing]] = await pool.query<RowDataPacket[]>('SELECT * FROM topic_snapshot_runs WHERE snapshot_id=?', [manifest.id]);
      if (existing) {
        if (snapshotMode(existing) !== requestedMode)
          return { status: 'blocked', version: manifest.id, reason: 'mode-mismatch', becameCurrent: false };
        if (!isDeepStrictEqual(parsed(existing.manifest), manifest)) throw new InvalidSnapshot('manifest-changed');
        return { status: existing.status, version: manifest.id, total: manifest.total, becameCurrent: false };
      }
      if (control.beforeStart && !(await control.beforeStart())) return { status: 'budget' };
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [[snapshot]] = await c.query<RowDataPacket[]>('SELECT manifest,status FROM topic_snapshots WHERE id=? FOR UPDATE', [
          manifest.id,
        ]);
        if (snapshot && (!isDeepStrictEqual(parsed(snapshot.manifest), manifest) || snapshot.status !== 'staging'))
          throw new InvalidSnapshot('snapshot-id-reused');
        await c.execute(
          "INSERT INTO topic_snapshots(id,manifest,status,generated_at) VALUES (?,?,'staging',?) ON DUPLICATE KEY UPDATE id=VALUES(id)",
          [manifest.id, JSON.stringify(manifest), new Date(manifest.generatedAt)],
        );
        await c.execute(
          "INSERT INTO topic_snapshot_runs(snapshot_id,manifest,payload_mode,status,created_at,updated_at) VALUES (?,?,?,'scanning',?,?)",
          [manifest.id, JSON.stringify(manifest), requestedMode, now, now],
        );
        await assertLease();
        await c.commit();
      } catch (error) {
        await c.rollback();
        throw error;
      } finally {
        c.release();
      }
      run = {
        snapshot_id: manifest.id,
        next_page: 0,
        staged_terms: 0,
        staged_bytes: 0,
        last_label: null,
        status: 'scanning',
        payload_mode: requestedMode,
        manifest_raw: JSON.stringify(manifest),
        receipt_bytes: 0,
        checkpoint_raw: null,
        checksum_checkpoint: null,
        checkpoint_last_label: null,
        validation_next_page: 0,
        validated_terms: 0,
        validated_bytes: 0,
      } as RowDataPacket;
    }
    const limit = Math.min(50, Math.max(1, Math.floor(maxPages)));
    const singleCopy = requestedMode === SINGLE_COPY_MODE;
    while (run.status === 'scanning' && Number(run.next_page) < manifest.pages.length && processed < limit) {
      assertRunning();
      await assertLease();
      await control.beforeRequest?.();
      const index = Number(run.next_page);
      const page = validatePage(await source.page(manifest, index), manifest, index);
      assertRunning();
      let previous = run.last_label === null ? null : Buffer.from(run.last_label);
      let bytes = 0;
      for (const term of page.entries) {
        const label = Buffer.from(term.label);
        if (previous && Buffer.compare(previous, label) >= 0) throw new InvalidSnapshot('order-or-duplicate');
        previous = label;
        bytes += Buffer.byteLength(JSON.stringify(term) + '\n');
      }
      const metadata = singleCopy ? singleCopyReceipt(page.entries) : null;
      const receipt = metadata?.text ?? JSON.stringify(page.entries);
      if (!singleCopy) bytes += Buffer.byteLength(receipt);
      const receiptBytes = metadata?.receiptBytes ?? 0;
      if (singleCopy && Number(run.receipt_bytes ?? 0) + receiptBytes > RECEIPT_BYTE_CAP) throw new InvalidSnapshot('receipt-cap');
      if (Number(run.staged_bytes) + bytes > MAX_SNAPSHOT_BYTES) throw new InvalidSnapshot('cap-bytes');
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [[fresh]] = await c.query<RowDataPacket[]>(
          'SELECT *,CAST(manifest AS CHAR CHARACTER SET utf8mb4) manifest_raw,CAST(checksum_checkpoint AS CHAR CHARACTER SET utf8mb4) checkpoint_raw FROM topic_snapshot_runs WHERE snapshot_id=? FOR UPDATE',
          [manifest.id],
        );
        if (snapshotMode(fresh) !== requestedMode) throw new SnapshotModeMismatch('mode-mismatch');
        if (singleCopy) assertRunUnchanged(fresh, run, 'scanning');
        if (
          fresh?.status !== 'scanning' ||
          Number(fresh.next_page) !== index ||
          Number(fresh.staged_terms) !== Number(run.staged_terms) ||
          Number(fresh.staged_bytes) !== Number(run.staged_bytes)
        )
          throw new InvalidSnapshot('stale-cursor');
        if (page.entries.length)
          await c.query(
            singleCopy
              ? 'INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload,import_page_index) VALUES ?'
              : 'INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload) VALUES ?',
            [
              page.entries.map((t) => [
                manifest!.id,
                t.id,
                t.label,
                storedNormalizedLabel(t.label),
                JSON.stringify(t),
                ...(singleCopy ? [index] : []),
              ]),
            ],
          );
        await c.execute('INSERT INTO topic_snapshot_pages(snapshot_id,page_index,entries_json,sha256) VALUES (?,?,?,?)', [
          manifest.id,
          index,
          receipt,
          page.sha256,
        ]);
        await c.execute(
          'UPDATE topic_snapshot_runs SET next_page=?,staged_terms=staged_terms+?,staged_bytes=staged_bytes+?,receipt_bytes=receipt_bytes+?,last_label=?,updated_at=?,next_attempt_at=NULL,error_code=NULL WHERE snapshot_id=?',
          [index + 1, page.entries.length, bytes, receiptBytes, page.entries.at(-1)?.label ?? run.last_label, now, manifest.id],
        );
        await assertLease();
        assertRunning();
        await c.commit();
        await control.afterPageCommit?.();
        run.next_page = index + 1;
        run.staged_terms = Number(run.staged_terms) + page.entries.length;
        run.staged_bytes = Number(run.staged_bytes) + bytes;
        run.receipt_bytes = Number(run.receipt_bytes ?? 0) + receiptBytes;
        run.last_label = page.entries.at(-1)?.label ?? run.last_label;
        processed++;
      } catch (error) {
        await c.rollback();
        throw error;
      } finally {
        c.release();
      }
    }
    if (Number(run.next_page) < manifest.pages.length)
      return {
        status: 'incomplete',
        version: manifest.id,
        pages: Number(run.next_page),
        processed,
        total: manifest.total,
        stagedTerms: Number(run.staged_terms),
      };
    if (singleCopy && run.status !== 'preparing') {
      const validation = await validateSingleCopy(
        pool,
        run,
        manifest,
        now,
        Math.max(0, limit - processed),
        async () => {
          assertRunning();
          await assertLease();
        },
        control.afterPageCommit,
      );
      if (!validation.ready)
        return {
          status: 'incomplete',
          phase: 'checksum',
          version: manifest.id,
          pages: Number(run.validation_next_page ?? 0),
          processed: validation.processed,
          becameCurrent: false,
        };
    }
    if (!singleCopy && run.status !== 'preparing') {
      await pool.execute("UPDATE topic_snapshot_runs SET status='validating',next_attempt_at=NULL,updated_at=? WHERE snapshot_id=?", [
        now,
        manifest.id,
      ]);
      run.status = 'validating';
      const hash = createHash('sha256');
      let count = 0;
      let bytes = 0;
      let previous: Buffer | null = null;
      for (let index = 0; index < manifest.pages.length; index++) {
        assertRunning();
        await assertLease();
        const [[receipt]] = await pool.query<RowDataPacket[]>(
          'SELECT entries_json,sha256 FROM topic_snapshot_pages WHERE snapshot_id=? AND page_index=?',
          [manifest.id, index],
        );
        if (!receipt || typeof receipt.entries_json !== 'string') throw new InvalidSnapshot('missing-receipt');
        bytes += Buffer.byteLength(receipt.entries_json);
        const entries = JSON.parse(receipt.entries_json);
        const page = validatePage(
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
        if (JSON.stringify(page.entries) !== receipt.entries_json) throw new InvalidSnapshot('receipt-roundtrip');
        for (const term of page.entries) {
          const label = Buffer.from(term.label);
          if (previous && Buffer.compare(previous, label) >= 0) throw new InvalidSnapshot('order-or-duplicate');
          previous = label;
          const encoded = JSON.stringify(term) + '\n';
          hash.update(encoded);
          count++;
          bytes += Buffer.byteLength(encoded);
        }
      }
      const [[raw]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) n FROM topic_terms WHERE snapshot_id=?', [manifest.id]);
      if (
        count !== manifest.total ||
        count !== Number(run.staged_terms) ||
        count !== Number(raw.n) ||
        bytes !== Number(run.staged_bytes) ||
        hash.digest('hex') !== manifest.sha256
      )
        throw new InvalidSnapshot('full-checksum');
      await pool.execute("UPDATE topic_snapshot_runs SET status='preparing',updated_at=? WHERE snapshot_id=?", [now, manifest.id]);
      run.status = 'preparing';
    }
    assertRunning();
    await assertLease();
    const policy = await prepareStagedTopicPolicy(pool, manifest.id, async () => {
      assertRunning();
      await assertLease();
    });
    if (policy.status !== 'ready')
      return { status: 'incomplete', phase: 'policy', version: manifest.id, total: manifest.total, becameCurrent: false };
    assertRunning();
    await assertLease();
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const [[fresh]] = await c.query<RowDataPacket[]>(
        'SELECT *,CAST(manifest AS CHAR CHARACTER SET utf8mb4) manifest_raw,CAST(checksum_checkpoint AS CHAR CHARACTER SET utf8mb4) checkpoint_raw FROM topic_snapshot_runs WHERE snapshot_id=? FOR UPDATE',
        [manifest.id],
      );
      if (snapshotMode(fresh) !== requestedMode) throw new SnapshotModeMismatch('mode-mismatch');
      if (singleCopy) assertRunUnchanged(fresh, run, 'preparing');
      if (fresh?.status !== 'preparing') throw new InvalidSnapshot('stale-cursor');
      await c.execute("UPDATE topic_snapshots SET status='ready',synced_at=? WHERE id=? AND status='staging'", [now, manifest.id]);
      await c.execute(
        "UPDATE topic_snapshot_runs SET status='ready',next_attempt_at=NULL,error_code=NULL,updated_at=? WHERE snapshot_id=?",
        [now, manifest.id],
      );
      await assertLease();
      assertRunning();
      await c.commit();
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
    return { status: 'ready', version: manifest.id, total: manifest.total, becameCurrent: false, coverage: manifest.coverage };
  } catch (error) {
    if (error instanceof SnapshotModeMismatch)
      return { status: 'blocked', version: manifest?.id ?? run?.snapshot_id ?? null, reason: 'mode-mismatch', becameCurrent: false };
    if ((error instanceof InvalidSnapshot || error instanceof SnapshotStorageError) && error.code === 'stale-cursor')
      return { status: 'conflict', version: manifest?.id ?? run?.snapshot_id ?? null, reason: 'stale-cursor', becameCurrent: false };
    const message = error instanceof Error ? error.message : '';
    const wireFailure = snapshotWireFailureCode(error);
    const expired = /HTTP (404|410)\b/.test(message);
    const invalid =
      error instanceof InvalidSnapshot ||
      error instanceof SnapshotStorageError ||
      wireFailure !== null ||
      /^(Invalid (upstream vocabulary|vocabulary)|Vocabulary (page|snapshot))/.test(message) ||
      (error as { code?: string })?.code === 'ER_DUP_ENTRY';
    const budget = message === 'topic_upstream_budget';
    const dbTimeout = localDbTimeout(error);
    const code = dbTimeout
      ? 'local-db-timeout'
      : expired
        ? 'snapshot-expired'
        : error instanceof InvalidSnapshot || error instanceof SnapshotStorageError
          ? error.code
          : wireFailure
            ? wireFailure
            : invalid
              ? 'invalid-snapshot'
              : budget
                ? 'request-budget'
                : error instanceof TagRateLimitError
                  ? 'rate-limit'
                  : control.signal?.aborted || message.includes('deadline')
                    ? 'deadline'
                    : 'upstream-unavailable';
    const retryAt = error instanceof TagRateLimitError ? error.retryAt : new Date(now.getTime() + (budget ? 3600_000 : 300_000));
    if (run && manifest) {
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const fresh = await lockedRun(c, manifest.id);
        assertRunUnchanged(fresh, run, run.status);
        await assertLease();
        await c.execute('UPDATE topic_snapshot_runs SET status=?,next_attempt_at=?,error_code=?,updated_at=? WHERE snapshot_id=?', [
          expired || invalid ? 'failed' : run.status,
          expired || invalid ? null : retryAt,
          code,
          now,
          manifest.id,
        ]);
        if (expired || invalid)
          await c.execute("UPDATE topic_snapshots SET status='failed' WHERE id=? AND status='staging'", [manifest.id]);
        await assertLease();
        await c.commit();
      } catch (writeError) {
        await c.rollback();
        if (writeError instanceof SnapshotModeMismatch)
          return { status: 'blocked', version: manifest.id, reason: 'mode-mismatch', becameCurrent: false };
        if (writeError instanceof SnapshotStorageError && writeError.code === 'stale-cursor')
          return { status: 'conflict', version: manifest.id, reason: 'stale-cursor', becameCurrent: false };
        throw writeError;
      } finally {
        c.release();
      }
    }
    return {
      status: expired || invalid ? 'failed' : 'deferred',
      version: manifest?.id ?? null,
      reason: code,
      ...(expired || invalid ? {} : { nextAttemptAt: retryAt }),
      becameCurrent: false,
    };
  }
}
