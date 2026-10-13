import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { reserveBudgetOnConnection } from '../jobs/budget.ts';
import type { SharedLabelLoad } from './shared-label-client.ts';
import {
  parseSharedLabelRelations,
  parseSharedLabelVisual,
  SHARED_LABEL_CONTRACT,
  SHARED_LABEL_INPUT_BYTES,
} from './shared-label-contract.ts';
export type SharedLabelKind = 'relations' | 'visual';
export const SHARED_LABEL_BATCH_DEADLINE_MS = 30000;
export const SHARED_LABEL_EXPIRY_MS = 24 * 3600_000;
export type SharedLabelData = ReturnType<typeof parseSharedLabelRelations> | ReturnType<typeof parseSharedLabelVisual>;
export type SharedLabelSnapshot = {
  status: 'ready' | 'missing' | 'unavailable';
  fetchedAt: string | null;
  expiresAt: string | null;
  sourceContractSha: string;
  payloadVersion: null;
  data?: SharedLabelData;
};
const hash = (label: string) => createHash('sha256').update(label, 'utf8').digest('hex');
const active = new WeakMap<Pool, number>();
const unavailable = (fetchedAt: string | null = null, expiresAt: string | null = null): SharedLabelSnapshot => ({
  status: 'unavailable',
  fetchedAt,
  expiresAt,
  sourceContractSha: SHARED_LABEL_CONTRACT.sourceSHA,
  payloadVersion: null,
});
const validLabel = (label: unknown): label is string =>
  typeof label === 'string' && label.length > 0 && [...label].length <= 60 && label === label.trim() && !/[\p{Cc}\p{Cs}]/u.test(label);
const parser = (kind: SharedLabelKind, value: unknown, label: string): SharedLabelData =>
  kind === 'relations' ? parseSharedLabelRelations(value, label) : parseSharedLabelVisual(value, label);

/** No cache/singleflight. Admission persists until the underlying pool acquisition settles. */
async function withSql<T>(
  pool: Pool,
  work: (query: (sql: string, values: unknown[]) => Promise<unknown>) => Promise<T>,
  deadlineMs = 1500,
): Promise<T> {
  const count = active.get(pool) ?? 0;
  if (count >= 2) throw Error('shared_label_store_unavailable');
  active.set(pool, count + 1);
  let connection: PoolConnection | undefined,
    expired = false,
    destroyed = false;
  const destroy = () => {
    if (connection && !destroyed) {
      destroyed = true;
      connection.destroy();
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      destroy();
      reject(Error('shared_label_store_unavailable'));
    }, deadlineMs);
  });
  const underlying = async () => {
    try {
      connection = await pool.getConnection();
      if (expired) {
        connection.release();
        connection = undefined;
        throw Error('shared_label_store_unavailable');
      }
      const result = await work(async (sql, values) => {
        if (expired || destroyed) throw Error('shared_label_store_unavailable');
        try {
          return await connection!.query({
            sql: /^(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql) ? `SET STATEMENT max_statement_time=0.25 FOR ${sql}` : sql,
            values,
            timeout: 500,
          });
        } catch {
          destroy();
          throw Error('shared_label_store_unavailable');
        }
      });
      if (expired || destroyed) throw Error('shared_label_store_unavailable');
      return result;
    } catch {
      destroy();
      throw Error('shared_label_store_unavailable');
    } finally {
      if (connection && !destroyed) connection.release();
      active.set(pool, (active.get(pool) ?? 1) - 1);
    }
  };
  try {
    return await Promise.race([underlying(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
export async function loadSharedLabelSnapshot(
  pool: Pool,
  label: string,
  kind: SharedLabelKind,
  now = new Date(),
): Promise<SharedLabelSnapshot> {
  if (!validLabel(label) || !['relations', 'visual'].includes(kind) || !Number.isFinite(now.getTime())) return unavailable();
  try {
    return await withSql(pool, async (query) => {
      const [rows] = (await query(
        'SELECT exact_label,status,validated_dto,fetched_at,expires_at,source_contract_sha,payload_version FROM topic_shared_label_snapshots WHERE label_hash=? AND kind=? AND BINARY exact_label=BINARY ? LIMIT 1',
        [hash(label), kind, label],
      )) as [RowDataPacket[]];
      const row = rows[0];
      if (!row) return unavailable();
      // createDb contract: UTC timezone/dateStrings:false; reject ambiguous driver strings.
      if (
        !(row.fetched_at instanceof Date) ||
        !(row.expires_at instanceof Date) ||
        !Number.isFinite(row.fetched_at.getTime()) ||
        !Number.isFinite(row.expires_at.getTime())
      )
        return unavailable();
      const fetchedAt = row.fetched_at.toISOString(),
        expiresAt = row.expires_at.toISOString();
      if (
        row.exact_label !== label ||
        row.source_contract_sha !== SHARED_LABEL_CONTRACT.sourceSHA ||
        row.payload_version !== null ||
        row.fetched_at > now ||
        row.expires_at <= now ||
        row.expires_at <= row.fetched_at ||
        row.expires_at.getTime() - row.fetched_at.getTime() > SHARED_LABEL_EXPIRY_MS
      )
        return unavailable(fetchedAt, expiresAt);
      if (row.status === 'missing' || row.status === 'unavailable') return { ...unavailable(fetchedAt, expiresAt), status: row.status };
      if (row.status !== 'ready') return unavailable(fetchedAt, expiresAt);
      const raw =
        typeof row.validated_dto === 'string'
          ? Buffer.byteLength(row.validated_dto) <= SHARED_LABEL_INPUT_BYTES
            ? JSON.parse(row.validated_dto)
            : null
          : row.validated_dto;
      return { ...unavailable(fetchedAt, expiresAt), status: 'ready', data: parser(kind, raw, label) };
    });
  } catch {
    return unavailable();
  }
}
/** Failed/missing updates clear prior data atomically; delayed older success cannot restore it. */
export async function storeSharedLabelSnapshot(
  pool: Pool,
  label: string,
  kind: SharedLabelKind,
  result: SharedLabelLoad<unknown>,
  fetchedAt = new Date(),
): Promise<boolean> {
  if (
    !validLabel(label) ||
    !['relations', 'visual'].includes(kind) ||
    !Number.isFinite(fetchedAt.getTime()) ||
    !['ready', 'missing', 'unavailable'].includes(result.status)
  )
    return false;
  let dto: SharedLabelData | null = null;
  try {
    if (result.status === 'ready') dto = parser(kind, result.data, label);
  } catch {
    result = { status: 'unavailable' };
  }
  try {
    await withSql(pool, (query) =>
      query(
        `INSERT INTO topic_shared_label_snapshots(label_hash,kind,exact_label,status,validated_dto,fetched_at,expires_at,source_contract_sha,payload_version)
      VALUES (?,?,?,?,?,?,?,?,NULL) ON DUPLICATE KEY UPDATE
      status=IF(VALUES(fetched_at)>=fetched_at,VALUES(status),status),
      validated_dto=IF(VALUES(fetched_at)>=fetched_at,VALUES(validated_dto),validated_dto),
      expires_at=IF(VALUES(fetched_at)>=fetched_at,VALUES(expires_at),expires_at),
      source_contract_sha=IF(VALUES(fetched_at)>=fetched_at,VALUES(source_contract_sha),source_contract_sha),
      payload_version=IF(VALUES(fetched_at)>=fetched_at,NULL,payload_version),
      fetched_at=GREATEST(fetched_at,VALUES(fetched_at))`,
        [
          hash(label),
          kind,
          label,
          result.status,
          dto === null ? null : JSON.stringify(dto),
          fetchedAt,
          new Date(fetchedAt.getTime() + SHARED_LABEL_EXPIRY_MS),
          SHARED_LABEL_CONTRACT.sourceSHA,
        ],
      ),
    );
    return true;
  } catch {
    return false;
  }
}

/** Global producer cooldown, not a data-version cache. Failure is null and must stop production. */
export async function loadSharedLabelCooldown(pool: Pool): Promise<number | null> {
  try {
    return await withSql(pool, async (query) => {
      const [rows] = (await query("SELECT retry_after_epoch_ms FROM shared_label_sync_control WHERE scope='tag' LIMIT 1", [])) as [
        RowDataPacket[],
      ];
      if (!rows.length) return 0;
      const value = rows[0].retry_after_epoch_ms;
      if (!(typeof value === 'number' || (typeof value === 'string' && /^\d{1,16}$/.test(value))))
        throw Error('shared_label_store_unavailable');
      const epoch = Number(value);
      if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > 8_640_000_000_000_000) throw Error('shared_label_store_unavailable');
      return epoch;
    });
  } catch {
    return null;
  }
}
export async function storeSharedLabelCooldown(pool: Pool, retryAt: number, now = new Date()): Promise<boolean> {
  if (!Number.isSafeInteger(retryAt) || retryAt < 0 || retryAt > 8_640_000_000_000_000 || !Number.isFinite(now.getTime())) return false;
  try {
    await withSql(pool, (query) =>
      query(
        "INSERT INTO shared_label_sync_control(scope,retry_after_epoch_ms,updated_at) VALUES ('tag',?,?) ON DUPLICATE KEY UPDATE retry_after_epoch_ms=GREATEST(retry_after_epoch_ms,VALUES(retry_after_epoch_ms)),updated_at=VALUES(updated_at)",
        [retryAt, now],
      ),
    );
    return true;
  } catch {
    return false;
  }
}

/** Same existing UTC work_budgets reservation, but acquisition/control statements are bounded too. */
export async function reserveSharedLabelWire(pool: Pool, now: Date, limit: number): Promise<boolean> {
  try {
    return await withSql(pool, async (query) => {
      await query('START TRANSACTION', []);
      const adapter = { query, execute: query } as unknown as PoolConnection;
      try {
        const accepted = await reserveBudgetOnConnection(adapter, [{ scope: 'shared-label:wire', amount: 1, limit }], now);
        await query('COMMIT', []);
        return accepted;
      } catch {
        await query('ROLLBACK', []);
        throw Error('shared_label_budget_unavailable');
      }
    });
  } catch {
    return false;
  }
}
/** One producer across processes. Pending acquire retains admission; 30s deadline owns only this lease connection. */
export async function withSharedLabelProducerLease<T>(
  pool: Pool,
  work: (assertLease: () => Promise<void>) => Promise<T>,
): Promise<T | null> {
  return withSql(
    pool,
    async (query) => {
      const [[held]] = (await query('SELECT GET_LOCK(?,0) held', ['blog_observe:shared-label-sync'])) as [RowDataPacket[]];
      if (Number(held?.held) !== 1) return null;
      let result: T | undefined,
        failed = false;
      try {
        result = await work(async () => {
          const [[row]] = (await query('SELECT IS_USED_LOCK(?)=CONNECTION_ID() held', ['blog_observe:shared-label-sync'])) as [
            RowDataPacket[],
          ];
          if (Number(row?.held) !== 1) throw Error('shared_label_lease_unavailable');
        });
      } catch {
        failed = true;
      }
      const [[released]] = (await query('SELECT RELEASE_LOCK(?) released', ['blog_observe:shared-label-sync'])) as [RowDataPacket[]];
      if (failed || Number(released?.released) !== 1) throw Error('shared_label_lease_unavailable');
      return result as T;
    },
    SHARED_LABEL_BATCH_DEADLINE_MS,
  );
}
