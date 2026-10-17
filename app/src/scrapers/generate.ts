import * as cheerio from 'cheerio';
import { callScraperGateway, SCRAPER_INPUT_LIMIT } from '../ai/gateway.ts';
import { extractContent } from '../content/article-content.ts';
import { CONTENT_VERSION, type ContentRule } from '../content/contracts.ts';
import type { FeedCrawlerOptions } from '../crawl/feed.ts';
import { compactHtml, likelyArticleUrl } from './compact-html.ts';
import {
  type GeneratedScraper,
  generatedScraper,
  type ListedPost,
  lintScraperCode,
  listedPage,
  parsedPost,
  SCRAPER_POLICY,
  type ScraperTrigger,
  scraperArticleHtml,
} from './contract.ts';
import { fetchFailure, fetchHtml } from './pages.ts';
import { fetchRendered, renderAvailable } from './render.ts';
import { runInSandbox, type SandboxPage, type SandboxRunner } from './sandbox.ts';

export const MAX_ROUNDS = 3;
const MAX_PAGES_PER_GENERATION = 14;
const SAMPLE_POSTS = 3;
export type Problem = { stage: 'lint' | 'list' | 'next' | 'post'; url: string | null; reason: string };
export type SampleReport = {
  url: string;
  title: string;
  publishedAt: string | null;
  author: string | null;
  tags: number;
  bodyChars: number;
};
export type ValidationReport = {
  policy: string;
  listUrl: string | null;
  listed: number;
  nextPage: { url: string; listed: number } | null;
  samples: SampleReport[];
  problems: Problem[];
};
export type GenerationTarget = {
  home: string;
  trigger: ScraperTrigger;
  /** The scraper being replaced and why, so the model repairs it instead of starting blind. */
  previous?: { code: string; listUrls: string[]; error: string | null };
};
export type GenerationDeps = {
  fetchOptions: FeedCrawlerOptions;
  gateway?: typeof callScraperGateway;
  sandbox?: SandboxRunner;
  signal?: AbortSignal;
  maxRounds?: number;
  /** Test seams for the headless browser (render.ts). */
  render?: typeof fetchRendered;
  renderAvailable?: boolean;
  /** Reserves one model call against the daily budget; false stops before calling. */
  reserveRound?: () => Promise<boolean>;
  now?: () => Date;
};
export type GenerationResult =
  | { ok: true; scraper: GeneratedScraper; actualModel: string; rounds: number; report: ValidationReport; notes: string[] }
  | { ok: false; reason: string; rounds: number; report: ValidationReport | null; actualModel: string | null; notes: string[] };

const normal = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const RULE: ContentRule = {
  blogId: 0,
  platform: 'generic',
  adapterId: 'generated-scraper',
  version: CONTENT_VERSION,
  rules: {},
  revision: 0,
  source: 'inferred',
};
/** Page text and title metadata: a parsed title must come from the page, not from the code. */
function pageCorpus(html: string) {
  const $ = cheerio.load(html);
  const meta = $('meta[content]')
    .map((_, el) => $(el).attr('content'))
    .get()
    .join(' ');
  const ld = $('script[type="application/ld+json"],script[type="application/json"]').text();
  $('script,style,noscript').remove();
  return normal(`${$('title').text()} ${meta} ${ld} ${$.root().text()}`);
}

/** Raw or rendered pages, by the round's mode; a page fetched in both modes counts twice against the budget. */
export class PageCache {
  readonly pages = new Map<string, SandboxPage>();
  fetched = 0;
  render = false;
  private readonly options: FeedCrawlerOptions;
  private readonly renderer: typeof fetchRendered;
  constructor(options: FeedCrawlerOptions, renderer: typeof fetchRendered = fetchRendered) {
    this.options = options;
    this.renderer = renderer;
  }
  /** The page as last fetched, in the current mode (for showing the model what its code failed on). */
  seen(url: string) {
    return this.pages.get(`${this.render}:${url}`);
  }
  async get(url: string, listing = false): Promise<SandboxPage> {
    const key = `${this.render}:${url}`;
    const hit = this.pages.get(key);
    if (hit && (listing || !hit.xml)) return hit;
    if (hit) throw Error('content_type_mismatch');
    if (++this.fetched > MAX_PAGES_PER_GENERATION) throw Error('generation_page_budget_exhausted');
    const page = await (this.render ? this.renderer : fetchHtml)(url, this.options, listing);
    this.pages.set(key, page);
    return page;
  }
}
/** A page whose articles only a browser would see: little text, few own links, no embedded data. */
export function scriptShell(html: string, url: string) {
  const $ = cheerio.load(html);
  if ($('script[type="application/json"],script#__NEXT_DATA__,script#__NUXT_DATA__').length) return false;
  if (/window\.__(?:NUXT|INITIAL_STATE|APOLLO_STATE|PRELOADED_STATE)__\s*=/.test($('script:not([src])').text())) return false;
  const host = new URL(url).hostname;
  const links = $('a[href]')
    .toArray()
    .filter((a) => {
      try {
        return new URL($(a).attr('href') || '', url).hostname === host;
      } catch {
        return false;
      }
    }).length;
  $('script,style,noscript,template').remove();
  return $('body').text().replace(/\s+/g, '').length < 400 && links < 8;
}

/** Runs the scraper on live pages. Passing means: articles are listed, and sampled articles parse with a title found
 * on the page, distinct titles and bodies the content extractor accepts. A missing date is reported, not fatal: the
 * crawl dates an undated article by when it was first fetched (run.ts). */
export async function validateScraper(
  scraper: GeneratedScraper,
  home: string,
  pages: PageCache,
  sandbox: SandboxRunner,
  now = new Date(),
): Promise<ValidationReport> {
  const report: ValidationReport = { policy: SCRAPER_POLICY, listUrl: null, listed: 0, nextPage: null, samples: [], problems: [] };
  const lint = lintScraperCode(scraper.code);
  if (lint) {
    report.problems.push({ stage: 'lint', url: null, reason: lint });
    return report;
  }
  let posts: ListedPost[] = [];
  let next: string | null = null;
  for (const url of scraper.listUrls) {
    try {
      const page = await pages.get(url, true);
      const listed = listedPage(await sandbox(scraper.code, 'listPosts', page), page.url, home, now);
      if (!listed.posts.length) {
        report.problems.push({ stage: 'list', url, reason: 'no_articles_listed' });
        continue;
      }
      report.listUrl = url;
      posts = listed.posts;
      next = listed.next;
      break;
    } catch (error) {
      report.problems.push({
        stage: 'list',
        url,
        reason: error instanceof Error && /^scraper_/.test(error.message) ? error.message : fetchFailure(error),
      });
    }
  }
  report.listed = posts.length;
  if (!posts.length) return report;
  if (next && scraper.maxPages > 1) {
    try {
      const page = await pages.get(next, true);
      const older = listedPage(await sandbox(scraper.code, 'listPosts', page), page.url, home, now);
      const fresh = older.posts.filter((p) => !posts.some((q) => q.url === p.url));
      report.nextPage = { url: next, listed: fresh.length };
      if (!fresh.length) report.problems.push({ stage: 'next', url: next, reason: 'next_page_lists_no_new_articles' });
    } catch (error) {
      report.problems.push({
        stage: 'next',
        url: next,
        reason: error instanceof Error && /^scraper_/.test(error.message) ? error.message : fetchFailure(error),
      });
    }
  }
  const titles = new Set<string>();
  const bodies = new Set<string>();
  for (const listed of posts.slice(0, SAMPLE_POSTS)) {
    try {
      const page = await pages.get(listed.url);
      const post = parsedPost(await sandbox(scraper.code, 'parsePost', page), now);
      if (!post) {
        report.problems.push({ stage: 'post', url: listed.url, reason: 'post_missing_title_or_body' });
        continue;
      }
      const publishedAt = post.publishedAt ?? listed.publishedAt;
      const extracted = extractContent(
        {
          blogId: 0,
          blogUrl: home,
          articleUrl: listed.url,
          sourceUrl: listed.url,
          html: scraperArticleHtml(post, listed.url),
          kind: 'article-html',
        },
        RULE,
      );
      const bodyChars = Array.from(extracted.bodyText).length;
      const reasons = [
        !pageCorpus(page.html).includes(normal(post.title)) && 'title_not_on_page',
        !['ok', 'partial'].includes(extracted.status) && `body_${extracted.status}`,
        bodyChars < 50 && 'body_too_short',
        titles.has(normal(post.title)) && 'title_repeats_other_article',
        extracted.hash && bodies.has(extracted.hash) && 'body_repeats_other_article',
      ].filter((r): r is string => Boolean(r));
      titles.add(normal(post.title));
      if (extracted.hash) bodies.add(extracted.hash);
      for (const reason of reasons) report.problems.push({ stage: 'post', url: listed.url, reason });
      report.samples.push({
        url: listed.url,
        title: post.title,
        publishedAt: publishedAt?.toISOString() ?? null,
        author: post.author,
        tags: post.tags.length,
        bodyChars,
      });
    } catch (error) {
      report.problems.push({
        stage: 'post',
        url: listed.url,
        reason: error instanceof Error && /^scraper_/.test(error.message) ? error.message : fetchFailure(error),
      });
    }
  }
  if (report.samples.length && Math.max(...report.samples.map((s) => s.bodyChars)) < 200)
    report.problems.push({ stage: 'post', url: null, reason: 'bodies_all_under_200_characters' });
  return report;
}
export const reportPasses = (report: ValidationReport) =>
  report.listed > 0 && report.samples.length >= Math.min(SAMPLE_POSTS, report.listed) && !report.problems.some((p) => p.stage !== 'next');

/** The model's view: page skeletons it needs plus, after a failed round, its code and what went wrong. */
type ShownPage = SandboxPage & { role: string; rendered: boolean };
function modelInput(target: GenerationTarget, pages: ShownPage[], feedback?: object) {
  const build = (budget: number) =>
    JSON.stringify({
      task: 'Write the scraper for this blog.',
      home: target.home,
      ...(target.previous && !feedback
        ? { replacing: { reason: `${target.trigger}: ${target.previous.error ?? 'stopped working'}`, ...target.previous } }
        : {}),
      ...(feedback ? { previousAttempt: feedback } : {}),
      untrustedPages: pages.map((p) => ({
        role: p.role,
        url: p.url,
        ...(p.xml ? { xml: true } : {}),
        ...(p.rendered ? { rendered: true } : {}),
        skeleton: compactHtml(p.html, budget, p.xml),
      })),
    });
  for (const budget of [60, 40, 25, 15].map((k) => Math.floor((k * 1024) / Math.max(1, pages.length / 2)))) {
    const input = build(budget);
    if (Buffer.byteLength(input) <= SCRAPER_INPUT_LIMIT) return input;
  }
  throw Error('generation_input_too_large');
}

/** Problems a browser could fix: nothing listed, or article pages without a parseable body. */
const UNSEEN = /^(?:no_articles_listed|post_missing_title_or_body|body_(?:missing|blocked))$/;
export async function generateScraper(target: GenerationTarget, deps: GenerationDeps): Promise<GenerationResult> {
  const gateway = deps.gateway ?? callScraperGateway;
  const sandbox = deps.sandbox ?? runInSandbox;
  const now = deps.now ?? (() => new Date());
  const canRender = deps.renderAvailable ?? renderAvailable();
  const pages = new PageCache(deps.fetchOptions, deps.render);
  const notes: string[] = [];
  let rounds = 0;
  let report: ValidationReport | null = null;
  let actualModel: string | null = null;
  let last: GeneratedScraper | null = null;
  let shown: ShownPage[] = [];
  const fail = (reason: string) => ({ ok: false as const, reason, rounds, report, actualModel, notes });
  /** The home and one likely article, in the current mode. */
  const start = async () => {
    const home = await pages.get(target.home);
    shown = [{ role: 'home', rendered: pages.render, ...home }];
    const sample = likelyArticleUrl(home.html, home.url);
    if (sample) {
      try {
        shown.push({ role: 'article', rendered: pages.render, ...(await pages.get(sample)) });
      } catch {
        /* The round can still work from the home alone. */
      }
    }
    return home;
  };
  /** Rendered pages from the next round on; on a browser failure the raw pages stay. */
  const startRendered = async () => {
    const raw = shown;
    pages.render = true;
    try {
      return await start();
    } catch {
      pages.render = false;
      shown = raw;
      return null;
    }
  };
  let homePage: SandboxPage;
  try {
    homePage = await start();
  } catch (error) {
    return fail(`home_${fetchFailure(error)}`);
  }
  // A script-only home is read rendered from the first round.
  if (canRender && scriptShell(homePage.html, homePage.url)) homePage = (await startRendered()) ?? homePage;
  while (rounds < (deps.maxRounds ?? MAX_ROUNDS)) {
    if (deps.signal?.aborted) return fail('batch_stopped');
    if (deps.reserveRound && !(await deps.reserveRound())) return fail('daily_budget_exhausted');
    const feedback =
      last && report
        ? {
            code: last.code,
            listUrls: last.listUrls,
            problems: report.problems.slice(0, 20),
            samples: report.samples,
            ...(pages.render && !last.render ? { note: 'Those pages were raw HTML; the pages below are now rendered by a browser.' } : {}),
          }
        : undefined;
    let input: string;
    try {
      input = modelInput(target, shown, feedback);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'generation_input_failed');
    }
    rounds++;
    try {
      const reply = await gateway(input, { signal: deps.signal });
      actualModel = reply.actualModel;
      last = { ...generatedScraper(reply.result, homePage.url), render: pages.render };
      if (last.notes) notes.push(last.notes);
    } catch (error) {
      return fail(error instanceof Error ? error.message : 'gateway_request_failed');
    }
    report = await validateScraper(last, homePage.url, pages, sandbox, now());
    if (reportPasses(report)) {
      // A pagination problem is not fatal: the scraper then reads only its first listing page.
      const scraper = report.problems.length ? { ...last, maxPages: 1 } : last;
      return { ok: true, scraper, actualModel: actualModel!, rounds, report, notes };
    }
    // What the raw HTML hides may be there once scripts run: one switch to rendered pages before giving up.
    const unseen = last.needsRender || last.noArticles || report.problems.some((p) => UNSEEN.test(p.reason));
    if (!pages.render && canRender && unseen) {
      const rendered = await startRendered();
      if (rendered) {
        homePage = rendered;
        continue;
      }
    }
    // The model and the validation agree the site has nothing to collect yet: no further rounds.
    if (last.noArticles && report.listed === 0) return fail('site_has_no_articles');
    // Show the model the pages its code failed on next round.
    for (const problem of report.problems) {
      const page = problem.url ? pages.seen(problem.url) : null;
      if (page && !shown.some((s) => s.url === page.url) && shown.length < 5)
        shown.push({ role: problem.stage === 'post' ? 'article' : 'listing', rendered: pages.render, ...page });
    }
  }
  const reason = report?.problems[0]?.reason ?? 'validation_failed';
  return fail(`validation_failed:${reason}`);
}
