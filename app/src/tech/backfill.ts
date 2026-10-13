import type { Pool, RowDataPacket } from 'mysql2/promise';
import { type RecordTechObservationInput, type RecordTechObservationResult, TECH_LIMITS, type TechStatus } from './contracts.ts';
import { detectTechnology, safeTechSourceUrl } from './detector.ts';
import { recordTechObservation, sameTechPublication } from './store.ts';

export type TechBackfillOptions = { afterId?: number; limit?: number; apply?: boolean };
type Writer = (pool: Pool, input: RecordTechObservationInput) => Promise<RecordTechObservationResult>;
type BackfillItem = { blogId: number; status: TechStatus | 'skipped'; reason: string; truncated: boolean };

/** Reads existing evidence only. Never imports a crawler, issues HTTP, or invents a new observation timestamp. */
export async function backfillBlogTechnology(pool: Pool, options: TechBackfillOptions = {}, writer: Writer = recordTechObservation) {
  const afterId = options.afterId ?? 0;
  const limit = options.limit ?? 10;
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10)
    throw Error('invalid_backfill_options');
  const [blogs] = await pool.query<RowDataPacket[]>({
    sql: "SELECT id FROM blogs WHERE status='verified' AND id>? ORDER BY id LIMIT ?",
    timeout: TECH_LIMITS.storeTimeoutMs,
    values: [afterId, limit],
  });
  const items: BackfillItem[] = [];
  for (const blog of blogs) {
    // SQL bounds bytes before transfer, not characters (utf8mb4 can use four bytes each).
    // Rejoin both public owners and live posts: orphaned, hidden and future sources cannot supply evidence.
    const [[body]] = await pool.query<RowDataPacket[]>({
      sql: `SELECT b.url AS blog_url,p.id AS post_id,p.url AS post_url,c.source_url,c.obtained_at,
        SUBSTRING(CAST(c.body_html AS BINARY),1,?) AS html_bytes,
        OCTET_LENGTH(c.body_html)>? AS html_truncated,s.last_attempt_at
        FROM content_post_bodies c
        JOIN posts p ON p.id=c.post_id AND p.blog_id=c.blog_id
        JOIN blogs b ON b.id=p.blog_id AND b.status='verified'
        LEFT JOIN blog_tech_scans s ON s.blog_id=b.id
        WHERE c.blog_id=? AND (p.published_at IS NULL OR p.published_at<=UTC_TIMESTAMP())
          AND c.status IN ('ok','partial') AND c.body_html IS NOT NULL AND OCTET_LENGTH(c.body_html)>0
          AND c.obtained_at<=UTC_TIMESTAMP()
        ORDER BY c.obtained_at DESC,p.id DESC LIMIT 1`,
      timeout: TECH_LIMITS.storeTimeoutMs,
      values: [TECH_LIMITS.htmlBytes, TECH_LIMITS.htmlBytes, blog.id],
    });
    const item: BackfillItem = { blogId: Number(blog.id), status: 'skipped', reason: 'no-public-html', truncated: false };
    items.push(item);
    if (!body) continue;
    item.truncated = Boolean(Number(body.html_truncated));
    const observedAt = new Date(body.obtained_at);
    if (!Number.isFinite(observedAt.getTime())) {
      item.reason = 'invalid-observation-time';
      continue;
    }
    if (body.last_attempt_at && new Date(body.last_attempt_at).getTime() >= observedAt.getTime()) {
      item.reason = 'stale';
      continue;
    }
    if (
      typeof body.source_url !== 'string' ||
      !safeTechSourceUrl(body.source_url) ||
      !sameTechPublication(body.source_url, body.blog_url) ||
      !sameTechPublication(body.post_url, body.blog_url)
    ) {
      item.reason = 'ownership-mismatch';
      continue;
    }
    const html = Buffer.isBuffer(body.html_bytes) ? body.html_bytes.toString('utf8') : String(body.html_bytes ?? '');
    if (!html.trim()) continue;
    const observation = detectTechnology({ url: body.source_url, html, sourceType: 'body-fragment', observedAt });
    observation.coverage.htmlTruncated ||= item.truncated;
    // Existing extracted fragments may not retain generator/header evidence. Unknown means inspected, never absent.
    item.status = observation.status;
    item.reason = 'dry-run';
    if (options.apply) {
      const result = await writer(pool, {
        blogId: item.blogId,
        sourcePostId: Number(body.post_id),
        sourceUrl: body.source_url,
        observation,
      });
      item.reason = result.reason;
    }
  }
  return {
    mode: options.apply ? 'apply' : 'dry-run',
    timestampPolicy: 'original-content-obtained-at',
    processedBlogs: items.length,
    nextCursor: items.at(-1)?.blogId ?? afterId,
    complete: items.length < limit,
    counts: {
      detected: items.filter((i) => i.status === 'detected').length,
      unknown: items.filter((i) => i.status === 'unknown').length,
      blocked: items.filter((i) => i.status === 'blocked').length,
      failed: items.filter((i) => i.status === 'failed').length,
      skipped: items.filter((i) => i.status === 'skipped').length,
      written: items.filter((i) => i.reason === 'stored').length,
      truncated: items.filter((i) => i.truncated).length,
    },
    items,
  };
}

export function parseTechBackfillArgs(args: string[]): TechBackfillOptions {
  const options: TechBackfillOptions = { afterId: 0, limit: 10, apply: false };
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw Error('invalid_backfill_options');
    seen.add(arg);
    if (arg === '--apply') options.apply = true;
    else if (arg === '--after-id' || arg === '--limit') {
      const value = args[++i] ?? '';
      if (!/^\d{1,10}$/.test(value)) throw Error('invalid_backfill_options');
      if (arg === '--after-id') options.afterId = Number(value);
      else options.limit = Number(value);
    } else throw Error('invalid_backfill_options');
  }
  if ((options.limit ?? 10) < 1 || (options.limit ?? 10) > 10) throw Error('invalid_backfill_options');
  return options;
}
