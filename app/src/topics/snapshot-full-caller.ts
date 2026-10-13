import type { Pool, RowDataPacket } from 'mysql2/promise';
import { reserveBudget } from '../jobs/budget.ts';
import { withJobLease } from '../jobs/lease.ts';
import type { SnapshotSource } from './snapshot-client.ts';
import { importSnapshot } from './snapshot-import.ts';
import { LARGE_SNAPSHOT_CONTRACT, LargeSnapshotSource } from './snapshot-large-source.ts';

export const FULL_WIRE_ACCOUNTING = 'transport-before-wire-v1' as const;
export type FullSnapshotOptions = {
  enabled?: boolean;
  sourceMode?: 'large5000';
  largeContract?: typeof LARGE_SNAPSHOT_CONTRACT;
  payloadMode?: 'single-copy-v1';
  maxPages?: number;
  maxDurationMs?: number;
  signal?: AbortSignal;
  now?: () => Date;
  sourceFactory?: {
    accounting: typeof FULL_WIRE_ACCOUNTING;
    create: (controls: { signal: AbortSignal; deadline: number; beforeRequest: () => Promise<void> }) => SnapshotSource;
  };
};
/** Outer and nested constraints both apply; minima win, either invalid bound remains invalid. */
export function inheritFullControls(
  full: FullSnapshotOptions | undefined,
  outer: Pick<FullSnapshotOptions, 'signal' | 'maxDurationMs' | 'maxPages' | 'now'>,
): FullSnapshotOptions {
  const minBound = (a: number | undefined, b: number | undefined) => {
    if (a !== undefined && (!Number.isSafeInteger(a) || a < 1)) return a;
    if (b !== undefined && (!Number.isSafeInteger(b) || b < 1)) return b;
    return a === undefined ? b : b === undefined ? a : Math.min(a, b);
  };
  return {
    ...full,
    signal: outer.signal && full?.signal ? AbortSignal.any([outer.signal, full.signal]) : (outer.signal ?? full?.signal),
    maxDurationMs: minBound(outer.maxDurationMs, full?.maxDurationMs),
    maxPages: minBound(outer.maxPages, full?.maxPages),
    now: outer.now ?? full?.now,
  };
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const dependencies = { reserveBudget, withJobLease, importSnapshot };
/** Explicit offline-admitted caller. Ready is never publication; worker scheduling is unchanged. */
export async function runFullSnapshot(pool: Pool, options: FullSnapshotOptions = {}, deps = dependencies) {
  if (options.enabled !== true) return { status: 'disabled', becameCurrent: false };
  if (
    options.sourceMode !== 'large5000' ||
    options.largeContract !== LARGE_SNAPSHOT_CONTRACT ||
    options.payloadMode !== 'single-copy-v1' ||
    (options.sourceFactory &&
      (options.sourceFactory.accounting !== FULL_WIRE_ACCOUNTING || typeof options.sourceFactory.create !== 'function'))
  )
    return { status: 'blocked', reason: 'full-contract-required', becameCurrent: false };
  if ([options.maxPages, options.maxDurationMs].some((v) => v !== undefined && (!Number.isSafeInteger(v) || v < 1)))
    return { status: 'blocked', reason: 'invalid-bounds', becameCurrent: false };
  const started = Date.now();
  const duration = Math.min(600_000, Math.max(1, options.maxDurationMs ?? 120_000));
  const deadline = started + duration;
  const signal = AbortSignal.any([AbortSignal.timeout(duration), ...(options.signal ? [options.signal] : [])]);
  try {
    return (
      (await deps.withJobLease(pool, 'topics', async (assertLease) => {
        const guard = async () => {
          signal.throwIfAborted();
          if (Date.now() >= deadline) throw Error('full deadline');
          await assertLease();
          signal.throwIfAborted();
          if (Date.now() >= deadline) throw Error('full deadline');
        };
        await guard();
        const [[ready]] = await pool.query<RowDataPacket[]>(
          "SELECT r.snapshot_id FROM topic_snapshot_runs r JOIN topic_snapshots s ON s.id=r.snapshot_id WHERE r.status='ready' AND s.status='ready' AND JSON_UNQUOTE(JSON_EXTRACT(s.manifest,'$.coverage'))='all-current-indexed-article-tags' LIMIT 1",
        );
        if (ready && !uuid.test(String(ready.snapshot_id)))
          return { status: 'failed', reason: 'invalid-ready-identity', becameCurrent: false };
        if (ready) return { status: 'ready-pending-publication', version: String(ready.snapshot_id), becameCurrent: false };
        const beforeRequest = async () => {
          await guard();
          // Same counter as window; full stops at 504, leaving 96 of the existing 600 slots.
          if (
            !(await deps.reserveBudget(pool, [{ scope: 'topics:upstream-requests', amount: 1, limit: 504 }], options.now?.() ?? new Date()))
          )
            throw Error('topic_upstream_budget');
          await guard();
        };
        const source = options.sourceFactory
          ? options.sourceFactory.create({ signal, deadline, beforeRequest })
          : new LargeSnapshotSource(fetch, { enabled: true, largeContract: LARGE_SNAPSHOT_CONTRACT, signal, deadline, beforeRequest });
        const result = await deps.importSnapshot(
          pool,
          source,
          options.now?.() ?? new Date(),
          guard,
          Math.min(50, Math.max(1, options.maxPages ?? 10)),
          {
            signal,
            deadline,
            payloadMode: 'single-copy-v1',
            beforeStart: async () => {
              await guard();
              return deps.reserveBudget(pool, [{ scope: 'topics:full-sync', amount: 1, limit: 1 }], options.now?.() ?? new Date());
            },
            // No importer logical-page accounting: transport charges each actual retry/fallback wire.
          },
        );
        const raw = result as Record<string, unknown>;
        const statuses = new Set(['blocked', 'deferred', 'failed', 'conflict', 'budget', 'incomplete', 'ready']);
        const reasons = new Set([
          'mode-mismatch',
          'unsupported-database',
          'stale-cursor',
          'local-db-timeout',
          'wire-byte-cap',
          'wire-invalid-json',
          'upstream-unavailable',
          'page-byte-cap',
          'checkpoint-invalid',
          'checkpoint-continuity',
          'page-checksum',
          'page-index-gap',
          'manifest-roundtrip',
          'payload-roundtrip',
          'local-db-unavailable',
          'request-budget',
          'rate-limit',
          'snapshot-expired',
          'deadline',
          'invalid-snapshot',
          'manifest-changed',
          'snapshot-id-reused',
          'order-or-duplicate',
          'receipt-cap',
          'cap-bytes',
          'missing-receipt',
          'receipt-roundtrip',
          'full-checksum',
        ]);
        return {
          status: typeof raw.status === 'string' && statuses.has(raw.status) ? raw.status : 'failed',
          ...(typeof raw.version === 'string' && uuid.test(raw.version) ? { version: raw.version } : {}),
          ...(typeof raw.phase === 'string' && ['checksum', 'policy'].includes(raw.phase)
            ? { phase: raw.phase }
            : raw.status === 'incomplete' && raw.phase === undefined && Number.isSafeInteger(raw.pages)
              ? { phase: 'scanning' }
              : {}),
          ...(raw.reason !== undefined
            ? { reason: typeof raw.reason === 'string' && reasons.has(raw.reason) ? raw.reason : 'unknown' }
            : {}),
          ...(Number.isSafeInteger(raw.pages) && Number(raw.pages) >= 0 && Number(raw.pages) <= 20_000
            ? { nextPage: Number(raw.pages) }
            : {}),
          ...(Number.isSafeInteger(raw.processed) && Number(raw.processed) >= 0 && Number(raw.processed) <= 50
            ? { processed: Number(raw.processed) }
            : {}),
          ...(raw.nextAttemptAt instanceof Date && Number.isFinite(raw.nextAttemptAt.getTime())
            ? { nextAttemptAt: raw.nextAttemptAt.toISOString() }
            : {}),
          becameCurrent: false,
        };
      })) ?? { status: 'busy', becameCurrent: false }
    );
  } catch {
    return { status: 'deferred', reason: 'full-operation-unavailable', becameCurrent: false };
  }
}
