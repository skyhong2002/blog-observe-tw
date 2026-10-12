import type { Pool, RowDataPacket } from 'mysql2/promise';
/** One dedicated connection; work must use a pool of at least two connections. */
export async function withJobLease<T>(pool: Pool, name: string, work: (assertLease: () => Promise<void>) => Promise<T>): Promise<T | null> {
  if (!/^[a-z0-9:_-]{1,40}$/.test(name)) throw Error('invalid job lease');
  if ((pool as unknown as { pool?: { config?: { connectionLimit?: number } } }).pool?.config?.connectionLimit === 1)
    throw Error('job lease requires poolSize >= 2');
  const key = `blog_observe:${name}`;
  const c = await pool.getConnection();
  let held = false;
  let destroyed = false;
  const assertLease = async () => {
    const [[r]] = await c.query<RowDataPacket[]>('SELECT IS_USED_LOCK(?)=CONNECTION_ID() held', [key]);
    if (Number(r?.held) !== 1) throw Error('job lease lost');
  };
  try {
    const [[r]] = await c.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) held', [key]);
    if (Number(r?.held) !== 1) return null;
    held = true;
    return await work(assertLease);
  } finally {
    if (held) {
      try {
        const [[r]] = await c.query<RowDataPacket[]>('SELECT RELEASE_LOCK(?) released', [key]);
        if (Number(r?.released) !== 1) {
          destroyed = true;
          c.destroy();
        }
      } catch {
        destroyed = true;
        c.destroy();
      }
    }
    if (!destroyed) c.release();
  }
}
