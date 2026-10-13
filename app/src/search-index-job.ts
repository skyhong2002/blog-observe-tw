import type { Pool } from 'mysql2/promise';
import type { AdoptionEnqueue } from './search-index-adoption.ts';
import { produceBodySearchIndex } from './search-index-producer.ts';

export const SEARCH_INDEX_JOB = 'blogs-search-index';
/** Capture bounded indexed entries, never input iterators or arbitrary extra data. */
export function indexJobIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) throw Error('invalid_index_job');
  const length = raw.length;
  if (!Number.isInteger(length) || length < 1 || length > 10) throw Error('invalid_index_job');
  const ids: number[] = [];
  for (let i = 0; i < length; i++) {
    const id = raw[i];
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || ids.includes(id)) throw Error('invalid_index_job');
    ids.push(id);
  }
  return ids;
}
/** One retained pending Redis operation: timeout cannot make an uncancellable add safe to replay. */
export function createIndexJobEnqueue(
  add: (
    name: string,
    data: { postIds: number[] },
    options: { attempts: number; removeOnComplete: number; removeOnFail: number },
  ) => Promise<unknown>,
  timeoutMs = 1000,
): AdoptionEnqueue {
  let pending = false;
  return async (rawIds) => {
    const ids = indexJobIds(rawIds);
    if (pending) throw Error('index_queue_pending');
    pending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = Promise.resolve()
      .then(() => add(SEARCH_INDEX_JOB, { postIds: ids }, { attempts: 1, removeOnComplete: 100, removeOnFail: 100 }))
      .finally(() => {
        pending = false;
      });
    try {
      await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error('index_queue_unknown')), timeoutMs);
        }),
      ]);
      return { acceptedPostIds: ids };
    } catch {
      throw Error('index_queue_unknown');
    } finally {
      clearTimeout(timer);
    }
  };
}
/** Retain an unresolved NX slot after timeout. Late settlement never resumes timed-out SQL work. */
export function createIndexJobClaim(setNx: (key: string) => Promise<boolean>, timeoutMs = 1000) {
  let pending = false;
  return async (key: string): Promise<boolean> => {
    if (pending) throw Error('index_claim_pending');
    pending = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const operation = Promise.resolve()
      .then(() => setNx(key))
      .finally(() => {
        pending = false;
      });
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(Error('index_claim_unknown')), timeoutMs);
        }),
      ]);
    } catch {
      throw Error('index_claim_unknown');
    } finally {
      clearTimeout(timer);
    }
  };
}
/** Claim is persisted before any SQL. Stalled/failed claimed jobs require operator reconciliation, never replay. */
export async function runSearchIndexJob(
  pool: Pool,
  raw: unknown,
  options: {
    enabled?: boolean;
    claim: () => Promise<boolean>;
    produce?: typeof produceBodySearchIndex;
  },
) {
  if (options.enabled !== true) return { status: 'disabled' as const };
  let ids: number[];
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error();
    const data = raw as { postIds?: unknown; claimed?: unknown };
    const claimed = data.claimed;
    ids = indexJobIds(data.postIds);
    if (claimed !== undefined) return { status: 'needs-repair' as const };
  } catch {
    return { status: 'invalid' as const };
  }
  try {
    if (!(await options.claim())) return { status: 'needs-repair' as const, postIds: ids };
    // Redis NX claim has no expiry: uncertain SQL results must not be automatically replayed.
    const result = await (options.produce ?? produceBodySearchIndex)(pool, ids, true);
    return { status: 'completed' as const, result };
  } catch {
    return { status: 'needs-repair' as const, postIds: ids };
  }
}
