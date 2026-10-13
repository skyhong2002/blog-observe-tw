import type { Pool, RowDataPacket } from 'mysql2/promise';
import { canonicalArticleUrl, type PassiveFetchBatch } from '../crawl/feed.ts';
import { type RecordTechObservationInput, TECH_LIMITS } from './contracts.ts';
import { detectTechnology } from './detector.ts';
import { type TechObservationQueue, techObservationQueue } from './observer.ts';
import { sameTechPublication } from './store.ts';

// A pool may queue acquisition before the driver's SQL timeout starts. Bound that wait too,
// and permit only one unresolved lookup per pool if a timed-out read is still pending.
// The2500ms deadline stops waiting; it does not cancel SQL or a queued pool acquisition.
const pendingLookups = new WeakSet<Pool>();
async function publicPosts(pool: Pool, sql: string, values: unknown[]): Promise<RowDataPacket[]> {
  if (pendingLookups.has(pool)) return [];
  pendingLookups.add(pool);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = pool.query<RowDataPacket[]>({ sql, timeout: TECH_LIMITS.storeTimeoutMs }, values);
    void read.then(
      () => pendingLookups.delete(pool),
      () => pendingLookups.delete(pool),
    );
    const result = await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Error('tech_lookup_timeout')), TECH_LIMITS.storeTimeoutMs);
      }),
    ]);
    return result[0];
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Existing HTML responses only. No raw HTML/headers enter the pending list or DB queue. */
export function createTechFetchBatch(
  pool: Pool,
  context: { blogId: number; blogUrl: string },
  options: { enabled?: boolean; queue?: TechObservationQueue } = {},
): PassiveFetchBatch | undefined {
  if (!(options.enabled ?? process.env.BLOG_TECH_ENABLED === 'true')) return undefined;
  if (!Number.isSafeInteger(context.blogId) || context.blogId < 1) return undefined;
  const queue = options.queue ?? techObservationQueue;
  let pending: RecordTechObservationInput[] = [];
  const isHome = (url: string) => {
    const source = new URL(url),
      home = new URL(context.blogUrl);
    return source.pathname.replace(/\/$/, '') === home.pathname.replace(/\/$/, '') && source.search === home.search;
  };
  return {
    observer(event) {
      try {
        if (
          event.status !== 200 ||
          event.error ||
          event.html === undefined ||
          !/^(?:text\/html|application\/xhtml\+xml)(?:[;\s]|$)/i.test(event.headers['content-type'] ?? '') ||
          !Number.isFinite(event.observedAt.getTime()) ||
          event.url.length > 4096 ||
          event.requestedUrl.length > 4096 ||
          !sameTechPublication(event.url, context.blogUrl) ||
          !sameTechPublication(event.requestedUrl, context.blogUrl)
        )
          return;
        if (pending.length >= 32 || !queue.hasCapacity()) {
          queue.recordDrop();
          return;
        }
        const observation = detectTechnology({
          url: event.url,
          html: event.html,
          headers: event.headers,
          httpStatus: event.status,
          sourceType: 'html',
          observedAt: event.observedAt,
        });
        observation.coverage.htmlTruncated ||= event.htmlTruncated;
        const input = { blogId: context.blogId, sourceUrl: event.url, observation };
        if (Buffer.byteLength(JSON.stringify(input)) <= TECH_LIMITS.payloadBytes) pending.push(input);
      } catch {
        /* Optional metadata cannot change fetch outcomes. */
      }
    },
    async commit(articleUrls) {
      const captured = pending;
      pending = [];
      if (!captured.length) return;
      try {
        const wanted = new Set(captured.filter((input) => !isHome(input.sourceUrl)).map((input) => canonicalArticleUrl(input.sourceUrl)));
        const allowed = new Set<string>();
        // The committed entry list can be large; retain only the at-most32 captured identities.
        if (wanted.size)
          for (const url of articleUrls) {
            if (!sameTechPublication(url, context.blogUrl)) continue;
            const key = canonicalArticleUrl(url);
            if (wanted.has(key)) allowed.add(key);
            if (allowed.size === wanted.size) break;
          }
        const articles = captured.filter((input) => !isHome(input.sourceUrl) && allowed.has(canonicalArticleUrl(input.sourceUrl)));
        const ids = new Map<string, number>();
        if (articles.length) {
          const urls = [...new Set(articles.map((input) => canonicalArticleUrl(input.sourceUrl)))];
          const rows = await publicPosts(
            pool,
            `SELECT MIN(p.id) AS id,p.url FROM posts p JOIN blogs b ON b.id=p.blog_id
            WHERE b.id=? AND b.url=? AND b.status='verified'
            AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
            AND p.url IN (${urls.map(() => '?').join(',')}) GROUP BY p.url ORDER BY id LIMIT 32`,
            [context.blogId, context.blogUrl, ...urls],
          );
          for (const row of rows)
            if (Number.isSafeInteger(Number(row.id)) && Number(row.id) > 0 && !ids.has(row.url)) ids.set(row.url, Number(row.id));
        }
        for (const input of captured) {
          if (isHome(input.sourceUrl)) queue.enqueue(pool, input);
          else {
            const sourcePostId = ids.get(canonicalArticleUrl(input.sourceUrl));
            if (sourcePostId) queue.enqueue(pool, { ...input, sourcePostId });
          }
        }
      } catch {
        /* Missing/deleted/future sources and DB failures never alter the import. */
      }
    },
    discard() {
      pending = [];
    },
  };
}
