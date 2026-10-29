import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { isAllowedCrawlUrl } from '../crawl/feed.ts';
import { seedIdentityKey } from '../crawl/seed-url-resolution.ts';
import { type GeneratedScraper, generatedScraper, lintScraperCode } from './contract.ts';
import { reportPasses, type ValidationReport } from './generate.ts';
import { activateScraperOnConnection, codeSha256, recordGenerationAttempt, saveValidatedScraper } from './store.ts';

export type SiteDefinition = { version: 1; blogId: number; home: string; authoredBy: string; scraper: GeneratedScraper };
export type SiteValidation = {
  blogId: number;
  home: string;
  codeSha256: string;
  definitionSha256: string;
  checkedAt: string;
  passed: boolean;
  report: ValidationReport;
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
/** A report is bound to the exact checked definition, not just a similarly named website. */
export function checkedSiteDefinition(raw: unknown, validation: unknown, now = Date.now()) {
  const d = object(raw),
    v = object(validation),
    s = object(d.scraper);
  if (
    d.version !== 1 ||
    !Number.isSafeInteger(d.blogId) ||
    Number(d.blogId) < 1 ||
    typeof d.home !== 'string' ||
    d.home.length > 1024 ||
    !isAllowedCrawlUrl(d.home) ||
    d.authoredBy !== 'gpt-6.1-sol'
  )
    throw Error('invalid_site_definition');
  if (!Array.isArray(s.listUrls) || !s.listUrls.length || s.noArticles === true || typeof s.code !== 'string' || lintScraperCode(s.code))
    throw Error('unusable_site_definition');
  const scraper = { ...generatedScraper(s, d.home), render: s.render === true };
  const stamp = typeof v.checkedAt === 'string' ? Date.parse(v.checkedAt) : NaN;
  if (
    v.blogId !== d.blogId ||
    v.home !== d.home ||
    v.codeSha256 !== codeSha256(scraper.code) ||
    v.definitionSha256 !== sha(JSON.stringify(raw)) ||
    v.passed !== true ||
    !Number.isFinite(stamp) ||
    Math.abs(now - stamp) > 86400000
  )
    throw Error('fresh_matching_validation_required');
  const report = object(v.report);
  if (
    !Number.isSafeInteger(report.listed) ||
    Number(report.listed) < 1 ||
    !Array.isArray(report.samples) ||
    !Array.isArray(report.problems) ||
    !reportPasses(report as ValidationReport)
  )
    throw Error('passing_validation_required');
  return {
    definition: { version: 1, blogId: Number(d.blogId), home: d.home, authoredBy: String(d.authoredBy), scraper } as SiteDefinition,
    validation: v as SiteValidation,
  };
}

/** One short transaction preserves status, current working repairs, provenance, and audit together. */
export async function installSiteScraper(pool: Pool, raw: unknown, validation: unknown, now = new Date()) {
  const checked = checkedSiteDefinition(raw, validation, now.getTime()),
    d = checked.definition;
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const [[blog]] = await c.query<RowDataPacket[]>('SELECT id,url,status FROM blogs WHERE id=? FOR UPDATE', [d.blogId]);
    if (blog?.status !== 'verified' || !blog.url || seedIdentityKey(String(blog.url)) !== seedIdentityKey(d.home)) {
      await c.rollback();
      return { blogId: d.blogId, status: 'held', reason: 'publication_changed_or_canonical_review_required' };
    }
    const [[active]] = await c.query<RowDataPacket[]>(
      "SELECT id,code_sha256 FROM blog_scrapers WHERE blog_id=? AND status='active' ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [d.blogId],
    );
    if (active) {
      await c.rollback();
      return {
        blogId: d.blogId,
        status: 'unchanged',
        reason: active.code_sha256 === codeSha256(d.scraper.code) ? 'already_installed' : 'existing_active_scraper_preserved',
        scraperId: Number(active.id),
      };
    }
    const [[posts]] = await c.query<RowDataPacket[]>('SELECT COUNT(*) n FROM posts WHERE blog_id=?', [d.blogId]);
    const trigger = Number(posts.n) ? 'content_failing' : 'feed_dead';
    const evidence = {
      ...checked.validation.report,
      provenance: {
        authoredBy: d.authoredBy,
        method: 'operator-agent-authored',
        definitionSha256: checked.validation.definitionSha256,
        checkedAt: checked.validation.checkedAt,
      },
    };
    const scraperId = await saveValidatedScraper(
      c,
      { blogId: d.blogId, candidateId: null, trigger, scraper: d.scraper, actualModel: d.authoredBy, validation: evidence },
      now,
    );
    if (!(await activateScraperOnConnection(c, scraperId, d.blogId, codeSha256(d.scraper.code), now))) throw Error('activation_changed');
    if (!Number(posts.n))
      await c.execute(
        `UPDATE discovery_candidates SET source_evidence=JSON_REMOVE(JSON_SET(source_evidence,'$.curatedContent.status','pending'),'$.curatedContent.lastAttemptAt') WHERE status='approved' AND JSON_EXTRACT(source_evidence,'$.automaticReview.blogId')=? AND JSON_EXTRACT(source_evidence,'$.curatedListings') IS NOT NULL`,
        [d.blogId],
      );
    await recordGenerationAttempt(
      c,
      {
        targetType: 'blog',
        targetId: d.blogId,
        trigger,
        status: 'activated',
        reason: 'operator-agent-authored',
        rounds: 0,
        scraperId,
        actualModel: d.authoredBy,
        report: evidence,
      },
      now,
    );
    await c.commit();
    return { blogId: d.blogId, status: 'activated', scraperId, postsBefore: Number(posts.n) };
  } catch (error) {
    await c.rollback();
    throw error;
  } finally {
    c.release();
  }
}
