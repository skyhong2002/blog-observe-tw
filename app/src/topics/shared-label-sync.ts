import type { Pool } from 'mysql2/promise';
import { SharedLabelClient, type SharedLabelLoad } from './shared-label-client.ts';
import {
  loadSharedLabelCooldown,
  reserveSharedLabelWire,
  SHARED_LABEL_BATCH_DEADLINE_MS,
  type SharedLabelKind,
  storeSharedLabelCooldown,
  storeSharedLabelSnapshot,
  withSharedLabelProducerLease,
} from './shared-label-store.ts';
import type { TagTransportOptions } from './transport.ts';
export type SharedLabelSyncClient = Pick<SharedLabelClient, 'relations' | 'visual'>;
export type SharedLabelSyncDependencies = {
  /** Root must verify exact labels against CURRENT public blog-topic evidence; a selection file is not proof. */
  validatePublicLabel?: (label: string) => Promise<boolean>;
  makeClient: (hooks: TagTransportOptions) => SharedLabelSyncClient;
  write?: typeof storeSharedLabelSnapshot;
  readCooldown?: () => Promise<number | null>;
  writeCooldown?: (retryAt: number, now: Date) => Promise<boolean>;
  reserveWire?: (now: Date, limit: number) => Promise<boolean>;
  lease?: (work: (assertLease: () => Promise<void>) => Promise<SharedLabelSyncBatch>) => Promise<SharedLabelSyncBatch | null>;
};
export type SharedLabelSyncBatch = {
  mode: 'dry-run' | 'disabled' | 'apply' | 'busy';
  selected: number;
  completedKinds: number;
  skipped: number;
  stopped: boolean;
  stopReason: 'none' | 'rate-limit' | 'cooldown' | 'budget' | 'store' | 'lease' | 'deadline';
};
/** Background-only. One reusable client per leased batch, <=10 root-selected exact words, no auto-discovery. */
export async function syncSharedLabels(
  pool: Pool,
  selection: readonly string[],
  dependencies: SharedLabelSyncDependencies,
  options: { apply?: boolean; enabled?: boolean; dailyLimit?: number; now?: () => Date } = {},
): Promise<SharedLabelSyncBatch> {
  if (
    selection.length > 10 ||
    new Set(selection).size !== selection.length ||
    selection.some(
      (label) => typeof label !== 'string' || !label || [...label].length > 60 || label !== label.trim() || /[\p{Cc}\p{Cs}]/u.test(label),
    )
  )
    throw Error('invalid_shared_label_selection');
  const empty = (mode: SharedLabelSyncBatch['mode']): SharedLabelSyncBatch => ({
    mode,
    selected: selection.length,
    completedKinds: 0,
    skipped: 0,
    stopped: false,
    stopReason: 'none',
  });
  if (!options.apply) return empty('dry-run');
  if (!options.enabled) return empty('disabled');
  if (!dependencies.validatePublicLabel) throw Error('shared_label_public_validator_required');
  const limit = options.dailyLimit ?? 40;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw Error('invalid_shared_label_wire_budget');
  const now = options.now ?? (() => new Date()),
    write = dependencies.write ?? storeSharedLabelSnapshot;
  const reserve = dependencies.reserveWire ?? ((date: Date, dailyLimit: number) => reserveSharedLabelWire(pool, date, dailyLimit));
  const lease = dependencies.lease ?? ((work) => withSharedLabelProducerLease(pool, work));
  const batch = empty('apply');
  const startedAt = now().getTime();
  if (!Number.isFinite(startedAt)) throw Error('shared_label_clock_invalid');
  const batchDeadline = startedAt + SHARED_LABEL_BATCH_DEADLINE_MS;
  let result: SharedLabelSyncBatch | null;
  try {
    result = await lease(async (assertLease) => {
      const readCooldown = dependencies.readCooldown ?? (() => loadSharedLabelCooldown(pool));
      const writeCooldown = dependencies.writeCooldown ?? ((retryAt: number, date: Date) => storeSharedLabelCooldown(pool, retryAt, date));
      const priorCooldown = await readCooldown();
      if (priorCooldown === null || priorCooldown > now().getTime()) return { ...batch, stopped: true, stopReason: 'cooldown' as const };
      let currentLabel: string | undefined;
      let lastDate = -Infinity;
      const captureTime = () => {
        const date = now();
        if (!Number.isFinite(date.getTime()) || date.getTime() < lastDate) throw Error('shared_label_clock_invalid');
        lastDate = date.getTime();
        return date;
      };
      const canStart = () => {
        if (batch.stopped) return false;
        if (captureTime().getTime() >= batchDeadline) {
          batch.stopped = true;
          batch.stopReason = 'deadline';
          return false;
        }
        return true;
      };
      const client = dependencies.makeClient({
        now: () => captureTime().getTime(),
        deadline: batchDeadline,
        beforeRequest: async () => {
          if (!canStart()) throw Error('shared_label_batch_stopped');
          const retryAt = await readCooldown();
          if (retryAt === null || retryAt > captureTime().getTime()) {
            batch.stopped = true;
            batch.stopReason = 'cooldown';
            throw Error('shared_label_rate_deferred');
          }
          if (!currentLabel || !(await dependencies.validatePublicLabel!(currentLabel))) throw Error('shared_label_not_public');
          try {
            await assertLease();
          } catch {
            batch.stopped = true;
            batch.stopReason = 'lease';
            throw Error('shared_label_lease_unavailable');
          }
          if (!(await reserve(captureTime(), limit))) {
            batch.stopped = true;
            batch.stopReason = 'budget';
            throw Error('shared_label_budget_unavailable');
          }
          if (!canStart()) throw Error('shared_label_batch_stopped');
        },
        onRateLimit: async (retryAt) => {
          batch.stopped = true;
          batch.stopReason = 'rate-limit';
          if (!(await writeCooldown(retryAt.getTime(), captureTime()))) batch.stopReason = 'store';
          // Stop even a short 429 without sleeping/retrying this producer batch.
          throw Error('shared_label_rate_deferred');
        },
      });
      for (const label of selection) {
        currentLabel = label;
        if (!canStart()) break;
        if (!(await dependencies.validatePublicLabel!(label))) {
          batch.skipped++;
          continue;
        }
        for (const kind of ['relations', 'visual'] as SharedLabelKind[]) {
          if (!canStart()) break;
          await assertLease();
          if (!canStart()) break;
          // Persist unavailable BEFORE I/O. Crashes/final write failure cannot resurrect an old ready snapshot.
          if (!(await write(pool, label, kind, { status: 'unavailable' }, captureTime()))) {
            batch.stopped = true;
            batch.stopReason = 'store';
            break;
          }
          let load: SharedLabelLoad<unknown>;
          try {
            load = await client[kind](label);
          } catch {
            load = { status: 'unavailable' };
          }
          if (!canStart() && batch.stopReason === 'deadline') load = { status: 'unavailable' };
          // Recheck publication evidence after I/O too; root selector may now reject a withdrawn source.
          if (!(await dependencies.validatePublicLabel!(label))) load = { status: 'unavailable' };
          await assertLease();
          if (!(await write(pool, label, kind, load, captureTime()))) {
            batch.stopped = true;
            batch.stopReason = 'store';
            break;
          }
          batch.completedKinds++;
        }
      }
      return batch;
    });
  } catch {
    batch.stopped = true;
    batch.stopReason = now().getTime() >= batchDeadline ? 'deadline' : 'lease';
    return batch;
  }
  return result ?? empty('busy');
}
/** The production factory still requires injected fetcher; never call this from a page request. */
export const sharedLabelSyncClientFactory =
  (fetcher: typeof fetch, options: TagTransportOptions = {}) =>
  (hooks: TagTransportOptions) =>
    new SharedLabelClient(fetcher, { ...options, ...hooks });

/** CLI must not report storage/lease faults (or deadline cancellation) as successful production. */
export function sharedLabelSyncExitCode(batch: Pick<SharedLabelSyncBatch, 'stopped' | 'stopReason'>): 0 | 1 {
  return batch.stopped && ['store', 'lease', 'deadline'].includes(batch.stopReason) ? 1 : 0;
}
