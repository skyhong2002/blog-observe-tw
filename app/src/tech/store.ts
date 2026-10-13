import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { publicationHome } from '../relations/identity.ts';
import { type RecordTechObservationInput, type RecordTechObservationResult, TECH_LIMITS } from './contracts.ts';
import { safeTechSourceUrl, validTechObservation } from './detector.ts';

/** Recheck these predicates on EVERY read, including cached/failed snapshots. No public body may come from a deleted/future post. */
export function publicTechSourceSql(scanAlias = 's', blogAlias = 'b'): string {
  if (![scanAlias, blogAlias].every((v) => /^[a-z][a-z0-9_]*$/i.test(v))) throw Error('invalid_sql_alias');
  return `${blogAlias}.status='verified'
    AND (${scanAlias}.source_post_id IS NULL OR EXISTS(SELECT 1 FROM posts tech_source WHERE tech_source.id=${scanAlias}.source_post_id AND tech_source.blog_id=${blogAlias}.id AND (tech_source.published_at IS NULL OR tech_source.published_at<=UTC_TIMESTAMP())))
    AND (${scanAlias}.last_attempt_source_post_id IS NULL OR EXISTS(SELECT 1 FROM posts tech_attempt WHERE tech_attempt.id=${scanAlias}.last_attempt_source_post_id AND tech_attempt.blog_id=${blogAlias}.id AND (tech_attempt.published_at IS NULL OR tech_attempt.published_at<=UTC_TIMESTAMP())))`;
}
export function sameTechPublication(source: string, publication: string): boolean {
  try {
    const a = new URL(source),
      b = new URL(publication);
    if (a.username || a.password || b.username || b.password || a.origin !== b.origin) return false;
    const sourceHome = publicationHome(source),
      blogHome = publicationHome(publication);
    if (!sourceHome || sourceHome !== blogHome) return false;
    // Respect subdirectory installs too; /blogger must not qualify for an owner at /blog/.
    const path = b.pathname.replace(/\/$/, '');
    return !path || a.pathname === path || a.pathname.startsWith(`${path}/`);
  } catch {
    return false;
  }
}

// At most one unresolved pool acquisition, even after a writer's caller times out.
const acquiringPools = new WeakSet<Pool>();

/** Bounded, failure-isolated callback target. Locks serialize with status changes; never logs raw DB/URL errors. */
export async function recordTechObservation(pool: Pool, input: RecordTechObservationInput): Promise<RecordTechObservationResult> {
  const result = (reason: RecordTechObservationResult['reason']): RecordTechObservationResult => ({ written: reason === 'stored', reason });
  const o = input?.observation;
  try {
    if (
      !Number.isSafeInteger(input?.blogId) ||
      input.blogId < 1 ||
      !validTechObservation(o) ||
      !o.sourceUrl ||
      o.sourceUrl !== safeTechSourceUrl(input.sourceUrl)
    )
      return result('invalid-input');
    if (
      input.sourcePostId !== undefined &&
      input.sourcePostId !== null &&
      (!Number.isSafeInteger(input.sourcePostId) || input.sourcePostId < 1)
    )
      return result('invalid-input');
    if (o.sourceType === 'body-fragment' && !input.sourcePostId) return result('invalid-input');
  } catch {
    return result('invalid-input');
  }
  let c: PoolConnection | undefined;
  let expired = false;
  let complete: (() => void) | undefined;
  const deadline = new Promise<RecordTechObservationResult>((resolve) => {
    complete = () => {
      expired = true;
      c?.destroy();
      resolve(result('unavailable'));
    };
  });
  const timer = setTimeout(() => complete?.(), TECH_LIMITS.storeTimeoutMs);
  const work = async (): Promise<RecordTechObservationResult> => {
    try {
      if (acquiringPools.has(pool)) return result('unavailable');
      acquiringPools.add(pool);
      try {
        c = await pool.getConnection();
      } finally {
        acquiringPools.delete(pool);
      }
      if (expired) {
        c.release();
        c = undefined;
        return result('unavailable');
      }
      await c.beginTransaction();
      const [[blog]] = await c.query<RowDataPacket[]>('SELECT id,url,status FROM blogs WHERE id=? FOR UPDATE', [input.blogId]);
      if (blog?.status !== 'verified') {
        await c.rollback();
        return result('not-public');
      }
      if (typeof blog.url !== 'string' || !sameTechPublication(input.sourceUrl, blog.url)) {
        await c.rollback();
        return result('ownership-mismatch');
      }
      if (input.sourcePostId) {
        const [[post]] = await c.query<RowDataPacket[]>(
          'SELECT id,url,published_at<=UTC_TIMESTAMP() OR published_at IS NULL AS public_date FROM posts WHERE id=? AND blog_id=? FOR UPDATE',
          [input.sourcePostId, input.blogId],
        );
        if (!post || !Number(post.public_date)) {
          await c.rollback();
          return result('not-public');
        }
        if (!sameTechPublication(post.url, blog.url)) {
          await c.rollback();
          return result('ownership-mismatch');
        }
      } else {
        // Without article provenance, only the blog's actual homepage may be stored.
        // An anonymous /post URL must not survive deleting the article that supplied it.
        const final = new URL(input.sourceUrl),
          home = new URL(blog.url);
        if (final.pathname.replace(/\/$/, '') !== home.pathname.replace(/\/$/, '')) {
          await c.rollback();
          return result('ownership-mismatch');
        }
      }
      const [[previous]] = await c.query<RowDataPacket[]>('SELECT last_attempt_at FROM blog_tech_scans WHERE blog_id=? FOR UPDATE', [
        input.blogId,
      ]);
      const attemptedAt = new Date(o.lastAttemptAt);
      if (previous && new Date(previous.last_attempt_at).getTime() >= attemptedAt.getTime()) {
        await c.rollback();
        return result('stale');
      }
      const success = o.status === 'detected' || o.status === 'unknown';
      const now = new Date();
      // Construct allowlisted DTOs; unexpected caller properties are never persisted.
      const detections = o.detections.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        confidence: d.confidence,
        version: d.version,
        ruleId: d.ruleId,
        ruleVersion: d.ruleVersion,
        observedAt: d.observedAt,
        evidence: d.evidence.map((e) => ({ kind: e.kind, value: e.value })),
      }));
      const coverage = {
        partial: true,
        method: o.coverage.method,
        sourceType: o.sourceType,
        htmlTruncated: o.coverage.htmlTruncated,
        inspectedNodes: o.coverage.inspectedNodes,
      };
      await c.execute(
        `INSERT INTO blog_tech_scans(blog_id,status,detections,source_url,source_type,source_post_id,coverage,rule_version,observed_at,last_attempt_at,last_attempt_source_url,last_attempt_source_post_id,last_error_code,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE status=VALUES(status),
          detections=IF(?,VALUES(detections),detections),source_url=IF(?,VALUES(source_url),source_url),source_type=IF(?,VALUES(source_type),source_type),source_post_id=IF(?,VALUES(source_post_id),source_post_id),
          coverage=IF(?,VALUES(coverage),coverage),rule_version=IF(?,VALUES(rule_version),rule_version),observed_at=IF(?,VALUES(observed_at),observed_at),
          last_attempt_at=VALUES(last_attempt_at),last_attempt_source_url=VALUES(last_attempt_source_url),last_attempt_source_post_id=VALUES(last_attempt_source_post_id),last_error_code=VALUES(last_error_code),updated_at=VALUES(updated_at)`,
        [
          input.blogId,
          o.status,
          JSON.stringify(detections),
          success ? o.sourceUrl : null,
          success ? o.sourceType : null,
          success ? (input.sourcePostId ?? null) : null,
          success ? JSON.stringify(coverage) : null,
          o.ruleVersion,
          o.observedAt ? new Date(o.observedAt) : null,
          attemptedAt,
          o.sourceUrl,
          input.sourcePostId ?? null,
          o.errorCode,
          now,
          now,
          ...Array(7).fill(success),
        ],
      );
      if (expired) return result('unavailable');
      await c.commit();
      return expired ? result('unavailable') : result('stored');
    } catch {
      if (c && !expired)
        try {
          await c.rollback();
        } catch {
          c.destroy();
          c = undefined;
        }
      return result('unavailable');
    } finally {
      if (c && !expired) c.release();
    }
  };
  try {
    return await Promise.race([work(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
