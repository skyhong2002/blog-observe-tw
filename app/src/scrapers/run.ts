import { type BlogToCrawl, boundedFeedContent, type FeedCrawlerOptions, type FeedEntry, publicSummary } from '../crawl/feed.ts';
import { vocusArticleCandidate, vocusProofFromHtml, vocusProofMatches } from '../crawl/vocus-publication.ts';
import { type ListedPost, listedPage, MAX_HISTORY_PAGES, MAX_LIST_PAGES, parsedPost, scraperArticleHtml } from './contract.ts';
import { fetchFailure, fetchHtml } from './pages.ts';
import { fetchRendered } from './render.ts';
import { runInSandbox, type SandboxRunner } from './sandbox.ts';
import type { StoredScraper } from './store.ts';

export type ScrapeResult = { entries: FeedEntry[]; listed: number; error: string | null };
const failure = (error: unknown) =>
  error instanceof Error && /^(?:scraper|render)_/.test(error.message) ? error.message : fetchFailure(error);

/** New articles from a generated scraper, as feed entries for writeFeedEntries. Listing pages are followed only
 * while they still list unknown articles; the error is set when the scraper itself no longer works. */
export async function scrapeBlog(
  scraper: StoredScraper,
  blog: BlogToCrawl,
  known: (urls: string[]) => Promise<Set<string>>,
  options: FeedCrawlerOptions & { sandbox?: SandboxRunner; render?: typeof fetchRendered; maxPosts?: number; signal?: AbortSignal } = {},
  now = new Date(),
): Promise<ScrapeResult> {
  const sandbox = options.sandbox ?? runInSandbox;
  const fetchPage = scraper.render ? (options.render ?? fetchRendered) : fetchHtml;
  // History replays every listing page it can reach; a normal run stops at the first page of known articles.
  const pageLimit = options.historyImport ? MAX_HISTORY_PAGES : Math.min(scraper.maxPages, MAX_LIST_PAGES);
  const postLimit = options.maxPosts ?? (options.historyImport ? 50 : 10);
  const fresh: ListedPost[] = [];
  let listed = 0;
  let listError: string | null = null;
  for (const start of scraper.listUrls) {
    let url: string | null = start;
    for (let page = 0; url && page < pageLimit && fresh.length < postLimit; page++) {
      let result: ReturnType<typeof listedPage>;
      try {
        const html = await fetchPage(url, options, true);
        result = listedPage(await sandbox(scraper.code, 'listPosts', html), html.url, blog.url, now);
      } catch (error) {
        if (page === 0) listError ??= failure(error);
        break;
      }
      if (page === 0 && !result.posts.length) listError ??= 'no_articles_listed';
      listed += result.posts.length;
      const seen = await known(result.posts.map((p) => p.url));
      const unseen = result.posts.filter((p) => !seen.has(p.url) && !fresh.some((f) => f.url === p.url));
      fresh.push(...unseen);
      if (!unseen.length && !options.historyImport) break;
      url = result.next;
    }
    if (listed) break;
  }
  if (!listed) return { entries: [], listed, error: listError ?? 'no_articles_listed' };
  const entries: FeedEntry[] = [];
  let postErrors = 0;
  for (const item of fresh.slice(0, postLimit)) {
    if (options.signal?.aborted) break;
    try {
      const page = await fetchPage(item.url, options);
      const proof = vocusProofFromHtml(page.html, page.url, blog.url);
      if (vocusArticleCandidate(item.url, blog.url) && !vocusProofMatches(proof, item.url, blog.url)) {
        postErrors++;
        continue;
      }
      const post = parsedPost(await sandbox(scraper.code, 'parsePost', page), now);
      if (!post) {
        postErrors++;
        continue;
      }
      const html = scraperArticleHtml(post, item.url, proof);
      entries.push({
        guid: item.url,
        url: item.url,
        title: post.title,
        summary: publicSummary(post.bodyHtml),
        content: boundedFeedContent({
          html,
          ...(proof ? { publicationProof: proof } : {}),
          kind: 'article-html',
          completeness: 'full',
          sourceUrl: item.url,
          obtainedAt: now.toISOString(),
        }),
        author: post.author,
        // Undated sites (digital gardens): first fetch stands in for publication, by the operator's decision.
        publishedAt: post.publishedAt ?? item.publishedAt ?? now,
        updatedAt: null,
        imageUrl: null,
        categories: post.tags,
      });
    } catch {
      postErrors++;
    }
  }
  // Some broken articles are the site's problem; every new article failing is the scraper's.
  const error = !entries.length && postErrors > 0 ? 'articles_unparsed' : null;
  return { entries, listed, error };
}
