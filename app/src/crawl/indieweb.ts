import * as cheerio from 'cheerio';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import { publicationDecision } from '../relations/identity.ts';
import { INDIEWEB_LISTING } from './directory-listing.ts';
import { type FeedCrawlerOptions, isAllowedCrawlUrl, politeFetch, readFeedBody } from './feed.ts';

/** IndieWeb member homes from `User:<domain>` links on the wiki's chat-names page. MediaWiki capitalizes a page
 * name's first letter, so hosts are lowercased; a path after the domain is kept. */
export function indiewebMembers(html: string): string[] {
  const $ = cheerio.load(html);
  const homes = new Set<string>();
  $('a[href^="/User:"]').each((_, a) => {
    let name: string;
    try {
      name = decodeURIComponent(($(a).attr('href') || '').slice('/User:'.length))
        .split(/[#?]/)[0]
        .trim();
    } catch {
      return;
    }
    const [host, ...path] = name.split('/');
    if (!/^[\w-]+(?:\.[\w-]+)+$/.test(host)) return;
    const url = `https://${host.toLowerCase()}/${path.join('/')}`;
    const home = isAllowedCrawlUrl(url) ? publicationDecision(url).home : null;
    if (home) homes.add(home);
  });
  return [...homes];
}
/** Weekly: one polite request (the wiki asks for a 4 s crawl delay). New members become `indieweb-wiki` candidates
 * carrying the listing; ordinary review then checks language, home and feed (candidate-validation.ts). */
export async function discoverIndieweb(pool: Pool, options: FeedCrawlerOptions = {}, now = new Date()) {
  const response = await politeFetch(INDIEWEB_LISTING, {}, { ...options, delayMs: Math.max(4000, options.delayMs ?? 0) });
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`indieweb_http_${response.status}`);
  }
  const homes = indiewebMembers(await readFeedBody(response));
  let added = 0;
  for (const home of homes) {
    const listing = JSON.stringify({ page: INDIEWEB_LISTING });
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO discovery_candidates (url,name,source_type,source_url,source_evidence,status,discovered_at)
       VALUES (?,NULL,'indieweb-wiki',?,JSON_OBJECT('indiewebListing',JSON_EXTRACT(?,'$'),'discoveryDepth',1),'candidate',?)
       ON DUPLICATE KEY UPDATE id=id`,
      [home.slice(0, 1024), INDIEWEB_LISTING, listing, now],
    );
    if (result.affectedRows === 1) added++;
  }
  return { listed: homes.length, added };
}
