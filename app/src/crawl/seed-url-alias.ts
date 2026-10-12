import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { isAllowedCrawlUrl } from './feed.ts';
import { seedIdentityKey } from './seed-url-resolution.ts';
import type { SeedUrlValidation } from './seed-url-validation.ts';

// One-time, independently researched redirect equivalences. This is deliberately
// not a name-based merge API and cannot be expanded by a CLI switch.
const reviewedPairs = new Map([
  ['89:28', { canonical: 'https://vivianexplore.tw/', redirectOrigin: 'https://vivianjourney.tw/', redirectOwner: 'source' }],
  ['134:94', { canonical: 'https://girlsplan.com/', redirectOrigin: 'https://www.girlslifeplan.com/', redirectOwner: 'target' }],
]);
const objectOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
function decoded(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return objectOf(value);
  try {
    return objectOf(JSON.parse(value));
  } catch {
    return null;
  }
}
function freshVerified(result: SeedUrlValidation): boolean {
  const stamp = Date.parse(result.evidence.checkedAt);
  return (
    result.validated &&
    result.reason === 'verified_identity_and_source' &&
    Boolean(result.finalUrl && result.finalUrl.length <= 1024 && isAllowedCrawlUrl(result.finalUrl)) &&
    result.inputUrl.length <= 1024 &&
    isAllowedCrawlUrl(result.inputUrl) &&
    Boolean(result.evidence.homepageStatus && result.evidence.homepageStatus >= 200 && result.evidence.homepageStatus < 300) &&
    /^[a-f0-9]{64}$/.test(result.evidence.homepageSha256 || '') &&
    result.evidence.identityMatches.length > 0 &&
    Number.isFinite(stamp) &&
    Math.abs(Date.now() - stamp) < 24 * 3600_000 &&
    result.feedSources.length > 0 &&
    result.feedSources.every(
      (source) =>
        source.url.length <= 1024 &&
        isAllowedCrawlUrl(source.url) &&
        result.evidence.sourceChecks.some(
          (check) => check.reason === 'valid_xml_source' && check.type === source.type && check.finalUrl === source.url,
        ),
    )
  );
}

/** Bind only reviewed, unused duplicate seed rows. Never move reader data or ownership. */
export async function applyVerifiedSeedAlias(pool: Pool, source: SeedUrlValidation, target: SeedUrlValidation) {
  const pair = reviewedPairs.get(`${source.id}:${target.id}`);
  if (!pair || !freshVerified(source) || !freshVerified(target)) throw new Error('reviewed pair and fresh verifier evidence required');
  const canonical = pair.canonical;
  if (seedIdentityKey(source.finalUrl!) !== seedIdentityKey(canonical) || seedIdentityKey(target.finalUrl!) !== seedIdentityKey(canonical))
    throw new Error('canonical publication identities differ');
  if (pair.redirectOwner === 'source' && seedIdentityKey(source.inputUrl) !== seedIdentityKey(pair.redirectOrigin))
    throw new Error('source redirect evidence missing');
  const matchingFeeds = source.feedSources.filter((a) => target.feedSources.some((b) => a.url === b.url && a.type === b.type));
  if (!matchingFeeds.length) throw new Error('no matching verified feed');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const orderedIds = [source.id, target.id].sort((a, b) => a - b);
    const blogs = new Map<number, RowDataPacket>();
    for (const id of orderedIds) {
      const [[row]] = await connection.query<RowDataPacket[]>('SELECT id,slug,name,url,status FROM blogs WHERE id=? FOR UPDATE', [id]);
      if (!row) throw new Error('seed or target not found');
      blogs.set(Number(row.id), row);
    }
    const from = blogs.get(source.id)!;
    const to = blogs.get(target.id)!;
    if (from.url !== null || from.status !== 'seed') throw new Error('source seed state changed');
    if (to.status !== 'verified' || !to.url || seedIdentityKey(to.url) !== seedIdentityKey(canonical))
      throw new Error('target state changed');
    const zeroDataChecks: Record<string, number> = {};
    for (const table of ['posts', 'user_follows', 'blog_authors', 'blog_urls', 'feed_sources']) {
      // Names are a closed constant list, never derived from caller input.
      const [rows] = await connection.query<RowDataPacket[]>(`SELECT blog_id FROM ${table} WHERE blog_id=? LIMIT 1 FOR UPDATE`, [
        source.id,
      ]);
      zeroDataChecks[table] = rows.length;
      if (rows.length) throw new Error(`source has existing ${table}`);
    }
    const [manualTags] = await connection.query<RowDataPacket[]>(
      "SELECT blog_id FROM blog_tags WHERE blog_id=? AND source_type IN ('manual','community') LIMIT 1 FOR UPDATE",
      [source.id],
    );
    zeroDataChecks.manualCommunityTags = manualTags.length;
    if (manualTags.length) throw new Error('source has manual or community tags');
    const [provenance] = await connection.query<RowDataPacket[]>(
      'SELECT blog_id,source_sha256,source_row,original_name FROM seed_records WHERE blog_id IN (?,?) ORDER BY id FOR UPDATE',
      orderedIds,
    );
    if (!orderedIds.every((id) => provenance.some((row) => Number(row.blog_id) === id)))
      throw new Error('missing original seed provenance');
    const [canonicalOwners] = await connection.query<RowDataPacket[]>(
      'SELECT blog_id,url,is_primary FROM blog_urls WHERE url=? FOR UPDATE',
      [to.url],
    );
    if (canonicalOwners.length !== 1 || Number(canonicalOwners[0].blog_id) !== target.id || !canonicalOwners[0].is_primary)
      throw new Error('target does not exclusively own canonical URL');
    for (const feed of matchingFeeds) {
      const [owners] = await connection.query<RowDataPacket[]>('SELECT blog_id,type FROM feed_sources WHERE url=? FOR UPDATE', [feed.url]);
      if (owners.length !== 1 || Number(owners[0].blog_id) !== target.id || owners[0].type !== feed.type)
        throw new Error('target does not exclusively own verified feed');
    }
    const [audits] = await connection.query<RowDataPacket[]>(
      `SELECT a.id,a.candidate_id,a.source_evidence,c.status FROM discovery_candidate_audits a
       JOIN discovery_candidates c ON c.id=a.candidate_id
       WHERE c.url=? AND a.action='bind-seed' AND a.source_type='seed-url-resolution'
       ORDER BY a.id DESC LIMIT 20 FOR UPDATE`,
      [to.url],
    );
    const originalAudit = audits.find((row) => Number(decoded(row.source_evidence)?.seedBlogId) === target.id);
    const originalEvidence = decoded(originalAudit?.source_evidence);
    if (originalAudit?.status !== 'approved' || !originalEvidence) throw new Error('target original binding audit missing');
    if (pair.redirectOwner === 'target') {
      const verification = objectOf(originalEvidence.verification);
      if (
        verification?.validated !== true ||
        Number(verification.id) !== target.id ||
        typeof verification.inputUrl !== 'string' ||
        typeof verification.finalUrl !== 'string' ||
        seedIdentityKey(verification.inputUrl) !== seedIdentityKey(pair.redirectOrigin) ||
        seedIdentityKey(verification.finalUrl) !== seedIdentityKey(canonical)
      )
        throw new Error('target original redirect evidence missing');
    }
    const now = new Date();
    const evidence = JSON.stringify({
      authorization: 'user-directed verified seed URL resolution; independently reviewed redirect pair',
      sourceId: source.id,
      targetId: target.id,
      sourceVerification: source,
      targetVerification: target,
      matchingFeeds,
      zeroDataChecks,
      seedProvenance: provenance,
      targetOriginalAudit: { id: originalAudit.id, evidence: originalEvidence },
      before: { source: from, target: to },
      after: { source: { ...from, url: to.url, status: 'moved' }, target: to },
      preservation: 'No posts, authors, tags, follows, feed ownership, canonical URL ownership or raw seed records moved',
    });
    if (Buffer.byteLength(evidence) > 256 * 1024) throw new Error('alias evidence exceeds limit');
    const [updated] = await connection.execute<ResultSetHeader>(
      "UPDATE blogs SET url=?,canonical_host=?,status='moved',status_label='同站搬家別名' WHERE id=? AND url IS NULL AND status='seed'",
      [to.url, new URL(to.url).hostname, source.id],
    );
    if (updated.affectedRows !== 1) throw new Error('source changed during alias binding');
    await connection.execute(
      `INSERT INTO discovery_candidate_audits
       (candidate_id,action,previous_status,next_status,source_type,source_url,source_evidence,note,occurred_at,created_at)
       VALUES (?,'bind-seed-alias','approved','approved','seed-url-resolution',?,?,?,?,?)`,
      [
        originalAudit.candidate_id,
        source.inputUrl,
        evidence,
        `Seed ${source.id} is a reviewed moved alias of ${target.id}; original seed rows preserved`,
        now,
        now,
      ],
    );
    await connection.commit();
    return { id: source.id, targetId: target.id, status: 'moved', url: to.url };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
