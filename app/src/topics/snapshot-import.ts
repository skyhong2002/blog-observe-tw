import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { storedNormalizedLabel } from './policy.ts';
import { prepareStagedTopicPolicy } from './policy-store.ts';
import { type ExportManifest, MAX_SNAPSHOT_BYTES, type SnapshotSource, validateManifest, validatePage } from './snapshot-client.ts';
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
};
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
  assertRunning();
  const [[active]] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM topic_snapshot_runs WHERE status IN ('scanning','validating','preparing') ORDER BY created_at LIMIT 1",
  );
  if (active?.next_attempt_at && new Date(active.next_attempt_at).getTime() > now.getTime())
    return { status: 'deferred', version: active.snapshot_id, nextAttemptAt: active.next_attempt_at };
  let run = active;
  let manifest: ExportManifest | undefined;
  let phase = 'manifest';
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
        await c.execute("INSERT INTO topic_snapshot_runs(snapshot_id,manifest,status,created_at,updated_at) VALUES (?,?,'scanning',?,?)", [
          manifest.id,
          JSON.stringify(manifest),
          now,
          now,
        ]);
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
      } as RowDataPacket;
    }
    phase = 'pages';
    const limit = Math.min(50, Math.max(1, Math.floor(maxPages)));
    while (Number(run.next_page) < manifest.pages.length && processed < limit) {
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
      const receipt = JSON.stringify(page.entries);
      bytes += Buffer.byteLength(receipt);
      if (Number(run.staged_bytes) + bytes > MAX_SNAPSHOT_BYTES) throw new InvalidSnapshot('cap-bytes');
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [[fresh]] = await c.query<RowDataPacket[]>(
          'SELECT next_page,status,staged_terms,staged_bytes FROM topic_snapshot_runs WHERE snapshot_id=? FOR UPDATE',
          [manifest.id],
        );
        if (
          fresh?.status !== 'scanning' ||
          Number(fresh.next_page) !== index ||
          Number(fresh.staged_terms) !== Number(run.staged_terms) ||
          Number(fresh.staged_bytes) !== Number(run.staged_bytes)
        )
          throw new InvalidSnapshot('stale-cursor');
        if (page.entries.length)
          await c.query('INSERT INTO topic_terms(snapshot_id,id,label,normalized_label,payload) VALUES ?', [
            page.entries.map((t) => [manifest!.id, t.id, t.label, storedNormalizedLabel(t.label), JSON.stringify(t)]),
          ]);
        await c.execute('INSERT INTO topic_snapshot_pages(snapshot_id,page_index,entries_json,sha256) VALUES (?,?,?,?)', [
          manifest.id,
          index,
          receipt,
          page.sha256,
        ]);
        await c.execute(
          'UPDATE topic_snapshot_runs SET next_page=?,staged_terms=staged_terms+?,staged_bytes=staged_bytes+?,last_label=?,updated_at=?,next_attempt_at=NULL,error_code=NULL WHERE snapshot_id=?',
          [index + 1, page.entries.length, bytes, page.entries.at(-1)?.label ?? run.last_label, now, manifest.id],
        );
        await assertLease();
        await c.commit();
        run.next_page = index + 1;
        run.staged_terms = Number(run.staged_terms) + page.entries.length;
        run.staged_bytes = Number(run.staged_bytes) + bytes;
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
    if (run.status !== 'preparing') {
      phase = 'checksum';
      await pool.execute("UPDATE topic_snapshot_runs SET status='validating',next_attempt_at=NULL,updated_at=? WHERE snapshot_id=?", [
        now,
        manifest.id,
      ]);
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
    phase = 'policy';
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
      const [[fresh]] = await c.query<RowDataPacket[]>('SELECT status FROM topic_snapshot_runs WHERE snapshot_id=? FOR UPDATE', [
        manifest.id,
      ]);
      if (fresh?.status !== 'preparing') throw new InvalidSnapshot('stale-cursor');
      await c.execute("UPDATE topic_snapshots SET status='ready',synced_at=? WHERE id=? AND status='staging'", [now, manifest.id]);
      await c.execute(
        "UPDATE topic_snapshot_runs SET status='ready',next_attempt_at=NULL,error_code=NULL,updated_at=? WHERE snapshot_id=?",
        [now, manifest.id],
      );
      await assertLease();
      await c.commit();
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
    return { status: 'ready', version: manifest.id, total: manifest.total, becameCurrent: false, coverage: manifest.coverage };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const expired = /HTTP (404|410)\b/.test(message);
    const invalid =
      error instanceof InvalidSnapshot ||
      /^(Invalid (upstream vocabulary|vocabulary)|Vocabulary (page|snapshot))/.test(message) ||
      (error as { code?: string })?.code === 'ER_DUP_ENTRY';
    const budget = message === 'topic_upstream_budget';
    const code = expired
      ? 'snapshot-expired'
      : error instanceof InvalidSnapshot
        ? error.code
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
      await assertLease();
      await pool.execute('UPDATE topic_snapshot_runs SET status=?,next_attempt_at=?,error_code=?,updated_at=? WHERE snapshot_id=?', [
        expired || invalid
          ? 'failed'
          : run.status === 'scanning' && phase === 'pages'
            ? 'scanning'
            : phase === 'checksum'
              ? 'validating'
              : phase === 'policy'
                ? 'preparing'
                : run.status,
        expired || invalid ? null : retryAt,
        code,
        now,
        manifest.id,
      ]);
      if (expired || invalid)
        await pool.execute("UPDATE topic_snapshots SET status='failed' WHERE id=? AND status='staging'", [manifest.id]);
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
