import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  CANDIDATE_POLICY,
  type CandidateCheck,
  candidateIdentityConfirmed,
  candidatePreflight,
  publicationContains,
} from './candidate-validation.ts';
import { isAllowedCrawlUrl } from './feed.ts';
import { seedIdentityKey } from './seed-url-resolution.ts';

const decode = (x: unknown): Record<string, unknown> => {
  try {
    const v = typeof x === 'string' ? JSON.parse(x) : x;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};
const safeKey = (url: string) => {
  try {
    return seedIdentityKey(url);
  } catch {
    return '';
  }
};
const LOCK = 'blog_observe:candidate-promotion';
async function releasePromotion(connection: PoolConnection, held: boolean) {
  if (held) {
    try {
      const [[row]] = await connection.query<RowDataPacket[]>('SELECT RELEASE_LOCK(?) AS released', [LOCK]);
      if (Number(row?.released) !== 1) throw Error('promotion lock lost');
    } catch (error) {
      connection.destroy();
      throw error;
    }
  }
  connection.release();
}
/** No network in this transaction. Recheck ownership and operator decisions after validation. */
export async function recordCandidateCheck(pool: Pool, check: CandidateCheck, apply: boolean) {
  if (
    check.policy !== CANDIDATE_POLICY ||
    !Number.isSafeInteger(check.id) ||
    check.id < 1 ||
    !Number.isFinite(Date.parse(check.checkedAt)) ||
    Math.abs(Date.now() - Date.parse(check.checkedAt)) > 24 * 3600_000
  )
    throw Error('fresh candidate check required');
  const serialized = JSON.stringify(check);
  if (Buffer.byteLength(serialized) > 128 * 1024) throw Error('candidate evidence exceeds limit');
  if (!apply) return { id: check.id, status: 'dry-run', reason: check.reason };
  const c = await pool.getConnection();
  let locked = false;
  try {
    const [[lock]] = await c.query<RowDataPacket[]>('SELECT GET_LOCK(?,0) AS held', [LOCK]);
    if (Number(lock?.held) !== 1) return { status: 'busy' };
    locked = true;
    await c.beginTransaction();
    const [[candidate]] = await c.query<RowDataPacket[]>(
      'SELECT id,url,name,status,source_type,source_evidence FROM discovery_candidates WHERE id=? FOR UPDATE',
      [check.id],
    );
    if (!candidate || candidate.url !== check.inputUrl || candidate.status !== 'candidate') {
      await c.rollback();
      return { status: 'decision-changed' };
    }
    const [[manual]] = await c.query<RowDataPacket[]>(
      "SELECT id FROM discovery_candidate_audits WHERE candidate_id=? AND (source_type IN ('manual','human-review','admin') OR source_actor_id IS NOT NULL) LIMIT 1",
      [check.id],
    );
    if (manual) {
      await c.rollback();
      return { status: 'manual-decision-preserved' };
    }
    let reason = check.reason;
    let blogId: number | null = null;
    let slug: string | null = null;
    let created = false;
    const v = check.verification;
    if (apply && check.eligible) {
      if (
        candidatePreflight(candidate as Parameters<typeof candidatePreflight>[0]) ||
        !v?.validated ||
        !v.finalUrl ||
        v.inputUrl !== check.inputUrl ||
        v.id !== check.id ||
        candidatePreflight({ ...candidate, url: v.finalUrl } as Parameters<typeof candidatePreflight>[0]) ||
        !v.evidence.identityMatches.length ||
        !check.feed ||
        !candidateIdentityConfirmed(candidate.name, v, check.feed.title) ||
        !['rss', 'atom'].includes(check.feed.type) ||
        !isAllowedCrawlUrl(check.feed.url) ||
        check.feed.url.length > 1024 ||
        check.feed.entries < 1 ||
        !check.feed.sample.length ||
        check.feed.sample.some((u) => !publicationContains(u, v.finalUrl!)) ||
        safeKey(check.feed.identityUrl) !== safeKey(v.finalUrl)
      )
        throw Error('verified publication and RSS evidence required');
      const keys = new Set([safeKey(candidate.url), safeKey(v.finalUrl)]);
      const [rejected] = await c.query<RowDataPacket[]>("SELECT url FROM discovery_candidates WHERE status='rejected' FOR UPDATE");
      const [known] = await c.query<RowDataPacket[]>(
        'SELECT b.id,b.slug,b.url,b.status,u.url AS alias_url FROM blogs b LEFT JOIN blog_urls u ON u.blog_id=b.id FOR UPDATE',
      );
      const owners = new Map<number, RowDataPacket>();
      for (const row of known) if ([row.url, row.alias_url].some((u) => u && keys.has(safeKey(u)))) owners.set(row.id, row);
      if (rejected.some((r) => keys.has(safeKey(r.url)))) reason = 'rejected_identity_preserved';
      else if (owners.size > 1) reason = 'publication_ownership_conflict';
      else if ([...owners.values()].some((r) => r.status !== 'verified')) reason = 'existing_blog_not_verified';
      else {
        const owner = [...owners.values()][0];
        const [feeds] = await c.query<RowDataPacket[]>('SELECT blog_id,url FROM feed_sources FOR UPDATE');
        const feedOwners = feeds.filter((row) => safeKey(row.url) === safeKey(check.feed!.url));
        const feedOwner = feedOwners[0];
        if (feedOwners.some((row) => row.blog_id !== owner?.id)) reason = 'feed_owned_by_other_blog';
        else {
          const now = new Date();
          blogId = owner?.id ?? null;
          slug = owner?.slug ?? null;
          if (!blogId) {
            slug = `discovered-${createHash('sha256').update(safeKey(v.finalUrl)).digest('hex').slice(0, 20)}`;
            const name = Array.from(v.siteName || check.feed.title || v.title || candidate.name)
              .slice(0, 255)
              .join('');
            const [insert] = await c.execute<ResultSetHeader>(
              "INSERT INTO blogs (slug,name,url,canonical_host,status,status_label,discovered_at,stale_policy) VALUES (?,?,?,?,'verified','RSS 自動驗證',?,'low_frequency')",
              [slug, name, v.finalUrl, new URL(v.finalUrl).hostname, now],
            );
            blogId = insert.insertId;
            created = true;
            await c.execute("INSERT INTO blog_urls (blog_id,url,kind,is_primary,discovered_at) VALUES (?,?,'primary',TRUE,?)", [
              blogId,
              v.finalUrl,
              now,
            ]);
          }
          const ownedUrls = new Set(
            known
              .filter((row) => row.id === blogId)
              .flatMap((row) => [row.url, row.alias_url])
              .filter(Boolean),
          );
          if (created) ownedUrls.add(v.finalUrl);
          for (const alias of new Set([candidate.url, v.finalUrl]))
            if (!ownedUrls.has(alias)) {
              await c.execute("INSERT INTO blog_urls (blog_id,url,kind,is_primary,discovered_at) VALUES (?,?,'redirect',FALSE,?)", [
                blogId,
                alias,
                now,
              ]);
            }
          // Never transfer a feed or replace an existing publication's metadata.
          if (!feedOwner)
            await c.execute('INSERT INTO feed_sources (blog_id,url,type,last_success_at,consecutive_failures) VALUES (?,?,?,?,0)', [
              blogId,
              check.feed.url,
              check.feed.type,
              new Date(check.checkedAt),
            ]);
          reason = created ? 'auto-approved-new-blog' : 'auto-approved-existing-blog';
        }
      }
    }
    const status = blogId ? 'approved' : 'candidate';
    const review = { ...check, eligible: check.eligible, reason, blogId, slug, applied: Boolean(blogId) };
    // JSON_MERGE_PATCH would delete null-valued keys inside user evidence; replace only this machine-owned key.
    const evidence = { ...decode(candidate.source_evidence), automaticReview: review };
    await c.execute("UPDATE discovery_candidates SET status=?,source_evidence=? WHERE id=? AND status='candidate'", [
      status,
      JSON.stringify(evidence),
      check.id,
    ]);
    await c.execute(
      "INSERT INTO discovery_candidate_audits (candidate_id,action,previous_status,next_status,source_type,source_url,source_evidence,note,occurred_at,created_at) VALUES (?,?,'candidate',?,'automatic-rss-review',?,?,?,?,?)",
      [
        check.id,
        blogId ? 'auto-approve' : 'auto-verify',
        status,
        candidate.url,
        JSON.stringify(review),
        reason,
        new Date(check.checkedAt),
        new Date(),
      ],
    );
    await c.commit();
    return { id: check.id, status, reason, blogId, slug, created };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    await releasePromotion(c, locked);
  }
}
