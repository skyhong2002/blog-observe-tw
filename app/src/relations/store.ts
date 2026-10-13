import { createHash } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { reserveBudget } from '../jobs/budget.ts';
import { identityKey, type PublicationAlias, publicationDecision, publicationHome, resolvePublication } from './identity.ts';
import { PARSER_VERSION, type ParsedArticle, type ParsedLink } from './parser.ts';
import { invalidateRelationCache } from './routes.ts';

export type ArticleRow = {
  id: number;
  blog_id: number;
  url: string;
  published_at: Date | null;
  blog_url: string;
  depth: number;
  etag?: string | null;
  last_modified?: string | null;
  status?: string;
  parser_version?: string;
};
export async function loadAliases(pool: Pool): Promise<PublicationAlias[]> {
  const [rows] = await pool.query<
    RowDataPacket[]
  >(`SELECT b.id blogId,b.url,'publication-prefix' scope FROM blogs b WHERE b.status='verified' AND b.url IS NOT NULL
    UNION SELECT u.blog_id blogId,u.url,CASE WHEN u.kind IN ('primary','canonical','alternate','moved','ownership') THEN 'publication-prefix' ELSE 'exact-url' END scope
    FROM blog_urls u JOIN blogs b ON b.id=u.blog_id WHERE b.status='verified'`);
  return rows.map((r) => ({ blogId: Number(r.blogId), url: r.url, scope: r.scope === 'exact-url' ? 'exact-url' : 'publication-prefix' }));
}

/** SQL generation replacement is atomic; failed network refresh never deletes last successful links/text. */
export async function saveObservation(pool: Pool, post: ArticleRow, parsed: ParsedArticle, response: Response, now: Date) {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await c.query('SELECT id FROM posts WHERE id=? FOR UPDATE', [post.id]);
    await c.query(
      `INSERT INTO relation_observations
      (post_id,blog_id,body_text,content_hash,status,parser_version,extraction,final_url,etag,last_modified,observed_at,last_success_at,next_attempt_at,published_at,truncated,external_links,error_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)
      ON DUPLICATE KEY UPDATE body_text=VALUES(body_text),content_hash=VALUES(content_hash),status=VALUES(status),parser_version=VALUES(parser_version),
      extraction=VALUES(extraction),final_url=VALUES(final_url),etag=VALUES(etag),last_modified=VALUES(last_modified),observed_at=VALUES(observed_at),
      last_success_at=VALUES(last_success_at),next_attempt_at=VALUES(next_attempt_at),published_at=VALUES(published_at),truncated=VALUES(truncated),external_links=VALUES(external_links),error_code=NULL`,
      [
        post.id,
        post.blog_id,
        parsed.bodyText,
        parsed.contentHash,
        parsed.bodyText === null ? 'no-body' : 'ok',
        PARSER_VERSION,
        parsed.extraction,
        response.url || post.url,
        response.headers.get('etag')?.slice(0, 512) || null,
        response.headers.get('last-modified')?.slice(0, 255) || null,
        now,
        now,
        new Date(now.getTime() + 30 * 86400000),
        post.published_at,
        parsed.truncated,
        parsed.externalLinks,
      ],
    );
    await c.query('DELETE FROM relation_links WHERE source_post_id=?', [post.id]);
    for (const link of parsed.links) {
      let targetPostId: number | null = null;
      if (link.targetBlogId) {
        const [[target]] = await c.query<RowDataPacket[]>('SELECT id FROM posts WHERE blog_id=? AND url=? ORDER BY id LIMIT 1', [
          link.targetBlogId,
          link.targetUrl,
        ]);
        targetPostId = target?.id ?? null;
      }
      await c.query(
        `INSERT INTO relation_links (source_post_id,source_blog_id,ordinal,target_url,target_blog_id,target_post_id,anchor_text,context,location,observed_at,resolution_checked_at,target_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          post.id,
          post.blog_id,
          link.ordinal,
          link.targetUrl,
          link.targetBlogId,
          targetPostId,
          link.anchorText,
          link.context,
          link.location,
          now,
          now,
          link.targetBlogId ? 'known-publication' : publicationDecision(link.targetUrl).reason,
        ],
      );
    }
    await c.commit();
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}

export async function retainFailedObservation(pool: Pool, post: ArticleRow, reason: string, now: Date, delayDays = 7) {
  await pool.query(
    `INSERT INTO relation_observations (post_id,blog_id,status,parser_version,observed_at,next_attempt_at,published_at,error_code)
    VALUES (?,?,'failed',?,?,?,?,?) ON DUPLICATE KEY UPDATE status='failed',observed_at=VALUES(observed_at),next_attempt_at=VALUES(next_attempt_at),error_code=VALUES(error_code)`,
    [post.id, post.blog_id, PARSER_VERSION, now, new Date(now.getTime() + delayDays * 86400000), post.published_at, reason],
  );
}

/** One relations lease serializes candidate reservations; manual decisions always remain untouched. */
export type DiscoverySource = {
  blogId: number;
  blogUrl: string;
  sourceUrl: string;
  postId: number | null;
  depth: number;
  kind: 'article-link' | 'blogroll';
  bodySha256?: string;
  path: string[];
};
export async function discoverCandidateLinks(pool: Pool, source: DiscoverySource, links: ParsedLink[], now: Date): Promise<number> {
  if (source.depth >= 3) return 0;
  let added = 0;
  const seen = new Set<string>();
  for (const link of links) {
    if (link.targetBlogId || !['body', 'blogroll'].includes(link.location)) continue;
    const home = publicationHome(link.targetUrl);
    const key = home && identityKey(home);
    if (!home || !key || seen.has(key)) continue;
    seen.add(key);
    const hash = createHash('sha256').update(key).digest('hex');
    const [[known]] = await pool.query<RowDataPacket[]>(
      'SELECT d.id,d.status,d.source_evidence FROM relation_candidate_identities r JOIN discovery_candidates d ON d.id=r.candidate_id WHERE r.identity_hash=?',
      [hash],
    );
    // Reuse all older source types, not just article-link candidates. Query variants avoid http/www duplicates.
    const h = new URL(home);
    const host = h.hostname.replace(/^www\./, '');
    const variants = [
      ...new Set(
        ['http:', 'https:'].flatMap((scheme) =>
          [host, `www.${host}`].flatMap((name) => [
            `${scheme}//${name}${h.pathname}${h.search}`,
            `${scheme}//${name}${h.pathname.replace(/\/$/, '')}${h.search}`,
          ]),
        ),
      ),
    ];
    const [[existing]] = known
      ? [[known]]
      : await pool.query<RowDataPacket[]>(
          'SELECT id,status,source_evidence FROM discovery_candidates WHERE url IN (?) ORDER BY id LIMIT 1',
          [variants],
        );
    const evidence = {
      policy: PARSER_VERSION,
      discoveryDepth: source.depth + 1,
      sourceBlogId: source.blogId,
      sourcePostId: source.postId,
      sourceArticleUrl: source.postId === null ? null : source.sourceUrl,
      sourcePageUrl: source.sourceUrl,
      bodySha256: source.bodySha256 ?? null,
      targetArticleUrl: link.targetUrl,
      location: link.location,
      observedName: link.anchorText,
      requiresIdentityEnrichment: true,
      path: [...source.path, link.targetUrl],
      observedAt: now.toISOString(),
    };
    let candidateId = existing?.id;
    if (!existing) {
      if (!(await reserveBudget(pool, [{ scope: 'relations:candidates', amount: 1, limit: 50 }], now))) break;
      const [r] = await pool.query<ResultSetHeader>(
        `INSERT INTO discovery_candidates (url,name,source_type,source_url,source_evidence,status,discovered_at)
        VALUES (?,?,?,?,?,'candidate',?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
        [home, link.anchorText || null, source.kind, source.sourceUrl, JSON.stringify(evidence), now],
      );
      candidateId = r.insertId;
      added++;
    } else if (existing.status === 'candidate') {
      // Keep original source provenance. A linked old candidate gains a bounded new path without an approval.
      await pool.query(
        `UPDATE discovery_candidates d SET source_evidence=JSON_SET(COALESCE(source_evidence,JSON_OBJECT()),
        '$.linkDiscovery',JSON_EXTRACT(?,'$'),'$.discoveryDepth',LEAST(COALESCE(JSON_EXTRACT(source_evidence,'$.discoveryDepth'),?),?))
        WHERE id=? AND status='candidate' AND COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(source_evidence,'$.discoveryDepth')) AS UNSIGNED),99)>? AND NOT EXISTS (SELECT 1 FROM discovery_candidate_audits a WHERE a.candidate_id=d.id AND (a.source_actor_id IS NOT NULL OR a.source_type IN ('manual','admin','human-review')))`,
        [JSON.stringify(evidence), source.depth + 1, source.depth + 1, candidateId, source.depth + 1],
      );
    }
    await pool.query(
      'INSERT IGNORE INTO relation_candidate_identities (identity_hash,url,candidate_id,first_observed_at) VALUES (?,?,?,?)',
      [hash, home, candidateId, now],
    );
  }
  return added;
}

export async function discoverCandidates(pool: Pool, post: ArticleRow, parsed: ParsedArticle, now: Date): Promise<number> {
  return discoverCandidateLinks(
    pool,
    {
      blogId: post.blog_id,
      blogUrl: post.blog_url,
      sourceUrl: post.url,
      postId: post.id,
      depth: post.depth,
      kind: 'article-link',
      path: [post.blog_url, post.url],
    },
    parsed.links,
    now,
  );
}

/** Resolve older unknown targets when a publication has since been admitted. No network is required. */
export async function reconcileTargets(pool: Pool, aliases: PublicationAlias[], now: Date): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.source_post_id,l.ordinal,l.source_blog_id,l.target_url FROM relation_links l LEFT JOIN blogs b ON b.id=l.target_blog_id
    WHERE (l.target_blog_id IS NULL OR b.status='moved') AND l.resolution_checked_at<? ORDER BY l.resolution_checked_at,l.source_post_id,l.ordinal LIMIT 500`,
    [new Date(now.getTime() - 6 * 3600000)],
  );
  let resolved = 0;
  for (const row of rows) {
    const blogId = resolvePublication(row.target_url, aliases);
    if (blogId === row.source_blog_id) {
      await pool.query('DELETE FROM relation_links WHERE source_post_id=? AND ordinal=?', [row.source_post_id, row.ordinal]);
      continue;
    }
    await pool.query(
      `UPDATE relation_links SET target_blog_id=?,resolution_checked_at=?,target_reason=?,target_post_id=(SELECT id FROM posts WHERE blog_id=? AND url=? ORDER BY id LIMIT 1) WHERE source_post_id=? AND ordinal=?`,
      [
        blogId,
        now,
        blogId ? 'known-publication' : publicationDecision(row.target_url).reason,
        blogId,
        row.target_url,
        row.source_post_id,
        row.ordinal,
      ],
    );
    if (blogId) resolved++;
  }
  return resolved;
}

/** Budget/deadline scheduling is not evidence of a failed website. */
export async function deferObservation(pool: Pool, post: ArticleRow, now: Date, reason = 'budget-deferred') {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  await pool.query(
    `INSERT INTO relation_observations(post_id,blog_id,status,parser_version,observed_at,next_attempt_at,published_at,error_code)
 VALUES (?,?,'deferred',?,?,?,?,?) ON DUPLICATE KEY UPDATE status=IF(status='reparse-pending',status,IF(last_success_at IS NULL,'deferred',IF(body_text IS NULL,'no-body','ok'))),next_attempt_at=VALUES(next_attempt_at),error_code=VALUES(error_code)`,
    [post.id, post.blog_id, PARSER_VERSION, now, next, post.published_at, reason],
  );
}
/** Explicit repair operation. Never deletes observations/links; a successful v2 crawl replaces each generation. */
export async function requeueLegacyObservations(pool: Pool, { apply = false, limit = 500 }: { apply?: boolean; limit?: number } = {}) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT post_id FROM relation_observations WHERE parser_version<>? AND (status IN ('ok','no-body') OR error_code='budget-exhausted') ORDER BY post_id LIMIT ?`,
    [PARSER_VERSION, Math.max(1, Math.min(2000, limit))],
  );
  if (apply && rows.length)
    await pool.query(
      "UPDATE relation_observations SET status='reparse-pending',etag=NULL,last_modified=NULL,next_attempt_at=UTC_TIMESTAMP(),error_code='parser-upgrade' WHERE post_id IN (?)",
      [rows.map((r) => r.post_id)],
    );
  if (apply && rows.length) await invalidateRelationCache(pool);
  return {
    selected: rows.length,
    applied: apply ? rows.length : 0,
    postIds: rows.map((r) => Number(r.post_id)),
    parserVersion: PARSER_VERSION,
  };
}
