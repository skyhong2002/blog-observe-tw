import { createHash, randomBytes } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

// Selectively ported from tag.observe.tw afe0a65, app/src/reader/api-keys.ts.
// One gateway owns this cache. Multi-gateway deployment requires shared invalidation.
export const API_KEY_HEADER = 'x-api-key';
export const API_MAX_PER_MINUTE = 60;
export const API_KEY_MAX_PER_MINUTE = 1000;
export const API_KEYS_PER_USER = 3;
const CACHE_MS = 60_000;
const CACHE_MAX = 2000;
const TOUCH_MS = 10 * 60_000;
export const newApiKey = () => `blog_${randomBytes(24).toString('base64url')}`;
export const looksLikeKey = (value: unknown): value is string => typeof value === 'string' && /^blog_[A-Za-z0-9_-]{32}$/.test(value);
export const apiKeyHash = (key: string) => createHash('sha256').update(key).digest('hex');
export type ApiKeyMetadata = { id: number; label: string; prefix: string; createdAt: string; lastUsedAt: string | null };
export class ApiKeyError extends Error {
  readonly code: string;
  readonly statusCode: number;
  constructor(code: string, statusCode: number) {
    super(code);
    this.code = code;
    this.statusCode = statusCode;
  }
}
export function keyLabel(raw: unknown): string {
  if (raw === undefined) return '';
  if (typeof raw !== 'string' || /[\p{Cc}\p{Cf}]/u.test(raw) || [...raw.trim()].length > 80) throw new ApiKeyError('invalid_label', 400);
  return raw.trim();
}
const iso = (date: Date | string) => (date instanceof Date ? date : new Date(`${date.replace(' ', 'T')}Z`)).toISOString();
async function listKeys(db: Pool | PoolConnection, userId: number): Promise<ApiKeyMetadata[]> {
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT id,label,prefix,created_at,last_used_at FROM user_api_keys WHERE user_id=? AND revoked_at IS NULL ORDER BY id DESC',
    [userId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    label: row.label,
    prefix: row.prefix,
    createdAt: iso(row.created_at),
    lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null,
  }));
}
export function createApiKeyService(pool: Pool, now = Date.now) {
  // Separate capacities: flooding unknown digests cannot displace authenticated keys.
  const positive = new Map<string, { id: number; until: number; touched: number }>();
  const negative = new Map<string, number>();
  let generation = 0;
  return {
    isCachedValid(raw: unknown): boolean {
      if (!looksLikeKey(raw)) return false;
      const entry = positive.get(apiKeyHash(raw));
      return Boolean(entry && entry.until > now());
    },
    async identify(raw: unknown): Promise<{ id: number } | null> {
      if (!looksLikeKey(raw)) return null;
      const hash = apiKeyHash(raw);
      let hit = positive.get(hash);
      if (!hit || hit.until <= now()) {
        positive.delete(hash);
        if ((negative.get(hash) ?? 0) > now()) return null;
        negative.delete(hash);
        hit = undefined;
        // A revocation fences all older lookups. Retry once so an unrelated
        // revocation does not reject a valid cold key; continuous races fail closed.
        for (let attempt = 0; attempt < 2; attempt++) {
          const started = generation;
          const [rows] = await pool.query<RowDataPacket[]>(
            'SELECT id,last_used_at FROM user_api_keys WHERE key_hash=? AND revoked_at IS NULL LIMIT 1',
            [hash],
          );
          if (started !== generation) continue;
          if (!rows[0]) {
            if (negative.size >= CACHE_MAX) negative.delete(negative.keys().next().value!);
            negative.set(hash, now() + CACHE_MS);
            return null;
          }
          hit = {
            id: Number(rows[0].id),
            until: now() + CACHE_MS,
            touched: rows[0].last_used_at ? new Date(iso(rows[0].last_used_at)).getTime() : 0,
          };
          if (positive.size >= CACHE_MAX) positive.delete(positive.keys().next().value!);
          positive.set(hash, hit);
          break;
        }
        if (!hit) return null;
      }
      if (hit.touched <= now() - TOUCH_MS) {
        hit.touched = now();
        // This advisory timestamp must neither block requests nor log driver SQL/credentials.
        void pool
          .query('UPDATE user_api_keys SET last_used_at=UTC_TIMESTAMP() WHERE id=? AND revoked_at IS NULL', [hit.id])
          .catch(() => {});
      }
      return { id: hit.id };
    },
    list(userId: number) {
      return listKeys(pool, userId);
    },
    async create(userId: number, rawLabel?: unknown) {
      const label = keyLabel(rawLabel);
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        // Every creator locks the same existing parent row before checking quota.
        const [users] = await connection.query<RowDataPacket[]>('SELECT id FROM users WHERE id=? FOR UPDATE', [userId]);
        if (!users.length) throw new ApiKeyError('unauthorized', 401);
        const [active] = await connection.query<RowDataPacket[]>(
          'SELECT id FROM user_api_keys WHERE user_id=? AND revoked_at IS NULL FOR UPDATE',
          [userId],
        );
        if (active.length >= API_KEYS_PER_USER) throw new ApiKeyError('key_limit', 409);
        const key = newApiKey();
        await connection.query('INSERT INTO user_api_keys(user_id,key_hash,prefix,label,created_at) VALUES(?,?,?,?,UTC_TIMESTAMP())', [
          userId,
          apiKeyHash(key),
          key.slice(0, 10),
          label,
        ]);
        const keys = await listKeys(connection, userId);
        await connection.commit();
        return { key, keys, max: API_KEYS_PER_USER };
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async revoke(userId: number, id: number) {
      const [rows] = await pool.query<RowDataPacket[]>(
        'SELECT key_hash FROM user_api_keys WHERE user_id=? AND id=? AND revoked_at IS NULL',
        [userId, id],
      );
      if (!rows.length) throw new ApiKeyError('not_found', 404);
      const [result] = await pool.query<ResultSetHeader>(
        'UPDATE user_api_keys SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND id=? AND revoked_at IS NULL',
        [userId, id],
      );
      generation++;
      positive.delete(rows[0].key_hash);
      negative.delete(rows[0].key_hash);
      if (!result.affectedRows) throw new ApiKeyError('not_found', 404);
    },
  };
}
export type ApiKeyService = ReturnType<typeof createApiKeyService>;
