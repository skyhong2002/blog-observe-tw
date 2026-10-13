import type { Pool, PoolConnection } from 'mysql2/promise';
import { boundedSearchStatement } from '../search-bounds.ts';

export const TECH_READ_RESOURCES = Object.freeze({ concurrency: 2, deadlineMs: 2500, driverTimeoutMs: 500 });
const active = new WeakMap<Pool, number>();

/** No result sharing. Timed-out acquisition retains its admission slot until the pool settles. */
export async function runTechRead<T>(pool: Pool, load: (readPool: Pool) => Promise<T>): Promise<T> {
  const count = active.get(pool) ?? 0;
  if (count >= TECH_READ_RESOURCES.concurrency) throw Error('technology_busy');
  active.set(pool, count + 1);
  let connection: PoolConnection | undefined;
  let expired = false;
  let destroyed = false;
  const destroy = () => {
    if (connection && !destroyed) {
      destroyed = true;
      connection.destroy();
    }
  };
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      destroy();
      reject(Error('technology_read_timeout'));
    }, TECH_READ_RESOURCES.deadlineMs);
  });
  const work = async () => {
    try {
      connection = await pool.getConnection();
      if (expired) {
        // Pool acquisition itself cannot be cancelled. A late connection never issues SQL.
        connection.release();
        connection = undefined;
        throw Error('technology_read_timeout');
      }
      const readPool = {
        query: async (sql: string, values?: unknown[]) => {
          if (expired || destroyed) throw Error('technology_read_unavailable');
          try {
            if (typeof sql !== 'string' || !/^\s*SELECT\b/i.test(sql)) throw Error('technology_read_only');
            return await connection!.query({
              sql: boundedSearchStatement(sql, true),
              values,
              timeout: TECH_READ_RESOURCES.driverTimeoutMs,
            });
          } catch (error) {
            // Poison immediately: load may catch this error, but it cannot safely
            // retry or turn an uncertain connection into a successful fallback.
            destroy();
            throw error;
          }
        },
      } as unknown as Pool;
      const result = await load(readPool);
      if (expired || destroyed) throw Error('technology_read_unavailable');
      return result;
    } catch (error) {
      // A driver timeout alone is not SQL cancellation. Drop the owned connection,
      // including on any query failure, rather than returning it to the shared pool.
      destroy();
      throw error;
    } finally {
      if (connection && !destroyed) connection.release();
      active.set(pool, (active.get(pool) ?? 1) - 1);
    }
  };
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer!);
    // Do not clear active here: the underlying acquire/query may still be pending.
  }
}
