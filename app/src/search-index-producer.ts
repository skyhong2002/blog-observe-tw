import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { BODY_INDEX_BYTES, BODY_INDEX_VERSION, bodySearchOwner, buildBodySearchIndex } from './search-body-index.ts';
import { boundedSearchStatement } from './search-bounds.ts';
export function searchIndexPostIds(raw: unknown): number[] {
  if (
    !Array.isArray(raw) ||
    raw.length < 1 ||
    raw.length > 10 ||
    raw.some((x) => !Number.isSafeInteger(x) || x < 1) ||
    new Set(raw).size !== raw.length
  )
    throw Error('invalid_search_index_selection');
  return raw;
}
export async function produceBodySearchIndex(pool: Pool, rawIds: unknown, apply = false) {
  const ids = searchIndexPostIds(rawIds),
    items = [];
  for (const postId of ids) {
    let c: PoolConnection | undefined,
      acquiring = true;
    let timedOut = false;
    let acquireTimer: ReturnType<typeof setTimeout> | undefined;
    // Pending acquisitions retain their eventual connection cleanup; no application SQL after timeout.
    const pending = pool.getConnection().then((connection) => {
      acquiring = false;
      if (timedOut) {
        connection.destroy();
        throw Error('search_index_acquire_timeout');
      }
      return connection;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      c?.destroy();
    }, 5000);
    try {
      c = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          acquireTimer = setTimeout(() => {
            if (acquiring) {
              timedOut = true;
              reject(Error('search_index_acquire_timeout'));
            }
          }, 500);
          acquireTimer.unref();
        }),
      ]);
      clearTimeout(acquireTimer);
      if (apply) await c.beginTransaction();
      const [[row]] = await c.query<RowDataPacket[]>(
        {
          sql: boundedSearchStatement(
            `SELECT p.id,p.url,p.blog_id,b.url blog_url,c.source_url,c.article_url,c.content_hash,c.status,
          SUBSTRING(CAST(c.body_text AS BINARY),1,${BODY_INDEX_BYTES + 1}) body_bytes
         FROM posts p JOIN blogs b ON b.id=p.blog_id JOIN content_post_bodies c ON c.post_id=p.id
         WHERE p.id=? AND b.status='verified' AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
         AND c.status='ok' AND c.blog_id=p.blog_id AND c.obtained_at<=UTC_TIMESTAMP() ${apply ? 'FOR UPDATE' : ''}`,
            true,
          ),
          timeout: 500,
        },
        [postId],
      );
      // Explicit apply invalidates only this selected post's derived rows, including missing/invalid evidence.
      // Keep deletion and any replacement in the same transaction. Dry-run never mutates the index.
      if (apply)
        await c.query({ sql: boundedSearchStatement('DELETE FROM post_body_search_terms WHERE post_id=?', true), timeout: 500 }, [postId]);
      let status = 'unindexed';
      if (
        row &&
        typeof row.content_hash === 'string' &&
        /^[a-f0-9]{64}$/.test(row.content_hash) &&
        [row.source_url, row.article_url, row.url].every((url) => bodySearchOwner(url, row.blog_url))
      ) {
        const bytes = Buffer.isBuffer(row.body_bytes) ? row.body_bytes : Buffer.from(row.body_bytes ?? '', 'utf8');
        if (bytes.length > BODY_INDEX_BYTES) status = 'overcap';
        else {
          let text: string | undefined;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          } catch {
            status = 'invalid-utf8';
          }
          const built = text === undefined ? null : buildBodySearchIndex(text);
          if (built?.status === 'ready') {
            status = built.grams.length ? (apply ? 'stored' : 'dry-run') : 'short-body';
            if (apply) {
              for (let start = 0; start < built.grams.length; start += 128) {
                if (timedOut) throw Error('search_index_deadline');
                const values = built.grams
                  .slice(start, start + 128)
                  .map((gram) => [
                    gram,
                    postId,
                    row.content_hash,
                    built.textHash,
                    built.prefixCharacters,
                    built.truncated,
                    BODY_INDEX_VERSION,
                  ]);
                await c.query(
                  {
                    sql: boundedSearchStatement(
                      'INSERT INTO post_body_search_terms(gram_hash,post_id,content_hash,body_text_hash,prefix_characters,prefix_truncated,index_version) VALUES ?',
                      true,
                    ),
                    timeout: 500,
                  },
                  [values],
                );
              }
            }
            items.push({ postId, status, grams: built.grams.length, prefixCharacters: built.prefixCharacters, truncated: built.truncated });
          } else if (built) status = 'overcap';
        }
      }
      if (!items.some((item) => item.postId === postId)) items.push({ postId, status });
      if (timedOut) throw Error('search_index_deadline');
      if (apply) await c.commit();
    } catch {
      if (c && !timedOut) {
        try {
          await c.rollback();
        } catch {
          c.destroy();
          c = undefined;
        }
      }
      throw Error('search_index_unavailable');
    } finally {
      clearTimeout(acquireTimer);
      clearTimeout(timer);
      if (c && !timedOut) c.release();
    }
  }
  return { mode: apply ? 'apply' : 'dry-run', indexVersion: BODY_INDEX_VERSION, exhaustive: false, items };
}
