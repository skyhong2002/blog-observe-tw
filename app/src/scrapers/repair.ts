import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { callScraperGateway } from '../ai/gateway.ts';
import { recordCandidateCheck } from '../crawl/candidate-promotion.ts';
import { type CandidateCheck, candidatePreflight, type DiscoveryCandidate, validateCandidate } from '../crawl/candidate-validation.ts';
import type { BlogToCrawl, FeedCrawlerOptions } from '../crawl/feed.ts';
import { reserveBudget } from '../jobs/budget.ts';
import { withJobLease } from '../jobs/lease.ts';
import type { ScraperTrigger } from './contract.ts';
import { type GenerationResult, type GenerationTarget, generateScraper } from './generate.ts';
import type { SandboxRunner } from './sandbox.ts';
import { activateScraper, codeSha256, recordGenerationAttempt, saveValidatedScraper } from './store.ts';

export const GENERATIONS_DAILY = 6;
export const GATEWAY_CALLS_DAILY = 18;
const DAY = 86400000;
/** Candidate review reasons that mean "a publication home, just without a feed". */
export const NO_FEED_REASONS = ['rss_or_article_sitemap_required', 'no_verified_feed_or_sitemap'];
export type RepairTarget =
  | { kind: 'candidate'; trigger: 'new_candidate'; candidate: DiscoveryCandidate }
  | {
      kind: 'blog';
      trigger: Exclude<ScraperTrigger, 'new_candidate'>;
      blog: BlogToCrawl;
      previous?: GenerationTarget['previous'];
    };
export type RepairOptions = FeedCrawlerOptions & {
  apply?: boolean;
  candidateId?: number;
  blogId?: number;
  trigger?: Exclude<ScraperTrigger, 'new_candidate'>;
  signal?: AbortSignal;
  now?: () => Date;
  gateway?: typeof callScraperGateway;
  sandbox?: SandboxRunner;
  /** Operator runs (tools/scraper-once.ts) skip the daily generation budget, never the per-call one. */
  operator?: boolean;
};
export type RepairOutcome = {
  target: { type: 'candidate' | 'blog'; id: number; url: string; trigger: ScraperTrigger } | null;
  status: 'idle' | 'busy' | 'budget' | 'skipped' | 'failed' | 'dry-run' | 'activated' | 'admitted' | 'declined' | 'reviewed';
  reason: string | null;
  generation?: GenerationResult;
  scraperId?: number;
};

// A failed or skipped target waits 14 days; a repaired one 3, so a scraper that breaks at once is not regenerated in a loop.
const cooldown = (type: string, idColumn: string) =>
  `NOT EXISTS (SELECT 1 FROM scraper_generation_attempts a WHERE a.target_type='${type}' AND a.target_id=${idColumn}
    AND a.created_at > IF(a.status IN ('activated','admitted'), ?, ?))`;
const blogRow = (row: RowDataPacket): BlogToCrawl => ({ id: Number(row.id), slug: String(row.slug), url: String(row.url) });

/** Most urgent first: a broken generated scraper, a dead feed, a new feedless home, then unreadable bodies. */
export async function pickRepairTarget(pool: Pool, now: Date, only: Pick<RepairOptions, 'candidateId' | 'blogId' | 'trigger'> = {}) {
  const recent = new Date(now.getTime() - 3 * DAY),
    old = new Date(now.getTime() - 14 * DAY),
    windows = [recent, old];
  if (only.candidateId) {
    const [rows] = await pool.query<RowDataPacket[]>(
      'SELECT id,url,name,status,source_type,source_evidence FROM discovery_candidates WHERE id=?',
      [only.candidateId],
    );
    return rows[0]
      ? ({ kind: 'candidate', trigger: 'new_candidate', candidate: rows[0] as DiscoveryCandidate } satisfies RepairTarget)
      : null;
  }
  if (only.blogId) {
    const [[blog]] = await pool.query<RowDataPacket[]>("SELECT id,slug,url FROM blogs WHERE id=? AND status='verified'", [only.blogId]);
    if (!blog) return null;
    const [[scraper]] = await pool.query<RowDataPacket[]>(
      "SELECT code,list_urls,last_error FROM blog_scrapers WHERE blog_id=? AND status='active' ORDER BY id DESC LIMIT 1",
      [only.blogId],
    );
    return {
      kind: 'blog',
      trigger: only.trigger ?? (scraper ? 'scraper_failing' : 'feed_dead'),
      blog: blogRow(blog),
      ...(scraper ? { previous: previousOf(scraper) } : {}),
    } satisfies RepairTarget;
  }
  const [failing] = await pool.query<RowDataPacket[]>(
    `SELECT b.id,b.slug,b.url,s.code,s.list_urls,s.last_error FROM blog_scrapers s JOIN blogs b ON b.id=s.blog_id
     WHERE s.status='active' AND s.consecutive_failures>=3 AND b.status='verified' AND ${cooldown('blog', 'b.id')}
     ORDER BY s.last_error_at LIMIT 1`,
    windows,
  );
  if (failing[0])
    return { kind: 'blog', trigger: 'scraper_failing', blog: blogRow(failing[0]), previous: previousOf(failing[0]) } satisfies RepairTarget;
  // Feeds that answer but carry no new posts are alive; only fetch failures for 14 days while the crawler still runs count.
  const [dead] = await pool.query<RowDataPacket[]>(
    `SELECT b.id,b.slug,b.url FROM blogs b
     WHERE b.status='verified' AND (b.discovered_at IS NULL OR b.discovered_at<?) AND b.last_crawled_at>?
       AND (b.last_crawl_success_at IS NULL OR b.last_crawl_success_at<?)
       AND NOT EXISTS (SELECT 1 FROM feed_sources f WHERE f.blog_id=b.id AND f.last_success_at>?)
       AND NOT EXISTS (SELECT 1 FROM blog_scrapers s WHERE s.blog_id=b.id AND s.status='active')
       AND ${cooldown('blog', 'b.id')}
     ORDER BY b.last_crawl_success_at LIMIT 1`,
    [old, new Date(now.getTime() - 2 * DAY), old, old, ...windows],
  );
  if (dead[0]) return { kind: 'blog', trigger: 'feed_dead', blog: blogRow(dead[0]) } satisfies RepairTarget;
  // Only a listed home or a proven personal one: most feedless candidates are shops and organizations.
  const [candidates] = await pool.query<RowDataPacket[]>(
    `SELECT c.id,c.url,c.name,c.status,c.source_type,c.source_evidence FROM discovery_candidates c
     WHERE c.status='candidate' AND JSON_UNQUOTE(JSON_EXTRACT(c.source_evidence,'$.automaticReview.reason')) IN (?,?)
       AND (JSON_EXTRACT(c.source_evidence,'$.automaticReview.personalEvidence.personal')=true
         OR JSON_EXTRACT(c.source_evidence,'$.automaticReview.directoryListing') IS NOT NULL)
       AND ${cooldown('candidate', 'c.id')}
     ORDER BY c.id LIMIT 1`,
    [...NO_FEED_REASONS, ...windows],
  );
  if (candidates[0])
    return { kind: 'candidate', trigger: 'new_candidate', candidate: candidates[0] as DiscoveryCandidate } satisfies RepairTarget;
  // The page itself has no recognizable body (not paywalls, excerpts or challenge pages, which a scraper cannot fix).
  const [unreadable] = await pool.query<RowDataPacket[]>(
    `SELECT b.id,b.slug,b.url FROM content_blog_rules r JOIN blogs b ON b.id=r.blog_id
     WHERE b.status='verified' AND r.last_status='missing' AND r.last_error='no-semantic-body' AND r.last_attempt_at>?
       AND (r.last_success_at IS NULL OR r.last_success_at<?)
       AND NOT EXISTS (SELECT 1 FROM blog_scrapers s WHERE s.blog_id=b.id AND s.status='active')
       AND ${cooldown('blog', 'b.id')}
     ORDER BY r.last_attempt_at DESC LIMIT 1`,
    [new Date(now.getTime() - 7 * DAY), old, ...windows],
  );
  if (unreadable[0]) return { kind: 'blog', trigger: 'content_failing', blog: blogRow(unreadable[0]) } satisfies RepairTarget;
  return null;
}
function previousOf(row: RowDataPacket): GenerationTarget['previous'] {
  const urls = typeof row.list_urls === 'string' ? JSON.parse(row.list_urls) : row.list_urls;
  return { code: String(row.code), listUrls: Array.isArray(urls) ? urls : [], error: row.last_error ? String(row.last_error) : null };
}

async function repairCandidate(pool: Pool, target: Extract<RepairTarget, { kind: 'candidate' }>, options: RepairOptions, now: Date) {
  const { candidate } = target;
  const base = { type: 'candidate' as const, id: Number(candidate.id), url: candidate.url, trigger: target.trigger };
  const check = await validateCandidate(candidate, options);
  // A feed appeared, or something other than the feed is missing: that is ordinary candidate review.
  if (check.feed || !NO_FEED_REASONS.includes(check.reason)) {
    const result = await recordCandidateCheck(pool, check, options.apply === true);
    return { target: base, status: 'reviewed', reason: String(result.reason ?? check.reason) } satisfies RepairOutcome;
  }
  const v = check.verification;
  const personal = check.personalEvidence?.personal === true;
  const skip = (reason: string) => ({ target: base, status: 'skipped', reason }) satisfies RepairOutcome;
  if (!personal && !check.directoryListing) return skip(check.personalEvidence?.reason || 'personal_identity_uncertain');
  if (!v?.finalUrl || !v.evidence.identityMatches.length) return skip('identity_not_confirmed');
  if (candidatePreflight({ ...candidate, url: v.finalUrl })) return skip('redirect_not_publication_home');
  const generation = await generate({ home: v.finalUrl, trigger: target.trigger }, pool, options);
  if (!generation.ok || !options.apply)
    return {
      target: base,
      status: generation.ok ? 'dry-run' : 'failed',
      reason: generation.ok ? null : generation.reason,
      generation,
    } satisfies RepairOutcome;
  const scraperId = await saveValidatedScraper(
    pool,
    {
      blogId: null,
      candidateId: candidate.id,
      trigger: target.trigger,
      scraper: generation.scraper,
      actualModel: generation.actualModel,
      validation: generation.report,
    },
    now,
  );
  const admitted: CandidateCheck = {
    ...check,
    eligible: true,
    reason: personal ? 'verified_homepage_and_generated_scraper' : 'verified_homepage_and_generated_scraper_directory_listed',
    feed: {
      url: generation.scraper.listUrls[0],
      type: 'scraper',
      title: Array.from(v.siteName || v.title || candidate.name || '')
        .slice(0, 255)
        .join(''),
      identityUrl: v.finalUrl,
      entries: generation.report.listed,
      sample: generation.report.samples.map((s) => s.url),
    },
    scraper: { id: scraperId, codeSha256: codeSha256(generation.scraper.code) },
  };
  const result = await recordCandidateCheck(pool, admitted, true);
  if (result.status === 'approved')
    return { target: base, status: 'admitted', reason: String(result.reason), generation, scraperId } satisfies RepairOutcome;
  await pool.execute("UPDATE blog_scrapers SET status='rejected' WHERE id=? AND status='validated'", [scraperId]);
  return {
    target: base,
    status: result.status === 'busy' ? 'busy' : 'declined',
    reason: String(result.reason ?? result.status),
    generation,
    scraperId,
  } satisfies RepairOutcome;
}
async function repairBlog(pool: Pool, target: Extract<RepairTarget, { kind: 'blog' }>, options: RepairOptions, now: Date) {
  const base = { type: 'blog' as const, id: target.blog.id, url: target.blog.url, trigger: target.trigger };
  const generation = await generate({ home: target.blog.url, trigger: target.trigger, previous: target.previous }, pool, options);
  if (!generation.ok || !options.apply)
    return {
      target: base,
      status: generation.ok ? 'dry-run' : 'failed',
      reason: generation.ok ? null : generation.reason,
      generation,
    } satisfies RepairOutcome;
  const scraperId = await saveValidatedScraper(
    pool,
    {
      blogId: target.blog.id,
      candidateId: null,
      trigger: target.trigger,
      scraper: generation.scraper,
      actualModel: generation.actualModel,
      validation: generation.report,
    },
    now,
  );
  if (!(await activateScraper(pool, scraperId, target.blog.id, codeSha256(generation.scraper.code), now))) {
    await pool.execute("UPDATE blog_scrapers SET status='rejected' WHERE id=? AND status='validated'", [scraperId]);
    return { target: base, status: 'declined', reason: 'blog_changed_during_generation', generation, scraperId } satisfies RepairOutcome;
  }
  // Bodies the page extractor could not find are due again now that the scraper knows where they are.
  if (target.trigger === 'content_failing')
    await pool.execute("UPDATE content_post_bodies SET next_attempt_at=? WHERE blog_id=? AND status IN ('missing','partial')", [
      now,
      target.blog.id,
    ]);
  return { target: base, status: 'activated', reason: target.trigger, generation, scraperId } satisfies RepairOutcome;
}
function generate(target: GenerationTarget, pool: Pool, options: RepairOptions) {
  return generateScraper(target, {
    fetchOptions: {
      userAgent: options.userAgent,
      delayMs: options.delayMs,
      timeoutMs: options.timeoutMs ?? 15000,
      resolveHost: options.resolveHost,
      fetcher: options.fetcher,
    },
    gateway: options.gateway,
    sandbox: options.sandbox,
    signal: options.signal,
    now: options.now,
    reserveRound: () =>
      reserveBudget(pool, [{ scope: 'scraper:gateway', amount: 1, limit: GATEWAY_CALLS_DAILY }], options.now?.() ?? new Date()),
  });
}

/** One target per run under its own lease; every outcome except an idle or busy run is recorded for cooldown. */
export async function runScraperRepairBatch(pool: Pool, options: RepairOptions = {}): Promise<RepairOutcome> {
  return (
    (await withJobLease(pool, 'scraper-repair', async () => {
      const now = options.now?.() ?? new Date();
      const target = await pickRepairTarget(pool, now, options);
      if (!target) return { target: null, status: 'idle', reason: null } satisfies RepairOutcome;
      if (
        options.apply &&
        !options.operator &&
        !(await reserveBudget(pool, [{ scope: 'scraper:generations', amount: 1, limit: GENERATIONS_DAILY }], now))
      )
        return { target: null, status: 'budget', reason: 'daily_generation_budget_exhausted' } satisfies RepairOutcome;
      let outcome: RepairOutcome;
      try {
        outcome =
          target.kind === 'candidate' ? await repairCandidate(pool, target, options, now) : await repairBlog(pool, target, options, now);
      } catch (error) {
        const id = target.kind === 'candidate' ? Number(target.candidate.id) : target.blog.id;
        const url = target.kind === 'candidate' ? target.candidate.url : target.blog.url;
        outcome = {
          target: { type: target.kind, id, url, trigger: target.trigger },
          status: 'failed',
          reason: error instanceof Error ? error.message.slice(0, 200) : 'repair_failed',
        };
      }
      // A spent budget or a busy admission is no verdict on the target; neither is a dry run.
      if (options.apply && outcome.target && !['busy', 'reviewed'].includes(outcome.status) && outcome.reason !== 'daily_budget_exhausted')
        await recordGenerationAttempt(
          pool,
          {
            targetType: outcome.target.type,
            targetId: outcome.target.id,
            trigger: outcome.target.trigger,
            status: outcome.status,
            reason: outcome.reason,
            rounds: outcome.generation?.rounds ?? 0,
            scraperId: outcome.scraperId ?? null,
            actualModel: outcome.generation?.actualModel ?? null,
            report: outcome.generation ? { report: outcome.generation.report, notes: outcome.generation.notes } : undefined,
          },
          now,
        );
      return outcome;
    })) ?? ({ target: null, status: 'busy', reason: 'lease_held' } satisfies RepairOutcome)
  );
}
