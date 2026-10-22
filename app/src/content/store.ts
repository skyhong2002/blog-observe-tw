import { createHash } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { canonicalArticleUrl } from '../crawl/feed.ts';
import { normalizeLink, type PublicationAlias, resolvePublication } from '../relations/identity.ts';
import { PARSER_VERSION, type ParsedArticle, type ParsedLink, parseArticleLinks } from '../relations/parser.ts';
import { discoverWordpressApi, extractContent, inPublication } from './article-content.ts';
import { CONTENT_VERSION, type ContentEvidence, type ContentRule, type ContentSql, type ExtractedContent } from './contracts.ts';
import { inferredRule, validateRules } from './registry.ts';

/** No network. May run at startup or before a bounded batch; every enrolled blog gets a durable rule. */
export async function initializeContentRules(db: ContentSql, now = new Date()) {
  await db.execute(
    `INSERT IGNORE INTO content_blog_rules(blog_id,platform,adapter_id,adapter_version,rules,rule_source,last_status,updated_at)
 SELECT b.id,'generic','generic-public',?,'{}','inferred',IF(EXISTS(SELECT 1 FROM posts p WHERE p.blog_id=b.id),'pending','no-posts'),? FROM blogs b WHERE b.status='verified' AND NOT EXISTS (SELECT 1 FROM content_blog_rules r WHERE r.blog_id=b.id)`,
    [CONTENT_VERSION, now],
  );
}
const json = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'string')
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
};
export async function loadContentRule(db: ContentSql, blogId: number, blogUrl: string): Promise<ContentRule> {
  const [rows] = await db.execute<RowDataPacket[]>('SELECT * FROM content_blog_rules WHERE blog_id=?', [blogId]);
  const r = rows[0];
  return r
    ? {
        blogId,
        platform: r.platform,
        adapterId: r.adapter_id,
        version: r.adapter_version,
        rules: validateRules(json(r.rules)),
        revision: Number(r.rule_revision),
        source: r.rule_source === 'manual' ? 'manual' : 'inferred',
      }
    : inferredRule(blogId, blogUrl);
}
export function shouldReplaceContent(
  previous: { status: string; completeness: string; sourceKind?: string; obtainedAt: Date; modifiedAt: Date | null } | null,
  next: ExtractedContent,
  evidence: ContentEvidence,
  now: Date,
): boolean {
  if (!previous) return true;
  if (['ok', 'partial'].includes(previous.status) && ['missing', 'blocked'].includes(next.status)) return false;
  if (previous.status === 'ok' && (next.status !== 'ok' || next.completeness !== 'full')) return false;
  const ranks: Record<string, number> = { 'rss-content': 3, 'atom-content': 3, 'wordpress-api': 3, 'article-html': 2 };
  if (
    previous.status === 'ok' &&
    next.status === 'ok' &&
    (ranks[previous.sourceKind ?? ''] ?? 0) > (ranks[evidence.kind] ?? 0) &&
    !(previous.modifiedAt && evidence.modifiedAt && evidence.modifiedAt > previous.modifiedAt)
  )
    return false;
  if (previous.modifiedAt && evidence.modifiedAt && evidence.modifiedAt < previous.modifiedAt) return false;
  if ((evidence.obtainedAt ?? now) < previous.obtainedAt && !(next.status === 'ok' && previous.status !== 'ok')) return false;
  return true;
}
export async function recordContentAttempt(
  db: ContentSql,
  input: {
    postId: number;
    blogId: number;
    sourceKind: string;
    sourceUrl: string;
    adapterId: string;
    status: string;
    reason?: string | null;
    hash?: string | null;
    rawBytes?: number;
  },
  now = new Date(),
) {
  const id = createHash('sha256')
    .update(JSON.stringify([input.postId, input.sourceUrl, input.status, input.reason, input.hash, now.toISOString()]))
    .digest('hex');
  await db.execute(
    `INSERT IGNORE INTO content_attempts(id,post_id,blog_id,source_kind,source_url,adapter_id,status,reason,content_hash,raw_bytes,observed_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.postId,
      input.blogId,
      input.sourceKind,
      input.sourceUrl.slice(0, 1024),
      input.adapterId,
      input.status,
      input.reason ?? null,
      input.hash ?? null,
      input.rawBytes ?? 0,
      now,
    ],
  );
  await db.execute(
    `DELETE FROM content_attempts WHERE post_id=? AND id NOT IN (SELECT id FROM (SELECT id FROM content_attempts WHERE post_id=? ORDER BY observed_at DESC,id DESC LIMIT 20) kept)`,
    [input.postId, input.postId],
  );
}
/** Caller owns the transaction; locks the article before replacing its internal generation. Never performs I/O. */
export async function ingestContentEvidence(
  db: ContentSql,
  evidence: ContentEvidence,
  now = new Date(),
): Promise<{ postId: number | null; status: string; changed: boolean; hash: string | null }> {
  const [blogs] = await db.execute<RowDataPacket[]>('SELECT id,url,status FROM blogs WHERE id=? FOR UPDATE', [evidence.blogId]);
  const blog = blogs[0];
  if (blog?.status !== 'verified' || !blog.url || canonicalArticleUrl(blog.url) !== canonicalArticleUrl(evidence.blogUrl))
    return { postId: null, status: 'publication-changed', changed: false, hash: null };
  const url = normalizeLink(evidence.articleUrl),
    source = normalizeLink(evidence.sourceUrl);
  if (
    !url ||
    !source ||
    !inPublication(url, evidence.blogUrl) ||
    (evidence.kind === 'article-html' && !inPublication(source, evidence.blogUrl))
  )
    return { postId: null, status: 'outside-publication', changed: false, hash: null };
  const [posts] = await db.execute<RowDataPacket[]>('SELECT id FROM posts WHERE blog_id=? AND url=? ORDER BY id LIMIT 1 FOR UPDATE', [
    evidence.blogId,
    canonicalArticleUrl(url),
  ]);
  const postId = Number(posts[0]?.id) || null;
  if (!postId || (evidence.postId && evidence.postId !== postId))
    return { postId: null, status: 'missing-post', changed: false, hash: null };
  let rule = await loadContentRule(db, evidence.blogId, evidence.blogUrl);
  const originalRule = rule;
  // Only a whole article page names the platform (a feed's content is the author's text, see inferPlatform). An inferred
  // platform is replaced whenever the page positively names another one, so a wrong guess does not stay for good; the
  // page saying nothing changes nothing.
  const inferred = inferredRule(evidence.blogId, evidence.articleUrl, evidence.kind === 'article-html' ? evidence.html : '');
  const platformCorrected = rule.source === 'inferred' && inferred.platform !== 'generic' && inferred.platform !== rule.platform;
  if (platformCorrected) rule = { ...inferred, revision: rule.revision };
  const api = evidence.kind === 'article-html' ? discoverWordpressApi(evidence.html, evidence.articleUrl) : null;
  if (api && rule.source !== 'manual')
    rule = { ...rule, platform: 'wordpress', adapterId: 'wordpress-public', rules: { ...rule.rules, apiBase: api } };
  const extracted = extractContent(evidence, rule);
  const [previous] = await db.execute<RowDataPacket[]>(
    'SELECT status,completeness,source_kind,obtained_at,source_updated_at,content_hash,next_attempt_at FROM content_post_bodies WHERE post_id=? FOR UPDATE',
    [postId],
  );
  const old = previous[0];
  const replace = shouldReplaceContent(
    old
      ? {
          status: old.status,
          completeness: old.completeness,
          sourceKind: old.source_kind,
          obtainedAt: new Date(old.obtained_at),
          modifiedAt: old.source_updated_at ? new Date(old.source_updated_at) : null,
        }
      : null,
    extracted,
    evidence,
    now,
  );
  const adopt = replace && extracted.status === 'ok';
  const persistedRule = adopt
    ? { ...rule, platform: extracted.platform, adapterId: extracted.adapterId }
    : platformCorrected
      ? rule
      : originalRule;
  await db.execute(
    `INSERT INTO content_blog_rules(blog_id,platform,adapter_id,adapter_version,rules,rule_source,rule_revision,last_method,last_status,last_error,last_attempt_at,last_success_at,updated_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE platform=IF(rule_source='manual',platform,VALUES(platform)),adapter_id=IF(rule_source='manual',adapter_id,VALUES(adapter_id)),adapter_version=IF(rule_source='manual',adapter_version,VALUES(adapter_version)),rules=IF(rule_source='manual',rules,VALUES(rules)),last_method=VALUES(last_method),last_status=VALUES(last_status),last_error=VALUES(last_error),last_attempt_at=VALUES(last_attempt_at),last_success_at=COALESCE(VALUES(last_success_at),last_success_at),updated_at=VALUES(updated_at)`,
    [
      evidence.blogId,
      persistedRule.platform,
      persistedRule.adapterId,
      CONTENT_VERSION,
      JSON.stringify(persistedRule.rules),
      rule.source,
      rule.revision,
      evidence.kind,
      extracted.status,
      extracted.reason,
      now,
      extracted.status === 'ok' ? now : null,
      now,
    ],
  );
  await recordContentAttempt(
    db,
    {
      postId,
      blogId: evidence.blogId,
      sourceKind: evidence.kind,
      sourceUrl: source,
      adapterId: extracted.adapterId,
      status: replace ? extracted.status : 'retained',
      reason: replace ? extracted.reason : (extracted.reason ?? 'better-or-newer-body-retained'),
      hash: extracted.hash,
      rawBytes: Buffer.byteLength(evidence.html),
    },
    now,
  );
  if (!replace) {
    await db.execute('UPDATE content_post_bodies SET last_attempt_at=?,next_attempt_at=?,last_error=? WHERE post_id=?', [
      now,
      new Date(now.getTime() + 30 * 86400000),
      'better-or-newer-body-retained',
      postId,
    ]);
    return { postId, status: old.status, changed: false, hash: old.content_hash };
  }
  const pageLinks =
    evidence.kind === 'article-html'
      ? parseArticleLinks(evidence.html, evidence.sourceUrl, evidence.blogId, []).links.filter((l) => l.location !== 'body')
      : [];
  const bodyLinks = parseArticleLinks(`<article>${extracted.bodyHtml}</article>`, evidence.articleUrl, evidence.blogId, []).links;
  const links = [...bodyLinks, ...pageLinks].slice(0, 100).map((l, ordinal) => ({ ...l, ordinal }));
  const obtained = evidence.obtainedAt ?? now;
  const retryAt =
    extracted.status === 'partial' && evidence.kind !== 'article-html' && !old
      ? now
      : new Date(now.getTime() + (extracted.status === 'missing' ? 7 : 30) * 86400000);
  if (old?.next_attempt_at && extracted.status !== 'ok' && evidence.kind !== 'article-html' && new Date(old.next_attempt_at) > now)
    retryAt.setTime(new Date(old.next_attempt_at).getTime());
  await db.execute(
    `INSERT INTO content_post_bodies(post_id,blog_id,body_text,body_html,content_hash,revision,completeness,status,source_kind,source_url,article_url,adapter_id,adapter_version,rule_revision,obtained_at,source_updated_at,next_attempt_at,last_attempt_at,last_error,etag,last_modified,image_only,truncated,coverage,page_links)
 VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE revision=revision+IF(content_hash<=>VALUES(content_hash),0,1),body_text=VALUES(body_text),body_html=VALUES(body_html),content_hash=VALUES(content_hash),completeness=VALUES(completeness),status=VALUES(status),source_kind=VALUES(source_kind),source_url=VALUES(source_url),article_url=VALUES(article_url),adapter_id=VALUES(adapter_id),adapter_version=VALUES(adapter_version),rule_revision=VALUES(rule_revision),obtained_at=VALUES(obtained_at),source_updated_at=COALESCE(VALUES(source_updated_at),source_updated_at),next_attempt_at=VALUES(next_attempt_at),last_attempt_at=VALUES(last_attempt_at),last_error=VALUES(last_error),etag=VALUES(etag),last_modified=VALUES(last_modified),image_only=VALUES(image_only),truncated=VALUES(truncated),coverage=VALUES(coverage),page_links=VALUES(page_links)`,
    [
      postId,
      evidence.blogId,
      extracted.bodyText || null,
      extracted.bodyHtml || null,
      extracted.hash,
      extracted.completeness,
      extracted.status,
      evidence.kind,
      source,
      url,
      extracted.adapterId,
      CONTENT_VERSION,
      rule.revision,
      obtained,
      evidence.modifiedAt ?? null,
      retryAt,
      now,
      extracted.reason,
      evidence.etag?.slice(0, 512) || null,
      evidence.lastModified?.slice(0, 255) || null,
      extracted.imageOnly,
      extracted.truncated || bodyLinks.length + pageLinks.length > 100,
      extracted.coverage,
      // Per-entry version preserves the existing array shape for rollback readers.
      JSON.stringify(links.map((link) => ({ ...link, parserVersion: PARSER_VERSION }))),
    ],
  );
  return { postId, status: extracted.status, changed: old?.content_hash !== extracted.hash, hash: extracted.hash };
}
/** Read private normalized evidence; downstream routes must never serialize this row wholesale. */
export async function storedRelationContent(
  db: ContentSql,
  postId: number,
  blogId: number,
  aliases: PublicationAlias[],
): Promise<{ parsed: ParsedArticle; hash: string; sourceUrl: string; obtainedAt: Date } | null> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM content_post_bodies WHERE post_id=? AND blog_id=? AND status='ok'", [
    postId,
    blogId,
  ]);
  const r = rows[0];
  if (!r) return null;
  const parsed = parseArticleLinks(`<article>${r.body_html || ''}</article>`, r.article_url, blogId, aliases);
  let links: (ParsedLink & { parserVersion?: string })[] | null = null;
  try {
    links = typeof r.page_links === 'string' ? JSON.parse(r.page_links) : (r.page_links ?? null);
  } catch {
    /* Preserve body extraction even with an older malformed metadata row. */
  }
  const validSnapshot =
    Array.isArray(links) &&
    links.length <= 100 &&
    links.every(
      (l) =>
        l &&
        typeof l.targetUrl === 'string' &&
        typeof l.anchorText === 'string' &&
        typeof l.context === 'string' &&
        [...l.anchorText].length <= 255 &&
        [...l.context].length <= 320 &&
        ['body', 'blogroll', 'sidebar', 'comment'].includes(l.location),
    );
  // Current normalized body HTML is authoritative. Old page_links must never
  // resurrect obsolete body links or override current structural classification.
  const currentSnapshot = validSnapshot && links!.every((link) => link.parserVersion === PARSER_VERSION);
  parsed.nonBodySnapshotState = r.page_links == null ? 'none' : currentSnapshot ? 'current-parser' : 'unverified';
  if (currentSnapshot) {
    const nonBodyLinks = links!
      .filter((l) => l.location !== 'body' && normalizeLink(l.targetUrl))
      .map((l) => ({
        targetUrl: normalizeLink(l.targetUrl)!,
        anchorText: l.anchorText,
        context: l.context,
        location: l.location,
        ordinal: 0,
        targetBlogId: resolvePublication(l.targetUrl, aliases),
      }))
      .filter((l) => l.targetBlogId !== blogId);
    const merged = [...parsed.links, ...nonBodyLinks];
    parsed.links = merged.slice(0, 100).map((l, ordinal) => ({ ...l, ordinal }));
    parsed.truncated ||= merged.length > 100;
  } else if (r.page_links != null) {
    // The full old page is unavailable. Keep original DB JSON unchanged, and
    // disclose missing non-body revalidation rather than claiming a full reparse.
    parsed.truncated = true;
  }
  parsed.extraction = `content:${r.source_kind}:${String(r.content_hash).slice(0, 24)}`;
  parsed.truncated ||= Boolean(r.truncated);
  parsed.externalLinks = Math.max(parsed.externalLinks, parsed.links.length);
  // Hash includes link generation and content source; topic freshness also reads the private body hash directly.
  parsed.contentHash = createHash('sha256')
    .update(JSON.stringify([r.content_hash, parsed.links, CONTENT_VERSION, PARSER_VERSION, parsed.nonBodySnapshotState]))
    .digest('hex');
  return { parsed, hash: r.content_hash, sourceUrl: r.source_url, obtainedAt: new Date(r.obtained_at) };
}
