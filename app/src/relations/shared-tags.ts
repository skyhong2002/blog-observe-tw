/** Native publisher/manual post tags only. Shared tags are not citation, dialogue or text similarity. */
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

export const SHARED_TAG_MATCH_VERSION = 'native-post-tags-v1';
export const SHARED_TAG_LIMITS = Object.freeze({ sourceTags: 30, results: 100, admissions: 2, deadlineMs: 1500, driverMs: 500 });
const admissions = new WeakMap<Pool, number>();
const safeError = () => Error('shared_tags_unavailable');
const statement = (sql: string) => `SET STATEMENT max_statement_time=0.25 FOR ${sql}`;

/** Admission belongs to underlying work, including acquisition after the caller deadline. */
async function withRead<T>(
  pool: Pool,
  read: (query: (sql: string, values: unknown[]) => Promise<RowDataPacket[]>) => Promise<T>,
): Promise<T> {
  const active = admissions.get(pool) ?? 0;
  if (active >= SHARED_TAG_LIMITS.admissions) throw safeError();
  admissions.set(pool, active + 1);
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
      reject(safeError());
    }, SHARED_TAG_LIMITS.deadlineMs);
  });
  const work = async () => {
    try {
      connection = await pool.getConnection();
      if (expired) {
        connection.release();
        connection = undefined;
        throw safeError();
      }
      return await read(async (sql, values) => {
        if (expired) throw safeError();
        const [rows] = await connection!.query<RowDataPacket[]>({ sql: statement(sql), values, timeout: SHARED_TAG_LIMITS.driverMs });
        if (expired) throw safeError();
        return rows;
      });
    } catch {
      destroy();
      throw safeError();
    } finally {
      if (connection && !destroyed) connection.release();
      admissions.set(pool, (admissions.get(pool) ?? 1) - 1);
    }
  };
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
const date = (v: unknown) => {
  const d = new Date(v as string | Date);
  if (!Number.isFinite(d.getTime())) throw safeError();
  return d.toISOString();
};
const id = (v: unknown) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1) throw safeError();
  return n;
};
const text = (v: unknown) => {
  if (typeof v !== 'string') throw safeError();
  return v;
};
const articleUrl = (value: unknown) => {
  const raw = text(value),
    url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw safeError();
  return raw;
};
export type SharedTagHit = {
  sourceArticleId: number;
  sourceArticleUrl: string;
  sourceArticleTitle: string;
  sourceArticlePublishedAt: string;
  targetArticleUrl: string;
  targetArticleTitle: string;
  targetArticlePublishedAt: string;
  targetBlogSlug: string;
  targetBlogName: string;
  targetArticleId: number;
  targetBlogId: number;
  tagId: number;
  label: string;
  sourceType: string;
  lastSeenAt: string;
  targetSourceType: string;
  targetLastSeenAt: string;
  tagSourceType: string;
  tagLastSeenAt: string;
  matchVersion: typeof SHARED_TAG_MATCH_VERSION;
};
export type SharedTagsResult =
  | {
      status: 'ready';
      days: 7 | 30 | 90;
      items: SharedTagHit[];
      truncated: boolean;
      sourceTagsTruncated: boolean;
      matchVersion: typeof SHARED_TAG_MATCH_VERSION;
      interpretation: string;
    }
  | { status: 'unavailable'; matchVersion: typeof SHARED_TAG_MATCH_VERSION };

export async function loadSharedTags(pool: Pool, input: { sourceBlogId: number; days: 7 | 30 | 90 }): Promise<SharedTagsResult> {
  if (!Number.isSafeInteger(input.sourceBlogId) || input.sourceBlogId < 1 || ![7, 30, 90].includes(input.days))
    throw Error('invalid_shared_tags_query');
  try {
    return await withRead<SharedTagsResult>(pool, async (query) => {
      // One deterministic representative source article per tag; never call MAX(id) the latest publication.
      const source = await query(
        `SELECT st.tag_id,MAX(sp.id) source_article_id
        FROM posts sp JOIN blogs sb ON sb.id=sp.blog_id AND sb.status='verified'
        JOIN post_tags st ON st.post_id=sp.id AND st.status='active'
        JOIN tags t ON t.id=st.tag_id AND t.visibility='public' AND t.status='active'
        WHERE sp.blog_id=? AND sp.published_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY) AND sp.published_at<=UTC_TIMESTAMP()
        GROUP BY st.tag_id ORDER BY st.tag_id LIMIT 31`,
        [input.sourceBlogId, input.days],
      );
      if (source.length > 31) throw safeError();
      const chosen = source.slice(0, SHARED_TAG_LIMITS.sourceTags);
      const rows = chosen.length
        ? await query(
            `SELECT sp.id source_article_id,tp.id target_article_id,tp.blog_id target_blog_id,t.id tag_id,t.label,
          sp.url source_article_url,LEFT(sp.title,240) source_article_title,sp.published_at source_article_published_at,
          tp.url target_article_url,LEFT(tp.title,240) target_article_title,tp.published_at target_article_published_at,
          tb.slug target_blog_slug,tb.name target_blog_name,
          st.source_type,st.last_seen_at,tt.source_type target_source_type,tt.last_seen_at target_last_seen_at,
          t.source_type tag_source_type,t.last_seen_at tag_last_seen_at
        FROM (${chosen.map(() => 'SELECT ? tag_id,? source_article_id').join(' UNION ALL ')}) chosen
        JOIN posts sp ON sp.id=chosen.source_article_id AND sp.blog_id=?
        JOIN blogs sb ON sb.id=sp.blog_id AND sb.status='verified'
        JOIN post_tags st ON st.post_id=sp.id AND st.tag_id=chosen.tag_id AND st.status='active'
        JOIN tags t ON t.id=st.tag_id AND t.visibility='public' AND t.status='active'
        JOIN post_tags tt ON tt.tag_id=t.id AND tt.status='active'
        JOIN posts tp ON tp.id=tt.post_id AND tp.blog_id<>sp.blog_id
        JOIN blogs tb ON tb.id=tp.blog_id AND tb.status='verified'
        WHERE sp.published_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY) AND sp.published_at<=UTC_TIMESTAMP()
          AND tp.published_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL ? DAY) AND tp.published_at<=UTC_TIMESTAMP()
        ORDER BY tp.id DESC,t.id,sp.id LIMIT 101`,
            [...chosen.flatMap((r) => [id(r.tag_id), id(r.source_article_id)]), input.sourceBlogId, input.days, input.days],
          )
        : [];
      if (rows.length > 101) throw safeError();
      const items: SharedTagHit[] = rows.slice(0, SHARED_TAG_LIMITS.results).map((r) => ({
        sourceArticleId: id(r.source_article_id),
        sourceArticleUrl: articleUrl(r.source_article_url),
        sourceArticleTitle: text(r.source_article_title),
        sourceArticlePublishedAt: date(r.source_article_published_at),
        targetArticleUrl: articleUrl(r.target_article_url),
        targetArticleTitle: text(r.target_article_title),
        targetArticlePublishedAt: date(r.target_article_published_at),
        targetBlogSlug: text(r.target_blog_slug),
        targetBlogName: text(r.target_blog_name),
        targetArticleId: id(r.target_article_id),
        targetBlogId: id(r.target_blog_id),
        tagId: id(r.tag_id),
        label: text(r.label),
        sourceType: text(r.source_type),
        lastSeenAt: date(r.last_seen_at),
        targetSourceType: text(r.target_source_type),
        targetLastSeenAt: date(r.target_last_seen_at),
        tagSourceType: text(r.tag_source_type),
        tagLastSeenAt: date(r.tag_last_seen_at),
        matchVersion: SHARED_TAG_MATCH_VERSION,
      }));
      return {
        status: 'ready' as const,
        days: input.days,
        items,
        truncated: rows.length > SHARED_TAG_LIMITS.results || source.length > SHARED_TAG_LIMITS.sourceTags,
        sourceTagsTruncated: source.length > SHARED_TAG_LIMITS.sourceTags,
        matchVersion: SHARED_TAG_MATCH_VERSION,
        interpretation: '共同標籤僅表示原始文章標籤相同，不代表引用、交流或正文相似；日期未知文章不列入期間。',
      };
    });
  } catch {
    return { status: 'unavailable', matchVersion: SHARED_TAG_MATCH_VERSION };
  }
}
