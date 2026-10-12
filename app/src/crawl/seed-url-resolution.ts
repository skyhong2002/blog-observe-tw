import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { isAllowedCrawlUrl } from './feed.ts';

import type { SeedUrlValidation } from './seed-url-validation.ts';
export type VerifiedSeed = SeedUrlValidation;

/** Preserve author paths and meaningful query parameters even on non-platform hosts. */
export function seedIdentityKey(value: string): string {
  const url = new URL(value);
  url.hash = '';
  url.searchParams.sort();
  return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;
}

/** Called only with the fresh verifier result. Existing identities and raw seed rows are never overwritten. */
export async function applyVerifiedSeed(pool: Pool, result: VerifiedSeed) {
  const stamp = Date.parse(result.evidence.checkedAt);
  if (
    !result.validated ||
    !result.finalUrl ||
    !isAllowedCrawlUrl(result.finalUrl) ||
    result.finalUrl.length > 1024 ||
    result.inputUrl.length > 1024 ||
    !result.evidence.identityMatches.length ||
    !result.feedSources.length ||
    !Number.isFinite(stamp) ||
    Math.abs(Date.now() - stamp) > 24 * 3600_000 ||
    result.feedSources.some((s) => !isAllowedCrawlUrl(s.url) || s.url.length > 1024)
  )
    throw new Error('fresh verified identity and feed evidence required');
  const evidence = JSON.stringify({ authorization: 'user-directed automatic verification', verification: result });
  if (Buffer.byteLength(evidence) > 128 * 1024) throw new Error('verification evidence exceeds limit');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[blog]] = await connection.query<RowDataPacket[]>('SELECT id,slug,name,url,status FROM blogs WHERE id=? FOR UPDATE', [
      result.id,
    ]);
    if (!blog) throw new Error('seed not found');
    if (blog.url) {
      await connection.rollback();
      return { id: result.id, slug: blog.slug, status: 'unchanged', url: blog.url };
    }
    if (blog.url !== null || blog.status !== 'seed') throw new Error('seed state changed');
    const identities = new Set([seedIdentityKey(result.finalUrl), seedIdentityKey(result.inputUrl)]);
    const [rejected] = await connection.query<RowDataPacket[]>(
      "SELECT id,url FROM discovery_candidates WHERE status='rejected' FOR UPDATE",
    );
    if (rejected.some((row) => identities.has(seedIdentityKey(row.url)))) {
      await connection.rollback();
      return { id: result.id, slug: blog.slug, status: 'conflict', reason: 'previously-rejected-candidate' };
    }
    const [identityRows] = await connection.query<RowDataPacket[]>(
      'SELECT b.id,b.slug,b.status,b.url,u.url AS aliasUrl FROM blogs b LEFT JOIN blog_urls u ON u.blog_id=b.id WHERE b.id<>? FOR UPDATE',
      [result.id],
    );
    const owners = identityRows.filter((row) =>
      [row.url, row.aliasUrl].filter(Boolean).some((url) => identities.has(seedIdentityKey(url))),
    );
    if (owners.length) {
      await connection.rollback();
      return {
        id: result.id,
        slug: blog.slug,
        status: 'conflict',
        reason: 'url-already-owned',
        ownerIds: [...new Set(owners.map((o) => o.id))],
      };
    }
    for (const source of result.feedSources) {
      const [existing] = await connection.query<RowDataPacket[]>('SELECT blog_id FROM feed_sources WHERE url=? FOR UPDATE', [source.url]);
      if (existing.some((r) => Number(r.blog_id) !== result.id)) {
        await connection.rollback();
        return { id: result.id, slug: blog.slug, status: 'conflict', reason: 'feed-already-owned' };
      }
    }
    const [[provenance]] = await connection.query<RowDataPacket[]>(
      'SELECT source_sha256,source_row,original_name FROM seed_records WHERE blog_id=? ORDER BY id LIMIT 1',
      [result.id],
    );
    if (!provenance) throw new Error('missing seed provenance');
    const now = new Date();
    const [updated] = await connection.execute<ResultSetHeader>(
      'UPDATE blogs SET url=?,canonical_host=?,status="verified",status_label="已核對網站" WHERE id=? AND url IS NULL',
      [result.finalUrl, new URL(result.finalUrl).hostname, result.id],
    );
    if (updated.affectedRows !== 1) throw new Error('seed changed during verification');
    await connection.execute('INSERT INTO blog_urls (blog_id,url,kind,is_primary,discovered_at) VALUES (?,?,"primary",TRUE,?)', [
      result.id,
      result.finalUrl,
      now,
    ]);
    if (result.inputUrl !== result.finalUrl) {
      const [aliases] = await connection.query<RowDataPacket[]>('SELECT blog_id FROM blog_urls WHERE url=? FOR UPDATE', [result.inputUrl]);
      if (!aliases.length)
        await connection.execute('INSERT INTO blog_urls (blog_id,url,kind,is_primary,discovered_at) VALUES (?,?,"redirect",FALSE,?)', [
          result.id,
          result.inputUrl,
          now,
        ]);
    }
    for (const source of result.feedSources)
      await connection.execute(
        'INSERT INTO feed_sources (blog_id,url,type,last_success_at,consecutive_failures) VALUES (?,?,?,?,0) ON DUPLICATE KEY UPDATE type=VALUES(type),last_success_at=VALUES(last_success_at),last_error_at=NULL,consecutive_failures=0',
        [result.id, source.url, source.type, new Date(stamp)],
      );
    const full = JSON.stringify({ seedBlogId: result.id, seed: provenance, ...JSON.parse(evidence) });
    const [[existingCandidate]] = await connection.query<RowDataPacket[]>(
      'SELECT id,status FROM discovery_candidates WHERE url=? AND source_type="seed-url-resolution" FOR UPDATE',
      [result.finalUrl],
    );
    const previousStatus = existingCandidate?.status ?? null;
    if (existingCandidate && !['candidate', 'approved'].includes(existingCandidate.status)) throw new Error('unexpected candidate state');
    await connection.execute(
      'INSERT INTO discovery_candidates (url,name,source_type,source_url,source_evidence,status,discovered_at) VALUES (?,?,"seed-url-resolution",?,?,"approved",?) ON DUPLICATE KEY UPDATE status="approved",source_evidence=VALUES(source_evidence)',
      [result.finalUrl, blog.name, result.inputUrl, full, now],
    );
    const [[candidate]] = await connection.query<RowDataPacket[]>(
      'SELECT id,status FROM discovery_candidates WHERE url=? AND source_type="seed-url-resolution" FOR UPDATE',
      [result.finalUrl],
    );
    if (!candidate) throw new Error('candidate was not persisted');
    await connection.execute(
      'INSERT INTO discovery_candidate_audits (candidate_id,action,previous_status,next_status,source_type,source_url,source_evidence,note,occurred_at,created_at) VALUES (?,"bind-seed",?, ?,"seed-url-resolution",?,?,?, ?,?)',
      [
        candidate.id,
        previousStatus,
        candidate.status,
        result.inputUrl,
        full,
        `Verified URL bound to existing seed ${result.id}; original CSV preserved`,
        new Date(stamp),
        now,
      ],
    );
    await connection.commit();
    return { id: result.id, slug: blog.slug, status: 'applied', url: result.finalUrl };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
